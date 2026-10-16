//! In-process fake Modbus slave for tests (feature `test-support`).
//!
//! It serves any async byte stream (in-memory duplex or TCP socket), keeps a register map,
//! and can be scripted per request to misbehave: stay silent, answer late, with an
//! exception, a bad CRC, the wrong slave or transaction id, a truncated or slowly trickled
//! frame, or close the connection.
//!
//! Unit id 0: on RTU it is a broadcast (writes are applied, nothing is answered). On TCP it
//! is an ordinary unit id that is answered, echoing unit id 0, as most TCP servers do.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use modbus_core::{
    decode_rtu_request, decode_tcp, encode_rtu, encode_tcp, ExceptionCode, PduError, Reply, Request,
};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::time::Instant;

use crate::link::{Framing, Link, LinkKind, Role, StreamLink};
use crate::ReceiveError;

/// What the fake does with one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Behavior {
    /// Answer correctly.
    Respond,
    /// Answer correctly after a delay (the serve loop is busy meanwhile).
    Delay(Duration),
    /// Answer correctly, one byte at a time with this pause before each byte (slow line).
    Trickle(Duration),
    /// Do not answer (master times out).
    Silent,
    /// Answer with this exception code.
    Exception(u8),
    /// Answer with a corrupted CRC (RTU) / corrupted last byte (TCP).
    BadCrc,
    /// Answer as another slave / unit id.
    WrongSlave(u8),
    /// Answer with transaction id + 1 (TCP only), an id the master never sent.
    WrongTransaction,
    /// Send only the first `n` bytes of the correct answer.
    Truncate(usize),
    /// Send these bytes instead of an answer.
    Raw(Vec<u8>),
    /// Close the connection instead of answering.
    Close,
}

#[derive(Debug)]
struct State {
    slave_id: u8,
    coils: Vec<bool>,
    discrete_inputs: Vec<bool>,
    holding: Vec<u16>,
    input: Vec<u16>,
    script: VecDeque<Behavior>,
    default: Behavior,
    requests: Vec<(u8, Request)>,
    /// When each request frame was received (Tokio clock, pausable in tests).
    request_times: Vec<Instant>,
}

struct Answer {
    bytes: Vec<u8>,
    close: bool,
    /// Pause before each byte ([`Behavior::Trickle`]).
    pace: Option<Duration>,
}

/// A scriptable fake slave. Cloning shares the same state.
#[derive(Debug, Clone)]
pub struct FakeSlave {
    state: Arc<Mutex<State>>,
}

impl FakeSlave {
    /// A slave answering to `slave_id`, with register `i` holding the value `i` and input
    /// register `i` holding `!i`.
    #[must_use]
    pub fn new(slave_id: u8) -> Self {
        let holding: Vec<u16> = (0..=u16::MAX).collect();
        let input = holding.iter().map(|v| !v).collect();
        Self {
            state: Arc::new(Mutex::new(State {
                slave_id,
                coils: vec![false; 0x1_0000],
                discrete_inputs: (0..0x1_0000).map(|i| i % 3 == 0).collect(),
                holding,
                input,
                script: VecDeque::new(),
                default: Behavior::Respond,
                requests: Vec::new(),
                request_times: Vec::new(),
            })),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Queues behaviors for the next requests, in order.
    pub fn script(&self, behaviors: impl IntoIterator<Item = Behavior>) {
        self.lock().script.extend(behaviors);
    }

    /// Behavior used when the script is empty.
    pub fn set_default(&self, behavior: Behavior) {
        self.lock().default = behavior;
    }

    #[must_use]
    pub fn holding_register(&self, address: u16) -> u16 {
        self.lock().holding[usize::from(address)]
    }

    #[must_use]
    pub fn coil(&self, address: u16) -> bool {
        self.lock().coils[usize::from(address)]
    }

    /// Every decodable request received so far, with the unit id it was addressed to.
    #[must_use]
    pub fn requests(&self) -> Vec<(u8, Request)> {
        self.lock().requests.clone()
    }

    /// Receive time of every request frame addressed to this slave (or unit 0), in order.
    #[must_use]
    pub fn request_times(&self) -> Vec<Instant> {
        self.lock().request_times.clone()
    }

    /// Serves one stream until the peer closes it or a [`Behavior::Close`] is scripted.
    pub async fn serve<S>(&self, stream: S, framing: Framing)
    where
        S: AsyncRead + AsyncWrite + Unpin + Send,
    {
        let mut link = StreamLink::new(stream, framing, Role::Slave, LinkKind::Memory);
        loop {
            let frame = match link.receive_frame(Duration::from_secs(3600)).await {
                Ok(frame) => frame,
                Err(ReceiveError::Timeout { .. }) => continue,
                Err(ReceiveError::Link { .. }) => return,
            };
            let Some(answer) = self.handle(&frame, framing).await else {
                continue;
            };
            if answer.close {
                link.close().await;
                return;
            }
            let sent = match answer.pace {
                None => link.send(&answer.bytes).await,
                Some(per_byte) => {
                    let mut result = Ok(());
                    for b in &answer.bytes {
                        tokio::time::sleep(per_byte).await;
                        result = link.send(std::slice::from_ref(b)).await;
                        if result.is_err() {
                            break;
                        }
                    }
                    result
                }
            };
            if sent.is_err() {
                return;
            }
        }
    }

    /// Accepts TCP connections forever, serving each on its own task.
    pub async fn serve_tcp(self, listener: TcpListener) {
        while let Ok((stream, _)) = listener.accept().await {
            let _ = stream.set_nodelay(true);
            let me = self.clone();
            tokio::spawn(async move { me.serve(stream, Framing::Tcp).await });
        }
    }

    /// The answer to one request, or `None` for no answer.
    async fn handle(&self, frame: &[u8], framing: Framing) -> Option<Answer> {
        let tcp = framing == Framing::Tcp;
        // Decode the request.
        let (txn, unit, decoded) = if tcp {
            let (header, pdu) = decode_tcp(frame).ok()?;
            (
                header.transaction_id,
                header.unit_id,
                Request::decode_pdu(pdu).map_err(Some),
            )
        } else {
            match decode_rtu_request(frame) {
                Ok((slave, request)) => (0, slave, Ok(request)),
                Err(None) => return None, // bad CRC: a real slave stays silent
                Err(Some(e)) => (0, frame[0], Err(Some(e))),
            }
        };
        let function = frame.get(if tcp { 7 } else { 1 }).copied().unwrap_or(0);

        let (behavior, slave_id) = {
            let mut st = self.lock();
            if unit != 0 && unit != st.slave_id {
                return None;
            }
            st.request_times.push(Instant::now());
            if let Ok(request) = &decoded {
                st.requests.push((unit, request.clone()));
            }
            let b = st.script.pop_front().unwrap_or_else(|| st.default.clone());
            (b, st.slave_id)
        };

        let reply = match (&behavior, &decoded) {
            (Behavior::Exception(code), _) => Reply::Exception {
                function: function & 0x7F,
                code: ExceptionCode(*code),
            },
            (_, Err(Some(PduError::UnsupportedFunction(_)))) => Reply::Exception {
                function: function & 0x7F,
                code: ExceptionCode::ILLEGAL_FUNCTION,
            },
            (_, Err(_)) => Reply::Exception {
                function: function & 0x7F,
                code: ExceptionCode::ILLEGAL_DATA_VALUE,
            },
            (_, Ok(request)) => self.execute(request),
        };
        if unit == 0 && !tcp {
            return None; // RTU broadcast: never answer
        }
        // TCP servers echo the request's unit id (0 or their own id).
        let reply_unit = if tcp { unit } else { slave_id };

        let encode = |txn: u16, slave: u8, pdu: &[u8]| {
            if tcp {
                encode_tcp(txn, slave, pdu)
            } else {
                encode_rtu(slave, pdu)
            }
        };
        let pdu = reply.encode_pdu();
        let mut bytes = encode(txn, reply_unit, &pdu);
        let mut pace = None;
        match behavior {
            Behavior::Respond | Behavior::Exception(_) => {}
            Behavior::Delay(d) => tokio::time::sleep(d).await,
            Behavior::Trickle(d) => pace = Some(d),
            Behavior::Silent => return None,
            Behavior::Close => {
                return Some(Answer {
                    bytes: Vec::new(),
                    close: true,
                    pace: None,
                })
            }
            Behavior::BadCrc => {
                if let Some(last) = bytes.last_mut() {
                    *last ^= 0x5A;
                }
            }
            Behavior::WrongSlave(other) => bytes = encode(txn, other, &pdu),
            Behavior::WrongTransaction => bytes = encode(txn.wrapping_add(1), reply_unit, &pdu),
            Behavior::Truncate(n) => bytes.truncate(n),
            Behavior::Raw(raw) => bytes = raw,
        }
        Some(Answer {
            bytes,
            close: false,
            pace,
        })
    }

    fn execute(&self, request: &Request) -> Reply {
        let mut st = self.lock();
        let a = usize::from(request.address());
        let q = usize::from(request.quantity());
        match request {
            Request::ReadCoils { .. } => {
                Reply::echo_for(request, st.coils[a..a + q].to_vec(), vec![])
            }
            Request::ReadDiscreteInputs { .. } => {
                Reply::echo_for(request, st.discrete_inputs[a..a + q].to_vec(), vec![])
            }
            Request::ReadHoldingRegisters { .. } => {
                Reply::echo_for(request, vec![], st.holding[a..a + q].to_vec())
            }
            Request::ReadInputRegisters { .. } => {
                Reply::echo_for(request, vec![], st.input[a..a + q].to_vec())
            }
            Request::WriteSingleCoil { value, .. } => {
                st.coils[a] = *value;
                Reply::echo_for(request, vec![], vec![])
            }
            Request::WriteSingleRegister { value, .. } => {
                st.holding[a] = *value;
                Reply::echo_for(request, vec![], vec![])
            }
            Request::WriteMultipleCoils { values, .. } => {
                st.coils[a..a + q].copy_from_slice(values);
                Reply::echo_for(request, vec![], vec![])
            }
            Request::WriteMultipleRegisters { values, .. } => {
                st.holding[a..a + q].copy_from_slice(values);
                Reply::echo_for(request, vec![], vec![])
            }
        }
    }
}
