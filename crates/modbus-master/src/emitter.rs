//! Delivery of [`SessionEvent`]s to the UI with an explicit rate and drop policy.
//!
//! Policy (BE-001 Q-07 and task 6):
//! - `StateChanged`: sent immediately, never dropped or coalesced. Any pending `PollUpdate`
//!   is flushed first, so values from a cycle never arrive after the state that followed it.
//! - `PollUpdate`: at most one per [`UPDATE_INTERVAL`]; within a window the latest update
//!   wins (older ones are dropped). `seq` is strictly increasing, so the UI sees gaps.
//! - `TrafficFrames`: frames are batched, at most one batch per [`TRAFFIC_INTERVAL`]. No
//!   frame is dropped unless more than [`MAX_PENDING_FRAMES`] pile up inside one window
//!   (impossible at the minimum 20 ms scan rate); then the oldest are dropped and the gap
//!   shows in `TrafficFrame.seq`.
//! - `Counters`: at most one per [`COUNTERS_INTERVAL`], latest wins. `Reset counters` and
//!   re-attaching a window send immediately.
//!
//! The emitter never blocks: the sink is a fire-and-forget channel (a Tauri `Channel`
//! queues into the webview). A window that cannot keep up therefore sees coalesced
//! updates, never a growing backlog inside the session.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use shared_types::{Counters, PollUpdate, SessionEvent, StateChanged, TrafficFrame, TrafficFrames};
use tokio::time::Instant;

pub const TRAFFIC_INTERVAL: Duration = Duration::from_millis(50);
pub const UPDATE_INTERVAL: Duration = Duration::from_millis(50);
pub const COUNTERS_INTERVAL: Duration = Duration::from_millis(100);
pub const MAX_PENDING_FRAMES: usize = 5_000;

/// Receiver of session events (the window's channel).
pub trait EventSink: Send + Sync + 'static {
    /// Delivers one event. Returns `false` when the receiver is gone; the event is lost.
    fn send(&self, event: SessionEvent) -> bool;
}

struct Throttle {
    interval: Duration,
    last: Option<Instant>,
}

impl Throttle {
    fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: None,
        }
    }

    fn ready_at(&self) -> Instant {
        self.last.map_or_else(Instant::now, |l| l + self.interval)
    }

    fn is_ready(&self, now: Instant) -> bool {
        self.last.is_none_or(|l| now >= l + self.interval)
    }
}

pub struct Emitter {
    sink: Arc<dyn EventSink>,
    frames: VecDeque<TrafficFrame>,
    update: Option<PollUpdate>,
    counters: Option<Counters>,
    frames_gate: Throttle,
    update_gate: Throttle,
    counters_gate: Throttle,
    /// Largest number of frames that were ever pending at once (for backlog tests).
    pub max_pending_frames: usize,
}

impl Emitter {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            sink,
            frames: VecDeque::new(),
            update: None,
            counters: None,
            frames_gate: Throttle::new(TRAFFIC_INTERVAL),
            update_gate: Throttle::new(UPDATE_INTERVAL),
            counters_gate: Throttle::new(COUNTERS_INTERVAL),
            max_pending_frames: 0,
        }
    }

    /// Replaces the sink (window reload). Pending events go to the new sink.
    pub fn set_sink(&mut self, sink: Arc<dyn EventSink>) {
        self.sink = sink;
    }

    pub fn state(&mut self, state: StateChanged) {
        self.send_update();
        self.sink.send(SessionEvent::StateChanged(state));
    }

    pub fn poll_update(&mut self, update: PollUpdate) {
        self.update = Some(update);
        self.flush_due(Instant::now());
    }

    pub fn frame(&mut self, frame: TrafficFrame) {
        if self.frames.len() >= MAX_PENDING_FRAMES {
            self.frames.pop_front(); // O(1) (REV-001 N4)
        }
        self.frames.push_back(frame);
        self.max_pending_frames = self.max_pending_frames.max(self.frames.len());
        self.flush_due(Instant::now());
    }

    pub fn counters(&mut self, counters: Counters) {
        self.counters = Some(counters);
        self.flush_due(Instant::now());
    }

    /// Sends counters now, ignoring the rate limit.
    pub fn counters_now(&mut self, counters: Counters) {
        self.counters = Some(counters);
        self.send_counters();
    }

    /// Sends every pending event, ignoring the rate limits.
    pub fn flush_all(&mut self) {
        self.send_update();
        self.send_frames();
        self.send_counters();
    }

    /// When the next pending event becomes due, if any.
    #[must_use]
    pub fn next_flush_at(&self) -> Option<Instant> {
        [
            (!self.frames.is_empty()).then(|| self.frames_gate.ready_at()),
            self.update.as_ref().map(|_| self.update_gate.ready_at()),
            self.counters
                .as_ref()
                .map(|_| self.counters_gate.ready_at()),
        ]
        .into_iter()
        .flatten()
        .min()
    }

    /// Sends what is pending and due at `now`.
    pub fn flush_due(&mut self, now: Instant) {
        if self.update.is_some() && self.update_gate.is_ready(now) {
            self.send_update();
        }
        if !self.frames.is_empty() && self.frames_gate.is_ready(now) {
            self.send_frames();
        }
        if self.counters.is_some() && self.counters_gate.is_ready(now) {
            self.send_counters();
        }
    }

    /// Sends a batch directly (replay on re-attach), outside the pending queue.
    pub fn replay(&mut self, frames: Vec<TrafficFrame>) {
        for chunk in frames.chunks(1000) {
            self.sink.send(SessionEvent::TrafficFrames(TrafficFrames {
                frames: chunk.to_vec(),
            }));
        }
    }

    fn send_update(&mut self) {
        if let Some(u) = self.update.take() {
            self.update_gate.last = Some(Instant::now());
            self.sink.send(SessionEvent::PollUpdate(u));
        }
    }

    fn send_frames(&mut self) {
        if !self.frames.is_empty() {
            self.frames_gate.last = Some(Instant::now());
            let frames = Vec::from(std::mem::take(&mut self.frames));
            self.sink
                .send(SessionEvent::TrafficFrames(TrafficFrames { frames }));
        }
    }

    fn send_counters(&mut self) {
        if let Some(c) = self.counters.take() {
            self.counters_gate.last = Some(Instant::now());
            self.sink.send(SessionEvent::Counters(c));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use shared_types::TrafficDirection;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<SessionEvent>>);
    impl EventSink for Recorder {
        fn send(&self, event: SessionEvent) -> bool {
            self.0.lock().unwrap().push(event);
            true
        }
    }

    fn frame(seq: u64) -> TrafficFrame {
        TrafficFrame {
            seq,
            at: 0,
            direction: TrafficDirection::Tx,
            bytes: vec![],
            slave_id: None,
            function: None,
            exception_code: None,
            note: None,
        }
    }

    fn update(seq: u64) -> PollUpdate {
        PollUpdate {
            seq,
            at: 0,
            slave_id: 1,
            function: 3,
            start_address: 0,
            values: vec![],
            round_trip_ms: 0,
        }
    }

    #[tokio::test(start_paused = true)]
    async fn traffic_is_batched_per_window() {
        let rec = Arc::new(Recorder::default());
        let mut e = Emitter::new(rec.clone());
        e.frame(frame(1)); // first one goes out at once
        e.frame(frame(2));
        e.frame(frame(3));
        assert_eq!(rec.0.lock().unwrap().len(), 1);
        let due = e.next_flush_at().unwrap();
        assert_eq!(due - Instant::now(), TRAFFIC_INTERVAL);
        tokio::time::advance(TRAFFIC_INTERVAL).await;
        e.flush_due(Instant::now());
        let events = rec.0.lock().unwrap().clone();
        assert_eq!(events.len(), 2);
        match &events[1] {
            SessionEvent::TrafficFrames(b) => assert_eq!(b.frames.len(), 2),
            other => panic!("{other:?}"),
        }
        assert!(e.next_flush_at().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn poll_updates_coalesce_and_flush_before_state() {
        let rec = Arc::new(Recorder::default());
        let mut e = Emitter::new(rec.clone());
        e.poll_update(update(1));
        e.poll_update(update(2));
        e.poll_update(update(3));
        e.state(StateChanged {
            state: shared_types::SessionState::Timeout,
            reason: None,
            consecutive_failures: 1,
            exception_code: None,
            bad_response_kind: None,
            bad_response_detail: None,
            at: 0,
        });
        let kinds: Vec<String> = rec
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|ev| match ev {
                SessionEvent::PollUpdate(u) => format!("u{}", u.seq),
                SessionEvent::StateChanged(_) => "state".into(),
                _ => "other".into(),
            })
            .collect();
        // Update 2 was replaced by 3 (latest wins); 3 is flushed before the state.
        assert_eq!(kinds, ["u1", "u3", "state"]);
    }

    #[tokio::test(start_paused = true)]
    async fn pending_frames_are_capped() {
        let rec = Arc::new(Recorder::default());
        let mut e = Emitter::new(rec.clone());
        for i in 0..(MAX_PENDING_FRAMES as u64 + 10) {
            e.frame(frame(i));
        }
        assert_eq!(e.max_pending_frames, MAX_PENDING_FRAMES);
        e.flush_all();
        let events = rec.0.lock().unwrap().clone();
        match events.last().unwrap() {
            SessionEvent::TrafficFrames(b) => {
                assert_eq!(b.frames.len(), MAX_PENDING_FRAMES);
                // Frame 0 went out at once; 1-9 were dropped; the seq gap shows it.
                assert_eq!(b.frames[0].seq, 10);
            }
            other => panic!("{other:?}"),
        }
    }
}
