//! Traffic log: raw TX/RX frames with timestamps, bounded to [`TRAFFIC_LOG_CAPACITY`].

use std::collections::VecDeque;

use shared_types::{ExceptionCode, TrafficDirection, TrafficFrame};
use transport::Framing;

/// The backend keeps at most this many frames per session (REQ-001).
pub const TRAFFIC_LOG_CAPACITY: usize = 5_000;

/// Ring buffer of frames with a strictly increasing sequence number.
#[derive(Debug, Default)]
pub(crate) struct TrafficLog {
    frames: VecDeque<TrafficFrame>,
    next_seq: u64,
}

impl TrafficLog {
    /// Records a frame and returns it. `bytes` must be exactly what was on the wire.
    pub(crate) fn record(
        &mut self,
        at: u64,
        direction: TrafficDirection,
        bytes: Vec<u8>,
        framing: Framing,
        note: Option<String>,
    ) -> TrafficFrame {
        self.next_seq += 1;
        let (slave_id, function, exception_code) = header_fields(&bytes, framing);
        let frame = TrafficFrame {
            seq: self.next_seq,
            at,
            direction,
            bytes,
            slave_id,
            function,
            exception_code,
            note,
        };
        if self.frames.len() == TRAFFIC_LOG_CAPACITY {
            self.frames.pop_front();
        }
        self.frames.push_back(frame.clone());
        frame
    }

    #[must_use]
    pub(crate) fn frames(&self) -> Vec<TrafficFrame> {
        self.frames.iter().cloned().collect()
    }

    #[must_use]
    pub(crate) fn len(&self) -> usize {
        self.frames.len()
    }
}

/// Best-effort slave id, function (without the exception bit) and exception code.
fn header_fields(
    bytes: &[u8],
    framing: Framing,
) -> (Option<u8>, Option<u8>, Option<ExceptionCode>) {
    let (slave_at, fc_at) = match framing {
        Framing::Tcp => (6, 7),
        Framing::Rtu(_) => (0, 1),
    };
    let slave = bytes.get(slave_at).copied();
    let fc = bytes.get(fc_at).copied();
    let exception = match fc {
        Some(fc) if fc & 0x80 != 0 => bytes.get(fc_at + 1).map(|c| ExceptionCode(*c)),
        _ => None,
    };
    (slave, fc.map(|f| f & 0x7F), exception)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capacity_and_seq() {
        let mut log = TrafficLog::default();
        for _ in 0..(TRAFFIC_LOG_CAPACITY + 1) {
            log.record(0, TrafficDirection::Tx, vec![1, 3], Framing::Tcp, None);
        }
        assert_eq!(log.len(), TRAFFIC_LOG_CAPACITY);
        let frames = log.frames();
        assert_eq!(frames[0].seq, 2);
        assert_eq!(frames.last().unwrap().seq, TRAFFIC_LOG_CAPACITY as u64 + 1);
    }

    #[test]
    fn header_parsing() {
        let rtu = Framing::rtu_for_baud(9600);
        assert_eq!(
            header_fields(&[0x11, 0x83, 0x02, 0, 0], rtu),
            (Some(0x11), Some(3), Some(ExceptionCode(2)))
        );
        assert_eq!(
            header_fields(&[0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10], Framing::Tcp),
            (Some(1), Some(3), None)
        );
        assert_eq!(header_fields(&[], Framing::Tcp), (None, None, None));
    }
}
