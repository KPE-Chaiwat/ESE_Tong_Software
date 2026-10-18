//! The OS timer precision of the poll scheduler (DES-002 R10-1, REPORT-006 defect D1):
//! [`SystemTimerResolution`] implements `modbus_master::TimerResolution` per OS (CLAUDE.md
//! rule 4) and is injected into every session through `SessionDeps.timer`
//! (`commands::modbus_master`). It lives in this thin layer so that `modbus-master` keeps
//! the workspace `unsafe_code = "forbid"` (REV-008 m-4).
//!
//! Why: Tokio sleeps park the runtime with a millisecond timeout. On Windows such a wait
//! ends on the next tick of the system timer, which is 15.625 ms by default, so a poll
//! with scan S waited `ceil((S + d) / 15.6) x 15.6` ms (100 ms became 109.2 ms, 20 ms
//! became 31.2 ms). While a session has a running poll it holds a 1 ms timer period
//! (`timeBeginPeriod(1)`, paired with `timeEndPeriod(1)` when the last poll stops, the link
//! goes down or the session ends; the pairing is `modbus_master`'s `PrecisionHold`).
//!
//! CPU: this is no busy wait. The session task still sleeps until the next deadline; only
//! the wake-up of that sleep is accurate to about 1 ms instead of 15.6 ms. The process
//! wakes when a request is due (at most a few hundred times per second for 16 fast polls)
//! and the raised period is held only while polls run. Since Windows 10 2004 the request
//! affects only this process. Windows 11 ignores it for processes whose windows are all
//! minimized or hidden unless the process opts out of that power-throttling rule, which
//! the Windows implementation does once (`PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION`
//! cleared), because polling must keep its rate while the windows are minimized. The
//! opt-out is process-wide and deliberately stays set after polling stops: it only has an
//! effect while a `timeBeginPeriod` request is active, so there is nothing to pair it with
//! (REV-008 n-5).
//!
//! Other systems: a no-op (Linux and macOS timers are already sub-millisecond).

use modbus_master::TimerResolution;

/// The implementation for the current operating system.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemTimerResolution;

#[cfg(windows)]
impl TimerResolution for SystemTimerResolution {
    fn acquire(&self) {
        win::begin();
    }

    fn release(&self) {
        win::end();
    }
}

#[cfg(not(windows))]
impl TimerResolution for SystemTimerResolution {
    fn acquire(&self) {}

    fn release(&self) {}
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod win {
    //! Unsafe code allowed by the workspace policy (root `Cargo.toml`, `[workspace.lints]`):
    //! two winmm calls and one kernel32 call, all with plain integer or stack-struct
    //! arguments.

    use std::sync::Once;

    use windows_sys::Win32::Media::{timeBeginPeriod, timeEndPeriod};
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, ProcessPowerThrottling, SetProcessInformation,
        PROCESS_POWER_THROTTLING_CURRENT_VERSION, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
        PROCESS_POWER_THROTTLING_STATE,
    };

    /// The requested timer period in ms (the smallest Windows supports).
    const PERIOD_MS: u32 = 1;

    static KEEP_RESOLUTION_WHEN_HIDDEN: Once = Once::new();

    pub(super) fn begin() {
        KEEP_RESOLUTION_WHEN_HIDDEN.call_once(|| {
            // ControlMask selects the rule, StateMask 0 turns it off: the timer resolution
            // request stays in effect while every window of the app is minimized. Failure
            // (older Windows) is harmless: the request still works while a window shows.
            let state = PROCESS_POWER_THROTTLING_STATE {
                Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                ControlMask: PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
                StateMask: 0,
            };
            // SAFETY: the pseudo handle of the current process is always valid; `state`
            // lives on the stack for the duration of the call and its size is passed.
            unsafe {
                SetProcessInformation(
                    GetCurrentProcess(),
                    ProcessPowerThrottling,
                    std::ptr::from_ref(&state).cast(),
                    u32::try_from(std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>())
                        .unwrap_or(0),
                );
            }
        });
        // SAFETY: no pointers; the OS counts the requests of the process. A failure
        // (TIMERR_NOCANDO) only leaves the default period.
        unsafe {
            timeBeginPeriod(PERIOD_MS);
        }
    }

    pub(super) fn end() {
        // SAFETY: no pointers; paired with exactly one earlier `begin` (see `PrecisionHold`
        // in modbus-master).
        unsafe {
            timeEndPeriod(PERIOD_MS);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_implementation_can_be_called_in_pairs() {
        let t = SystemTimerResolution;
        t.acquire();
        t.acquire();
        t.release();
        t.release();
    }
}
