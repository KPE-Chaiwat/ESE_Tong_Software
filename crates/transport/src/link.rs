//! The [`Link`] trait and its stream-based implementation with Modbus frame boundaries.

use std::io;
use std::time::Duration;

use async_trait::async_trait;
use modbus_core::{rtu_request_length, rtu_response_length, tcp_frame_length, FrameLength};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::time::{timeout_at, Instant};

use crate::error::{LinkError, ReceiveError};

/// Minimum RTU inter-frame silence. The specification asks for 3.5 character times, but
/// USB serial adapters on Windows deliver bytes in chunks (latency timers around 16 ms),
/// so a shorter gap would split frames. The silence only ends frames whose length cannot
/// be derived from the header, or that stopped arriving before they were complete.
pub const MIN_RTU_SILENCE: Duration = Duration::from_millis(50);

/// Character timing of a serial line, derived from baud rate and character format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RtuTiming {
    /// Time to transmit one character (start + data + parity + stop bits).
    pub char_time: Duration,
    /// Minimum inter-frame gap t3.5: 3.5 character times, fixed at 1.75 ms above
    /// 19200 baud (Modbus over Serial Line v1.02, 2.5.1.1).
    pub t35: Duration,
    /// Silence that ends a frame whose length is unknown or that stopped arriving:
    /// `max(t3.5, MIN_RTU_SILENCE)`.
    pub silence: Duration,
}

impl RtuTiming {
    /// `bits_per_char` = 1 start + data bits + parity bit (0/1) + stop bits.
    #[must_use]
    pub fn new(baud: u32, bits_per_char: u32) -> Self {
        let baud = u64::from(baud.max(1));
        let char_time = Duration::from_nanos(u64::from(bits_per_char) * 1_000_000_000 / baud);
        let t35 = if baud > 19_200 {
            Duration::from_micros(1750)
        } else {
            char_time * 7 / 2
        };
        Self {
            char_time,
            t35,
            silence: t35.max(MIN_RTU_SILENCE),
        }
    }

    /// Time to transmit `bytes` characters.
    #[must_use]
    pub fn transmit_time(&self, bytes: usize) -> Duration {
        self.char_time * u32::try_from(bytes).unwrap_or(u32::MAX)
    }
}

/// How the byte stream is cut into frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framing {
    /// Modbus TCP: length from the MBAP header.
    Tcp,
    /// Modbus RTU: length from the PDU header, else end of frame after `silence`.
    Rtu(RtuTiming),
}

impl Framing {
    /// RTU framing for `baud` with `bits_per_char` bits per character.
    #[must_use]
    pub fn rtu(baud: u32, bits_per_char: u32) -> Self {
        Self::Rtu(RtuTiming::new(baud, bits_per_char))
    }

    /// RTU framing assuming 11 bits per character (8 data bits + parity or 2 stop bits).
    #[must_use]
    pub fn rtu_for_baud(baud: u32) -> Self {
        Self::rtu(baud, 11)
    }

    /// Time the line needs to carry `bytes` (zero for TCP).
    #[must_use]
    pub fn transmit_time(&self, bytes: usize) -> Duration {
        match self {
            Self::Tcp => Duration::ZERO,
            Self::Rtu(t) => t.transmit_time(bytes),
        }
    }
}

/// Which side of the conversation this link reads frames for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Reads responses (normal use).
    Master,
    /// Reads requests (fake slave in tests).
    Slave,
}

/// Physical kind of the link, used to classify I/O errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Tcp,
    Serial,
    /// In-memory stream (tests).
    Memory,
}

/// A connected byte link that exchanges whole Modbus frames.
///
/// All methods take `&mut self`: a link carries one conversation at a time. Dropping a
/// link closes it (socket or serial handle).
#[async_trait]
pub trait Link: Send {
    fn framing(&self) -> Framing;

    /// Writes one complete frame.
    async fn send(&mut self, frame: &[u8]) -> Result<(), LinkError>;

    /// Reads one frame, waiting at most `timeout` for it to complete.
    ///
    /// Returns [`ReceiveError::Timeout`] with any partial bytes when the deadline passes.
    async fn receive_frame(&mut self, timeout: Duration) -> Result<Vec<u8>, ReceiveError>;

    /// Returns every byte that is already buffered or immediately readable, without waiting.
    /// Used before a request to discard late or unsolicited bytes.
    async fn drain(&mut self) -> Result<Vec<u8>, LinkError>;

    /// Waits until unsolicited bytes arrive (returned) or the link fails. Cancel-safe: it is
    /// meant for `select!` while the link is idle, so link loss is noticed without traffic.
    async fn watch(&mut self) -> Result<Vec<u8>, LinkError>;

    /// Closes the link gracefully. Errors are ignored.
    async fn close(&mut self);
}

/// A [`Link`] over any async byte stream (TCP socket, serial port, in-memory duplex).
pub struct StreamLink<S> {
    stream: S,
    framing: Framing,
    role: Role,
    kind: LinkKind,
    /// Bytes read but not yet returned as part of a frame.
    pending: Vec<u8>,
}

impl<S> StreamLink<S>
where
    S: AsyncRead + AsyncWrite + Unpin + Send,
{
    pub fn new(stream: S, framing: Framing, role: Role, kind: LinkKind) -> Self {
        Self {
            stream,
            framing,
            role,
            kind,
            pending: Vec::new(),
        }
    }

    fn frame_length(&self) -> FrameLength {
        match (self.framing, self.role) {
            (Framing::Tcp, _) => tcp_frame_length(&self.pending),
            (Framing::Rtu(_), Role::Master) => rtu_response_length(&self.pending),
            (Framing::Rtu(_), Role::Slave) => rtu_request_length(&self.pending),
        }
    }

    /// A complete frame at the start of `pending`, if there is one.
    fn take_complete(&mut self) -> Option<Vec<u8>> {
        match self.frame_length() {
            FrameLength::Total(n) if self.pending.len() >= n => {
                Some(self.pending.drain(..n).collect())
            }
            // TCP cannot resynchronise on a nonsense MBAP length: hand everything over so
            // the decoder reports it as malformed.
            FrameLength::Unknown if self.framing == Framing::Tcp && !self.pending.is_empty() => {
                Some(std::mem::take(&mut self.pending))
            }
            _ => None,
        }
    }

    fn classify(&self, err: &io::Error) -> LinkError {
        LinkError::from_io(self.kind, err)
    }

    async fn read_some(&mut self) -> io::Result<usize> {
        let mut buf = [0u8; 512];
        let n = self.stream.read(&mut buf).await?;
        self.pending.extend_from_slice(&buf[..n]);
        Ok(n)
    }
}

#[async_trait]
impl<S> Link for StreamLink<S>
where
    S: AsyncRead + AsyncWrite + Unpin + Send,
{
    fn framing(&self) -> Framing {
        self.framing
    }

    async fn send(&mut self, frame: &[u8]) -> Result<(), LinkError> {
        let result = async {
            self.stream.write_all(frame).await?;
            self.stream.flush().await
        }
        .await;
        result.map_err(|e| self.classify(&e))
    }

    async fn receive_frame(&mut self, timeout: Duration) -> Result<Vec<u8>, ReceiveError> {
        let mut deadline = Instant::now() + timeout;
        loop {
            if let Some(frame) = self.take_complete() {
                return Ok(frame);
            }
            let wait_until = match self.framing {
                Framing::Rtu(timing) if !self.pending.is_empty() => {
                    // REV-001 F5: once a reply has started and its length is known, the
                    // deadline covers at least the transmission of the remaining bytes at
                    // the configured baud, so large reads at low baud are not cut off.
                    if let FrameLength::Total(n) = self.frame_length() {
                        let remaining = n.saturating_sub(self.pending.len());
                        let needed =
                            Instant::now() + timing.transmit_time(remaining) + timing.silence;
                        deadline = deadline.max(needed);
                    }
                    // A silent gap ends the frame early.
                    deadline.min(Instant::now() + timing.silence)
                }
                _ => deadline,
            };
            match timeout_at(wait_until, self.read_some()).await {
                Ok(Ok(0)) => {
                    return Err(ReceiveError::Link {
                        error: LinkError::Closed,
                        partial: std::mem::take(&mut self.pending),
                    })
                }
                Ok(Ok(_)) => {}
                Ok(Err(e)) => {
                    return Err(ReceiveError::Link {
                        error: self.classify(&e),
                        partial: std::mem::take(&mut self.pending),
                    })
                }
                Err(_elapsed) if wait_until < deadline => {
                    // Silence inside an RTU frame: return what arrived; the decoder reports it.
                    return Ok(std::mem::take(&mut self.pending));
                }
                Err(_elapsed) => {
                    return Err(ReceiveError::Timeout {
                        partial: std::mem::take(&mut self.pending),
                    })
                }
            }
        }
    }

    async fn drain(&mut self) -> Result<Vec<u8>, LinkError> {
        loop {
            // `biased` polls the read first; if no byte is ready the second branch wins at once.
            let progressed = tokio::select! {
                biased;
                r = self.read_some() => Some(r),
                () = std::future::ready(()) => None,
            };
            match progressed {
                None => break,
                Some(Ok(0)) => return Err(LinkError::Closed),
                Some(Ok(_)) => {}
                Some(Err(e)) => return Err(self.classify(&e)),
            }
        }
        Ok(std::mem::take(&mut self.pending))
    }

    async fn watch(&mut self) -> Result<Vec<u8>, LinkError> {
        if !self.pending.is_empty() {
            return Ok(std::mem::take(&mut self.pending));
        }
        // `AsyncReadExt::read` is cancel-safe: if this future is dropped, no byte is lost.
        match self.read_some().await {
            Ok(0) => Err(LinkError::Closed),
            Ok(_) => Ok(std::mem::take(&mut self.pending)),
            Err(e) => Err(self.classify(&e)),
        }
    }

    async fn close(&mut self) {
        let _ = self.stream.shutdown().await;
    }
}
