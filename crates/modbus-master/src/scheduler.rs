//! Poll scheduling of DES-002 section 7, as a pure data structure over an abstract time.
//!
//! Rules:
//! 1. One request in flight per link (the session only asks for the next poll when the
//!    link is free).
//! 2. Writes first: the session takes a queued write before asking the scheduler.
//! 3. Earliest deadline: each running poll has `nextDue`; the poll with the earliest
//!    `nextDue` that is not in the future goes next. Ties go to the poll served least
//!    recently (round robin), then to the lower poll id (creation order).
//! 4. No catch-up bursts: when a poll is served at `start`, `nextDue = start + scanRate`.
//!    A request that ends after that makes the poll due at once, but only once.
//! 5. No starvation: an overdue poll keeps its old `nextDue`, so it wins against every
//!    poll that became due later: each running poll is served within one pass over the
//!    other running polls.
//!
//! List order and host never affect scheduling (BE-002 PM decision).
//!
//! Timer lateness (REPORT-006 D1, REV-008 m-1, [`on_time_start`]): when the session sleeps
//! until a deadline and the OS wakes it up to [`TIMER_SLACK`] late, the request still counts
//! as started at the deadline for rule 4, so OS timer lateness does not add up from cycle to
//! cycle.

use std::ops::Add;
use std::time::Duration;

use shared_types::PollId;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Entry<T> {
    id: PollId,
    scan: Duration,
    running: bool,
    next_due: T,
    /// Serve tick of the last request (0 = never served).
    last_served: u64,
}

/// The deadline scheduler. `T` is the time type (`tokio::time::Instant` in the session).
#[derive(Debug, Clone)]
pub struct Scheduler<T> {
    entries: Vec<Entry<T>>,
    tick: u64,
}

impl<T> Default for Scheduler<T> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            tick: 0,
        }
    }
}

impl<T: Copy + Ord + Add<Duration, Output = T>> Scheduler<T> {
    fn entry_mut(&mut self, id: PollId) -> Option<&mut Entry<T>> {
        self.entries.iter_mut().find(|e| e.id == id)
    }

    /// Adds a stopped poll (no-op when it exists).
    pub fn insert(&mut self, id: PollId, scan: Duration, now: T) {
        if self.entries.iter().any(|e| e.id == id) {
            return;
        }
        self.entries.push(Entry {
            id,
            scan,
            running: false,
            next_due: now,
            last_served: 0,
        });
    }

    pub fn remove(&mut self, id: PollId) {
        self.entries.retain(|e| e.id != id);
    }

    pub fn set_scan(&mut self, id: PollId, scan: Duration) {
        if let Some(e) = self.entry_mut(id) {
            e.scan = scan;
        }
    }

    /// Starts (due at once) or stops a poll. Starting an already running poll restarts it.
    pub fn set_running(&mut self, id: PollId, running: bool, now: T) {
        if let Some(e) = self.entry_mut(id) {
            e.running = running;
            if running {
                e.next_due = now;
            }
        }
    }

    pub fn stop_all(&mut self) {
        for e in &mut self.entries {
            e.running = false;
        }
    }

    #[must_use]
    pub fn is_running(&self, id: PollId) -> bool {
        self.entries.iter().any(|e| e.id == id && e.running)
    }

    /// The poll to send now, if any (rules 3 and 5).
    #[must_use]
    pub fn pick(&self, now: T) -> Option<PollId> {
        self.entries
            .iter()
            .filter(|e| e.running && e.next_due <= now)
            .min_by_key(|e| (e.next_due, e.last_served, e.id))
            .map(|e| e.id)
    }

    /// Records that `id` was sent at `start` (rule 4).
    pub fn served(&mut self, id: PollId, start: T) {
        self.tick += 1;
        let tick = self.tick;
        if let Some(e) = self.entry_mut(id) {
            e.next_due = start + e.scan;
            e.last_served = tick;
        }
    }

    /// When the next poll becomes due, if any poll runs.
    #[must_use]
    pub fn next_due(&self) -> Option<T> {
        self.entries
            .iter()
            .filter(|e| e.running)
            .map(|e| e.next_due)
            .min()
    }
}

/// How late an OS timer wake-up may be and still count as on time: 2 ms, at most a quarter
/// of the scan rate.
///
/// Why 2 ms (REV-008 m-1): a Tokio sleep ends on the first whole millisecond of its timer
/// wheel at or after the deadline (up to 1 ms of rounding), and the parked thread then wakes
/// on the next 1 ms period of the OS timer (`os_timer.rs` in the app) with some jitter on
/// top, so a normal wake-up is 0 to 2 ms late. With 1 ms most wake-ups fell outside the
/// slack and the lateness added up again (+1.2 ms mean at 20 ms). Why not more: a start
/// counted at the target can be up to the slack earlier than the request really went out,
/// so the next interval can be up to the slack shorter than the scan rate; CHK2-D10 /
/// D-002-20 allow `scan - 2 ms` at most (DES-002 7 item 8). A coarse OS timer (15.6 ms) is
/// fixed by the timer precision, not here.
pub const TIMER_SLACK: Duration = Duration::from_millis(2);

/// [`TIMER_SLACK`], at most a quarter of `scan`.
#[must_use]
pub fn timer_slack(scan: Duration) -> Duration {
    (scan / 4).min(TIMER_SLACK)
}

/// The start of a poll request for rule 4 (`nextDue = start + scanRate`), sent at `now`.
///
/// `timer_target` is the instant the session's dispatch timer was armed for, when that
/// timer is what woke the session (else `None`). A wake-up at most [`timer_slack`] after
/// the target is OS timer lateness, not a scheduling delay: the request counts as started
/// at the target. Every other start (link busy with another request, a write, an RTU gap,
/// a wake-up later than the slack) is `now`, exactly as rule 4 says.
#[must_use]
pub fn on_time_start<T: Copy + Ord + Add<Duration, Output = T>>(
    timer_target: Option<T>,
    now: T,
    scan: Duration,
) -> T {
    match timer_target {
        Some(target) if target <= now && now <= target + timer_slack(scan) => target,
        _ => now,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    /// Milliseconds as a time type.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
    struct Ms(u64);

    impl Add<Duration> for Ms {
        type Output = Ms;
        fn add(self, d: Duration) -> Ms {
            Ms(self.0 + u64::try_from(d.as_millis()).unwrap())
        }
    }

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn earliest_deadline_then_least_recently_served() {
        let mut s = Scheduler::default();
        for id in 1..=3 {
            s.insert(PollId(id), ms(100), Ms(0));
            s.set_running(PollId(id), true, Ms(0));
        }
        // All due at 0: ties go to the never-served, lowest id.
        assert_eq!(s.pick(Ms(0)), Some(PollId(1)));
        s.served(PollId(1), Ms(0));
        assert_eq!(s.pick(Ms(10)), Some(PollId(2)));
        s.served(PollId(2), Ms(10));
        assert_eq!(s.pick(Ms(20)), Some(PollId(3)));
        s.served(PollId(3), Ms(20));
        assert_eq!(s.pick(Ms(30)), None, "nobody is due before 100");
        assert_eq!(s.next_due(), Some(Ms(100)));
        assert_eq!(s.pick(Ms(500)), Some(PollId(1)), "earliest nextDue first");
    }

    #[test]
    fn ties_go_to_the_least_recently_served() {
        let mut s = Scheduler::default();
        for id in [7, 3] {
            s.insert(PollId(id), ms(100), Ms(0));
            s.set_running(PollId(id), true, Ms(0));
        }
        s.served(PollId(3), Ms(0));
        s.served(PollId(7), Ms(0));
        // Both due at 100: poll 3 was served before poll 7.
        assert_eq!(s.pick(Ms(100)), Some(PollId(3)));
    }

    #[test]
    fn no_catch_up_burst_after_a_slow_request() {
        let mut s = Scheduler::default();
        s.insert(PollId(1), ms(100), Ms(0));
        s.set_running(PollId(1), true, Ms(0));
        s.served(PollId(1), Ms(0));
        // The request took 1000 ms (timeout): due once, not 10 times.
        assert_eq!(s.pick(Ms(1000)), Some(PollId(1)));
        s.served(PollId(1), Ms(1000));
        assert_eq!(s.pick(Ms(1001)), None);
        assert_eq!(s.next_due(), Some(Ms(1100)));
    }

    #[test]
    fn stopped_and_removed_polls_are_never_picked() {
        let mut s = Scheduler::default();
        s.insert(PollId(1), ms(100), Ms(0));
        assert_eq!(s.pick(Ms(0)), None);
        s.set_running(PollId(1), true, Ms(0));
        s.set_running(PollId(1), false, Ms(0));
        assert_eq!(s.pick(Ms(0)), None);
        assert_eq!(s.next_due(), None);
        s.set_running(PollId(1), true, Ms(5));
        s.remove(PollId(1));
        assert_eq!(s.pick(Ms(10)), None);
    }

    /// Microseconds as a time type (OS timer models need sub-millisecond steps).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    struct Us(u64);

    impl Add<Duration> for Us {
        type Output = Us;
        fn add(self, d: Duration) -> Us {
            Us(self.0 + u64::try_from(d.as_micros()).unwrap())
        }
    }

    #[test]
    fn timer_slack_is_two_ms_at_most_a_quarter_cycle() {
        assert_eq!(timer_slack(ms(20)), ms(2));
        assert_eq!(timer_slack(ms(60_000)), ms(2));
        assert_eq!(timer_slack(ms(8)), ms(2));
        assert_eq!(timer_slack(ms(4)), ms(1));
        assert_eq!(
            timer_slack(Duration::from_micros(2_000)),
            Duration::from_micros(500)
        );
        assert_eq!(timer_slack(Duration::ZERO), Duration::ZERO);
        // CHK2-D10 (shortest interval >= S - 2 ms) bounds the slack.
        assert!(TIMER_SLACK <= ms(2));
    }

    #[test]
    fn on_time_start_only_absorbs_timer_lateness() {
        let scan = ms(100);
        // Woken by the timer 0.6 ms or 1.7 ms late: counts as on time.
        assert_eq!(
            on_time_start(Some(Us(100_000)), Us(100_600), scan),
            Us(100_000)
        );
        assert_eq!(
            on_time_start(Some(Us(100_000)), Us(101_700), scan),
            Us(100_000)
        );
        // Exactly at the slack: still on time; beyond it: a real delay.
        assert_eq!(
            on_time_start(Some(Us(100_000)), Us(102_000), scan),
            Us(100_000)
        );
        assert_eq!(
            on_time_start(Some(Us(100_000)), Us(102_001), scan),
            Us(102_001)
        );
        assert_eq!(
            on_time_start(Some(Us(100_000)), Us(109_200), scan),
            Us(109_200)
        );
        // Not woken by the timer (link was busy, a command, a reply): `now`.
        assert_eq!(on_time_start(None, Us(100_600), scan), Us(100_600));
        // A target in the future cannot be a start.
        assert_eq!(
            on_time_start(Some(Us(120_000)), Us(109_200), scan),
            Us(109_200)
        );
    }

    /// The start rule with a given slack in microseconds (for comparisons in the model).
    fn start_with_slack(slack_us: u64) -> impl Fn(Option<Us>, Us, Duration) -> Us {
        move |target, now, _scan| match target {
            Some(t) if t <= now && now.0 <= t.0 + slack_us => t,
            _ => now,
        }
    }

    /// One poll alone on a link whose requests take `rtt_us`. The session sleeps until the
    /// next deadline and `wake(deadline)` says when the OS really woke it; `start` is the
    /// start rule for rule 4. Returns (mean, min, max) of the intervals between the
    /// physical send times, in microseconds.
    fn simulate(
        scan_ms: u64,
        rtt_us: u64,
        mut wake: impl FnMut(u64) -> u64,
        start: impl Fn(Option<Us>, Us, Duration) -> Us,
    ) -> (u64, u64, u64) {
        let scan = ms(scan_ms);
        let mut s = Scheduler::default();
        s.insert(PollId(1), scan, Us(0));
        s.set_running(PollId(1), true, Us(0));
        let mut now = Us(0);
        let mut starts = Vec::new();
        let mut target = None;
        while starts.len() < 2_000 {
            if let Some(id) = s.pick(now) {
                s.served(id, start(target, now, scan));
                starts.push(now.0);
                now = Us(now.0 + rtt_us);
                target = None;
            } else {
                let due = s.next_due().unwrap();
                now = Us(wake(due.0).max(due.0));
                target = Some(due);
            }
        }
        let gaps: Vec<u64> = starts.windows(2).map(|w| w[1] - w[0]).collect();
        let mean = (starts[starts.len() - 1] - starts[0]) / (starts.len() as u64 - 1);
        (
            mean,
            *gaps.iter().min().unwrap(),
            *gaps.iter().max().unwrap(),
        )
    }

    /// A timer that ends every sleep on the next multiple of `tick_us`, without jitter.
    fn tick_timer(tick_us: u64) -> impl FnMut(u64) -> u64 {
        move |due| due.div_ceil(tick_us) * tick_us
    }

    /// The wake-up pattern of a Tokio sleep on Windows with the 1 ms OS period (REV-008
    /// m-1), deterministic (a fixed pseudo-random sequence): Tokio rounds the deadline up to
    /// the next whole ms of its timer wheel and parks for whole ms from an unaligned
    /// instant (0 to 1 ms), then the OS wakes the thread on its next 1 ms period (0 to 1
    /// ms), and every 10th wake-up has a spike of up to 1 ms more. So a wake-up is 0 to 3 ms
    /// (the slack + 1 ms of rounding) after the deadline, mostly within 2 ms.
    fn tokio_timer(seed: u64) -> impl FnMut(u64) -> u64 {
        let mut state = seed;
        let mut n = 0u64;
        let mut next = move || {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            state >> 33
        };
        move |due| {
            n += 1;
            let rounding = next() % 1_000;
            let os = next() % 1_000;
            let spike = if n.is_multiple_of(10) {
                next() % 1_000
            } else {
                0
            };
            due + rounding + os + spike
        }
    }

    /// REPORT-006 D1 reproduced in virtual time: with the default 15.625 ms Windows tick,
    /// 100 ms becomes 109.4 ms and 20 ms 31.25 ms, with or without the slack (a coarse tick
    /// is fixed by the OS timer precision, not by the slack).
    #[test]
    fn a_coarse_os_tick_is_not_absorbed() {
        for slack in [0, 1_000, 2_000] {
            let rule = start_with_slack(slack);
            assert_eq!(
                simulate(100, 1_000, tick_timer(15_625), &rule).0,
                109_375,
                "D1 signature"
            );
            assert_eq!(
                simulate(20, 1_000, tick_timer(15_625), &rule).0,
                31_250,
                "D1 signature"
            );
        }
        assert_eq!(
            simulate(100, 1_000, tick_timer(15_625), on_time_start).0,
            109_375
        );
    }

    /// REV-008 m-1: with realistic wake-ups (Tokio's round-up to the next ms plus OS jitter,
    /// up to 3 ms late) the lateness does not add up: the mean stays within 0.25 ms of the
    /// scan rate (about +0.05 ms in this model), no interval is shorter than S - 2 ms
    /// (CHK2-D10) and none is longer than S + 3 ms. With the former 1 ms slack the same
    /// wake-ups add more than 0.4 ms to every mean (about +0.7 ms here; the real app showed
    /// +1.2 ms at 20 ms), so this test fails on that slack.
    #[test]
    fn timer_lateness_does_not_add_up() {
        for scan in [20u64, 50, 100, 250, 500] {
            let s_us = scan * 1000;
            for (rtt, seed) in [(300, 1), (1_000, 2), (1_700, 3)] {
                let (mean, min, max) = simulate(scan, rtt, tokio_timer(seed), on_time_start);
                assert!(mean >= s_us && mean <= s_us + 250, "{scan} ms: mean {mean}");
                assert!(min + 2_000 >= s_us, "{scan} ms: shortest {min}");
                assert!(max <= s_us + 3_000, "{scan} ms: longest {max}");
                let (old_mean, old_min, _) =
                    simulate(scan, rtt, tokio_timer(seed), start_with_slack(1_000));
                assert!(
                    old_mean > s_us + 400,
                    "{scan} ms: 1 ms slack gave {old_mean}"
                );
                assert!(old_min + 1_000 >= s_us);
                let (late_mean, _, _) = simulate(scan, rtt, tokio_timer(seed), start_with_slack(0));
                assert!(late_mean > old_mean, "{scan} ms: {late_mean} vs {old_mean}");
            }
        }
    }

    /// 16 polls with mixed scan rates, request times and timeouts on one link: requests
    /// never overlap (single link by construction), every poll is served within one pass
    /// over the others when overdue, and each poll's rate is honored when the link allows.
    ///
    /// REV-004: "due" and the waits are computed from an independent model (a poll is due
    /// once `now >= its last start + its scan rate`, or from the start when never served),
    /// not from the scheduler's own deadlines, and the wait is also bounded in time.
    #[test]
    fn sixteen_polls_mixed_rates_no_starvation() {
        let scans = [
            20u64, 50, 100, 100, 100, 200, 250, 500, 500, 1000, 1000, 2000, 30, 70, 150, 5000,
        ];
        let mut s = Scheduler::default();
        let ids: Vec<PollId> = (1..=16).map(PollId).collect();
        let scan_of: HashMap<PollId, u64> = ids.iter().copied().zip(scans).collect();
        for id in &ids {
            s.insert(*id, ms(scan_of[id]), Ms(0));
            s.set_running(*id, true, Ms(0));
        }
        // Poll 4 always times out (300 ms); others take 5-12 ms.
        let duration = |id: PollId, n: u64| -> u64 {
            if id == PollId(4) {
                300
            } else {
                5 + (u64::from(id.0) * 7 + n) % 8
            }
        };
        // The independent model: the last start of each poll.
        let mut last_start: HashMap<PollId, u64> = HashMap::new();
        let due_since = |last: &HashMap<PollId, u64>, id: PollId| -> u64 {
            last.get(&id).map_or(0, |t| t + scan_of[&id])
        };
        let mut now = 0u64;
        let mut busy_until = 0u64;
        let mut served: HashMap<PollId, Vec<u64>> = HashMap::new();
        let mut order: Vec<PollId> = Vec::new();
        let mut n = 0;
        // Requests started while a poll was due but not served (DES-002 7.5).
        let mut waited: HashMap<PollId, usize> = HashMap::new();
        let mut max_wait = 0;
        let mut max_wait_ms = 0u64;
        while now < 120_000 {
            assert!(now >= busy_until, "overlap");
            let due: Vec<PollId> = ids
                .iter()
                .copied()
                .filter(|id| due_since(&last_start, *id) <= now)
                .collect();
            match s.pick(Ms(now)) {
                Some(id) => {
                    assert!(due.contains(&id), "{id:?} picked before it was due");
                    for other in &due {
                        if *other == id {
                            waited.remove(&id);
                        } else {
                            let w = waited.entry(*other).or_default();
                            *w += 1;
                            max_wait = max_wait.max(*w);
                        }
                    }
                    max_wait_ms = max_wait_ms.max(now - due_since(&last_start, id));
                    s.served(id, Ms(now));
                    last_start.insert(id, now);
                    served.entry(id).or_default().push(now);
                    order.push(id);
                    n += 1;
                    busy_until = now + duration(id, n);
                    now = busy_until;
                }
                None => {
                    assert!(due.is_empty(), "idle while {due:?} were due");
                    now = s.next_due().unwrap().0;
                }
            }
        }
        // A due poll waits at most for the request in flight when it became due plus one
        // request of each of the other 15 polls: two 300 ms timeouts and 14 x 12 ms.
        assert!(
            max_wait_ms <= 300 + 300 + 14 * 12,
            "waited {max_wait_ms} ms"
        );
        // Every poll was served.
        assert_eq!(served.len(), 16);
        // No starvation: a due poll waits for at most the 15 other polls.
        assert!(max_wait <= 15, "a due poll waited {max_wait} requests");
        assert!(
            max_wait >= 2,
            "the link must be overloaded for this test to mean something"
        );
        assert!(order.len() > 1000);
        // Slow polls keep their scan rate, delayed by at most the request in flight when
        // they became due plus one pass over the others (the 300 ms timeout twice at most,
        // plus 15 requests of at most 12 ms).
        for (idx, id) in [(9usize, PollId(10)), (11, PollId(12)), (15, PollId(16))] {
            let starts = &served[&id];
            let mean = (starts.last().unwrap() - starts[0]) / (starts.len() as u64 - 1);
            let scan = scans[idx];
            assert!(
                mean >= scan && mean <= scan + 2 * 300 + 15 * 12,
                "{id:?}: mean {mean} vs {scan}"
            );
        }
        // The overloaded fast polls are slowed down but never by more than one pass.
        let starts = &served[&PollId(1)];
        let max_gap = starts.windows(2).map(|w| w[1] - w[0]).max().unwrap();
        assert!(max_gap <= 16 * 300, "{max_gap}");
    }
}
