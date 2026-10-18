//! Per-poll state machine of DES-002 section 1.4: 6 states, transitions PT0-PT8.
//!
//! PT0 (poll added) is [`PollMachine::added`]; PT8 (poll deleted) removes the machine and is
//! handled by the session. Hosting (pop out, dock, close, minimize) never reaches this
//! machine (DES-002 1.4, "Hosting never changes a poll state").

use shared_types::{
    BadResponseDetail, BadResponseKind, ExceptionCode, PollId, PollState, PollStatus,
};
use thiserror::Error;

/// Inputs of a poll machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PollEvent {
    /// The connection went up (C2). `start` = `active && autoStartPoll` (PT1 / PT2).
    LinkUp {
        start: bool,
    },
    /// User Resume (PT3).
    Resume,
    /// User Pause (PT4).
    Pause,
    /// Cycle results (PT5).
    CycleOk,
    CycleTimeout,
    CycleException(ExceptionCode),
    CycleBadResponse(BadResponseKind, BadResponseDetail),
    /// User Apply with a changed definition (PT6 while running, PT6b otherwise).
    Apply,
    /// The connection went down (C5 / C6): PT7.
    LinkDown,
}

/// Transition ids of DES-002 1.4.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PollTransition {
    PT1,
    PT2,
    PT3,
    PT4,
    PT5,
    PT6,
    PT6b,
    PT7,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("poll event {event} is not allowed in state {from:?}")]
pub struct IllegalPollTransition {
    pub from: PollState,
    pub event: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PollMachine {
    state: PollState,
    consecutive_failures: u32,
    exception_code: Option<ExceptionCode>,
    bad_kind: Option<BadResponseKind>,
    bad_detail: Option<BadResponseDetail>,
    since: u64,
}

impl PollMachine {
    /// PT0: `offline` without a link; with a link `polling` when `start`, else `paused`.
    #[must_use]
    pub fn added(connected: bool, start: bool, at: u64) -> Self {
        let state = match (connected, start) {
            (false, _) => PollState::Offline,
            (true, true) => PollState::Polling,
            (true, false) => PollState::Paused,
        };
        Self {
            state,
            consecutive_failures: 0,
            exception_code: None,
            bad_kind: None,
            bad_detail: None,
            since: at,
        }
    }

    #[must_use]
    pub fn state(&self) -> PollState {
        self.state
    }

    #[must_use]
    pub fn status(&self, poll_id: PollId) -> PollStatus {
        PollStatus {
            poll_id,
            state: self.state,
            consecutive_failures: self.consecutive_failures,
            exception_code: self.exception_code,
            bad_response_kind: self.bad_kind,
            bad_response_detail: self.bad_detail.clone(),
            at: self.since,
        }
    }

    /// Applies `event` at `at`. Returns the transition and whether the visible status
    /// changed (a repeated ok cycle and PT6b change nothing the UI must hear about).
    ///
    /// # Errors
    /// [`IllegalPollTransition`] for any pair outside PT1-PT7; the state is unchanged.
    pub fn apply(
        &mut self,
        event: PollEvent,
        at: u64,
    ) -> Result<(PollTransition, bool), IllegalPollTransition> {
        use PollState as S;
        use PollTransition as T;
        let from = self.state;
        let running = from.is_running();
        let (id, to) = match (&event, from) {
            (PollEvent::LinkUp { start: false }, S::Offline) => (T::PT1, S::Paused),
            (PollEvent::LinkUp { start: true }, S::Offline) => (T::PT2, S::Polling),
            (PollEvent::Resume, S::Paused) => (T::PT3, S::Polling),
            (PollEvent::Pause, _) if running => (T::PT4, S::Paused),
            (PollEvent::CycleOk, _) if running => (T::PT5, S::Polling),
            (PollEvent::CycleTimeout, _) if running => (T::PT5, S::Timeout),
            (PollEvent::CycleException(_), _) if running => (T::PT5, S::Exception),
            (PollEvent::CycleBadResponse(..), _) if running => (T::PT5, S::BadResponse),
            (PollEvent::Apply, _) if running => (T::PT6, S::Polling),
            (PollEvent::Apply, S::Paused | S::Offline) => (T::PT6b, from),
            (PollEvent::LinkDown, _) if running || from == S::Paused => (T::PT7, S::Offline),
            _ => {
                return Err(IllegalPollTransition {
                    from,
                    event: event_name(&event),
                })
            }
        };
        if id == T::PT6b {
            return Ok((id, false));
        }
        let before = self.status(PollId(0));
        let failures = match &event {
            PollEvent::CycleTimeout if from == S::Timeout => {
                self.consecutive_failures.saturating_add(1)
            }
            PollEvent::CycleException(code)
                if from == S::Exception && self.exception_code == Some(*code) =>
            {
                self.consecutive_failures.saturating_add(1)
            }
            PollEvent::CycleBadResponse(kind, _)
                if from == S::BadResponse && self.bad_kind == Some(*kind) =>
            {
                self.consecutive_failures.saturating_add(1)
            }
            PollEvent::CycleTimeout
            | PollEvent::CycleException(_)
            | PollEvent::CycleBadResponse(..) => 1,
            _ => 0,
        };
        self.state = to;
        self.consecutive_failures = failures;
        (self.exception_code, self.bad_kind, self.bad_detail) = match event {
            PollEvent::CycleException(code) => (Some(code), None, None),
            PollEvent::CycleBadResponse(kind, detail) => (None, Some(kind), Some(detail)),
            _ => (None, None, None),
        };
        // A repeated ok cycle (polling -> polling) is the only invisible transition.
        let repeated_ok = id == T::PT5 && from == S::Polling && to == S::Polling;
        if !repeated_ok {
            self.since = at;
        }
        let changed = !repeated_ok || self.status(PollId(0)) != before;
        Ok((id, changed))
    }
}

fn event_name(e: &PollEvent) -> &'static str {
    match e {
        PollEvent::LinkUp { .. } => "LinkUp",
        PollEvent::Resume => "Resume",
        PollEvent::Pause => "Pause",
        PollEvent::CycleOk => "CycleOk",
        PollEvent::CycleTimeout => "CycleTimeout",
        PollEvent::CycleException(_) => "CycleException",
        PollEvent::CycleBadResponse(..) => "CycleBadResponse",
        PollEvent::Apply => "Apply",
        PollEvent::LinkDown => "LinkDown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use PollState as S;
    use PollTransition as T;

    const ALL: [S; 6] = [
        S::Offline,
        S::Paused,
        S::Polling,
        S::Timeout,
        S::Exception,
        S::BadResponse,
    ];
    const P_STAR: [S; 4] = [S::Polling, S::Timeout, S::Exception, S::BadResponse];

    fn detail() -> BadResponseDetail {
        BadResponseDetail {
            expected: None,
            got: None,
            message: "m".into(),
        }
    }

    fn events() -> Vec<PollEvent> {
        vec![
            PollEvent::LinkUp { start: false },
            PollEvent::LinkUp { start: true },
            PollEvent::Resume,
            PollEvent::Pause,
            PollEvent::CycleOk,
            PollEvent::CycleTimeout,
            PollEvent::CycleException(ExceptionCode(2)),
            PollEvent::CycleBadResponse(BadResponseKind::Crc, detail()),
            PollEvent::Apply,
            PollEvent::LinkDown,
        ]
    }

    fn machine_in(state: S) -> PollMachine {
        let mut m = PollMachine::added(false, false, 0);
        m.state = state;
        m
    }

    /// DES-002 1.4: (transition, from states, event, to state; `None` = unchanged).
    fn table() -> Vec<(T, Vec<S>, PollEvent, Option<S>)> {
        let mut paused_and_running = P_STAR.to_vec();
        paused_and_running.push(S::Paused);
        vec![
            (
                T::PT1,
                vec![S::Offline],
                PollEvent::LinkUp { start: false },
                Some(S::Paused),
            ),
            (
                T::PT2,
                vec![S::Offline],
                PollEvent::LinkUp { start: true },
                Some(S::Polling),
            ),
            (T::PT3, vec![S::Paused], PollEvent::Resume, Some(S::Polling)),
            (T::PT4, P_STAR.to_vec(), PollEvent::Pause, Some(S::Paused)),
            (
                T::PT5,
                P_STAR.to_vec(),
                PollEvent::CycleOk,
                Some(S::Polling),
            ),
            (
                T::PT5,
                P_STAR.to_vec(),
                PollEvent::CycleTimeout,
                Some(S::Timeout),
            ),
            (
                T::PT5,
                P_STAR.to_vec(),
                PollEvent::CycleException(ExceptionCode(2)),
                Some(S::Exception),
            ),
            (
                T::PT5,
                P_STAR.to_vec(),
                PollEvent::CycleBadResponse(BadResponseKind::Crc, detail()),
                Some(S::BadResponse),
            ),
            (T::PT6, P_STAR.to_vec(), PollEvent::Apply, Some(S::Polling)),
            (T::PT6b, vec![S::Paused, S::Offline], PollEvent::Apply, None),
            (
                T::PT7,
                paused_and_running,
                PollEvent::LinkDown,
                Some(S::Offline),
            ),
        ]
    }

    fn same_event(a: &PollEvent, b: &PollEvent) -> bool {
        match (a, b) {
            (PollEvent::LinkUp { start: x }, PollEvent::LinkUp { start: y }) => x == y,
            _ => std::mem::discriminant(a) == std::mem::discriminant(b),
        }
    }

    #[test]
    fn added_is_pt0() {
        assert_eq!(PollMachine::added(false, true, 0).state(), S::Offline);
        assert_eq!(PollMachine::added(true, true, 0).state(), S::Polling);
        assert_eq!(PollMachine::added(true, false, 0).state(), S::Paused);
    }

    #[test]
    fn every_transition_of_the_table() {
        for (id, froms, event, to) in table() {
            for from in froms {
                let mut m = machine_in(from);
                let (got, changed) = m
                    .apply(event.clone(), 10)
                    .unwrap_or_else(|e| panic!("{id:?} from {from:?}: {e}"));
                assert_eq!(got, id, "{from:?} + {event:?}");
                assert_eq!(m.state(), to.unwrap_or(from), "{id:?} from {from:?}");
                assert_eq!(
                    changed,
                    id != T::PT6b && !(from == S::Polling && event == PollEvent::CycleOk)
                );
            }
        }
    }

    #[test]
    fn every_other_pair_is_illegal_and_changes_nothing() {
        let table = table();
        for from in ALL {
            for event in events() {
                let allowed = table
                    .iter()
                    .any(|(_, froms, e, _)| same_event(e, &event) && froms.contains(&from));
                let mut m = machine_in(from);
                let before = m.clone();
                assert_eq!(
                    m.apply(event.clone(), 10).is_ok(),
                    allowed,
                    "{from:?} + {event:?}"
                );
                if !allowed {
                    assert_eq!(m, before);
                }
            }
        }
    }

    #[test]
    fn failure_counting_per_poll() {
        let mut m = machine_in(S::Polling);
        for n in 1..=3u32 {
            m.apply(PollEvent::CycleTimeout, u64::from(n)).unwrap();
            assert_eq!(m.status(PollId(1)).consecutive_failures, n);
        }
        m.apply(PollEvent::CycleException(ExceptionCode(2)), 4)
            .unwrap();
        m.apply(PollEvent::CycleException(ExceptionCode(2)), 5)
            .unwrap();
        assert_eq!(m.status(PollId(1)).consecutive_failures, 2);
        m.apply(PollEvent::CycleException(ExceptionCode(3)), 6)
            .unwrap();
        assert_eq!(m.status(PollId(1)).consecutive_failures, 1);
        m.apply(
            PollEvent::CycleBadResponse(BadResponseKind::Crc, detail()),
            7,
        )
        .unwrap();
        m.apply(
            PollEvent::CycleBadResponse(BadResponseKind::Crc, detail()),
            8,
        )
        .unwrap();
        let s = m.status(PollId(1));
        assert_eq!((s.consecutive_failures, s.exception_code), (2, None));
        m.apply(PollEvent::CycleOk, 9).unwrap();
        let s = m.status(PollId(9));
        assert_eq!(
            (s.poll_id, s.consecutive_failures, s.bad_response_kind, s.at),
            (PollId(9), 0, None, 9)
        );
        // Repeated ok: invisible, `at` stays.
        assert_eq!(m.apply(PollEvent::CycleOk, 20).unwrap(), (T::PT5, false));
        assert_eq!(m.status(PollId(9)).at, 9);
        // Saturation.
        let mut m = machine_in(S::Timeout);
        m.consecutive_failures = u32::MAX;
        m.apply(PollEvent::CycleTimeout, 1).unwrap();
        assert_eq!(m.status(PollId(1)).consecutive_failures, u32::MAX);
    }

    #[test]
    fn apply_while_polling_is_visible_restart() {
        let mut m = machine_in(S::Timeout);
        m.consecutive_failures = 4;
        assert_eq!(m.apply(PollEvent::Apply, 3).unwrap(), (T::PT6, true));
        assert_eq!(m.status(PollId(1)).consecutive_failures, 0);
        let mut m = machine_in(S::Polling);
        assert_eq!(m.apply(PollEvent::Apply, 3).unwrap(), (T::PT6, true));
        assert_eq!(m.status(PollId(1)).at, 3);
    }
}
