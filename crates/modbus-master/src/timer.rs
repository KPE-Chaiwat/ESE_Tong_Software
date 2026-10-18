//! OS timer precision for the poll scheduler (DES-002 R10-1, REPORT-006 defect D1): the
//! trait the session uses, a no-op default and the pairing logic. The OS implementations
//! live in the application (`apps/desktop/src-tauri/src/os_timer.rs`, injected through
//! `SessionDeps.timer`), so this crate contains no OS calls and no unsafe code
//! (CLAUDE.md rules 1 and 4; REV-008 m-4).
//!
//! Why: Tokio sleeps park the runtime with a millisecond timeout. On Windows such a wait
//! ends on the next tick of the system timer, which is 15.625 ms by default, so a poll
//! with scan S waited `ceil((S + d) / 15.6) x 15.6` ms (100 ms became 109.2 ms, 20 ms
//! became 31.2 ms). While a session has a running poll it asks the OS for a 1 ms timer
//! period through [`TimerResolution::acquire`], paired with [`TimerResolution::release`]
//! when the last poll stops, the link goes down or the session ends ([`PrecisionHold`]).
//!
//! CPU: this is no busy wait. The session task still sleeps until the next deadline; only
//! the wake-up of that sleep is more accurate.

/// Raises the process timer precision. Calls are paired: every `acquire` is followed by
/// exactly one `release`. Implementations must be cheap and must not block.
pub trait TimerResolution: Send + Sync + 'static {
    fn acquire(&self);
    fn release(&self);
}

/// Leaves the OS timer as it is: the default of `SessionDeps` (tests, tools, and systems
/// whose timers are already sub-millisecond). The desktop app injects its OS
/// implementation.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoTimerResolution;

impl TimerResolution for NoTimerResolution {
    fn acquire(&self) {}

    fn release(&self) {}
}

/// Holds the raised precision while `set(true)` and gives it back on `set(false)` or drop.
pub(crate) struct PrecisionHold {
    timer: std::sync::Arc<dyn TimerResolution>,
    held: bool,
}

impl PrecisionHold {
    pub(crate) fn new(timer: std::sync::Arc<dyn TimerResolution>) -> Self {
        Self { timer, held: false }
    }

    /// Acquires or releases on a change only.
    pub(crate) fn set(&mut self, want: bool) {
        if want != self.held {
            self.held = want;
            if want {
                self.timer.acquire();
            } else {
                self.timer.release();
            }
        }
    }
}

impl Drop for PrecisionHold {
    fn drop(&mut self) {
        self.set(false);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::sync::Arc;

    use super::*;

    #[derive(Default)]
    struct Count(AtomicI32, AtomicI32);

    impl TimerResolution for Count {
        fn acquire(&self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
        fn release(&self) {
            self.1.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn hold_pairs_acquire_and_release() {
        let count = Arc::new(Count::default());
        let mut hold = PrecisionHold::new(count.clone());
        hold.set(false);
        assert_eq!(count.0.load(Ordering::SeqCst), 0);
        hold.set(true);
        hold.set(true);
        assert_eq!(count.0.load(Ordering::SeqCst), 1, "only on a change");
        hold.set(false);
        assert_eq!(count.1.load(Ordering::SeqCst), 1);
        hold.set(true);
        drop(hold);
        assert_eq!(count.0.load(Ordering::SeqCst), 2);
        assert_eq!(count.1.load(Ordering::SeqCst), 2, "released on drop");
    }

    #[test]
    fn the_default_does_nothing() {
        let t = NoTimerResolution;
        t.acquire();
        t.release();
    }
}
