//! The session state machine of DES-001 section 2: 9 states, transitions T1-T15, nothing else.

use shared_types::{
    BadResponseDetail, BadResponseKind, ExceptionCode, SessionReason, SessionState, StateChanged,
};
use thiserror::Error;

/// Inputs of the state machine (DES-001 section 2.2, "Event" column).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// User Connect (T1) or Reconnect (T14).
    Connect,
    /// T2.
    LinkUp,
    /// T3.
    ConnectFailed(SessionReason),
    /// T4.
    ConnectCancelled,
    /// Start / Resume (T5) or Apply while polling (T11).
    PollStarted,
    /// T6.
    CycleOk,
    /// T7.
    CycleTimeout,
    /// T8.
    CycleException(ExceptionCode),
    /// T9.
    CycleBadResponse(BadResponseKind, BadResponseDetail),
    /// T10.
    PollStopped,
    /// User Disconnect, link closed (T12).
    Closed,
    /// T13.
    LinkLost(SessionReason),
    /// User Dismiss (T15).
    Dismiss,
}

/// Transition ids of DES-001 section 2.2.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionId {
    T1,
    T2,
    T3,
    T4,
    T5,
    T6,
    T7,
    T8,
    T9,
    T10,
    T11,
    T12,
    T13,
    T14,
    T15,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("event {event} is not allowed in state {from:?}")]
pub struct IllegalTransition {
    pub from: SessionState,
    pub event: &'static str,
}

/// `polling | timeout | exception | badResponse` (DES "P*").
#[must_use]
pub fn is_poll_running(s: SessionState) -> bool {
    matches!(
        s,
        SessionState::Polling
            | SessionState::Timeout
            | SessionState::Exception
            | SessionState::BadResponse
    )
}

/// `connected | paused | P*` (DES "L*").
#[must_use]
pub fn is_link_up(s: SessionState) -> bool {
    matches!(s, SessionState::Connected | SessionState::Paused) || is_poll_running(s)
}

/// Current state plus the data the UI shows with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateMachine {
    state: SessionState,
    reason: Option<SessionReason>,
    consecutive_failures: u32,
    exception_code: Option<ExceptionCode>,
    bad_kind: Option<BadResponseKind>,
    bad_detail: Option<BadResponseDetail>,
    since: u64,
}

impl StateMachine {
    #[must_use]
    pub fn new(at: u64) -> Self {
        Self {
            state: SessionState::Idle,
            reason: None,
            consecutive_failures: 0,
            exception_code: None,
            bad_kind: None,
            bad_detail: None,
            since: at,
        }
    }

    #[must_use]
    pub fn state(&self) -> SessionState {
        self.state
    }

    /// The current state as a `StateChanged` payload.
    #[must_use]
    pub fn snapshot(&self) -> StateChanged {
        StateChanged {
            state: self.state,
            reason: self.reason.clone(),
            consecutive_failures: self.consecutive_failures,
            exception_code: self.exception_code,
            bad_response_kind: self.bad_kind,
            bad_response_detail: self.bad_detail.clone(),
            at: self.since,
        }
    }

    /// Applies `event` at time `at`.
    ///
    /// Returns the transition taken and whether the visible snapshot changed (a repeated
    /// T6 `polling -> polling` changes nothing and need not be emitted).
    ///
    /// # Errors
    /// [`IllegalTransition`] for any (state, event) pair outside T1-T15; the state is unchanged.
    pub fn apply(
        &mut self,
        event: Event,
        at: u64,
    ) -> Result<(TransitionId, bool), IllegalTransition> {
        use SessionState as S;
        use TransitionId as T;
        let from = self.state;
        let p_star = is_poll_running(from);
        let l_star = is_link_up(from);

        let (id, to) = match (&event, from) {
            (Event::Connect, S::Idle) => (T::T1, S::Connecting),
            (Event::Connect, S::Disconnected) => (T::T14, S::Connecting),
            (Event::LinkUp, S::Connecting) => (T::T2, S::Connected),
            (Event::ConnectFailed(_), S::Connecting) => (T::T3, S::Disconnected),
            (Event::ConnectCancelled, S::Connecting) => (T::T4, S::Idle),
            (Event::PollStarted, S::Connected | S::Paused) => (T::T5, S::Polling),
            (Event::PollStarted, _) if p_star => (T::T11, S::Polling),
            (Event::CycleOk, _) if p_star => (T::T6, S::Polling),
            (Event::CycleTimeout, _) if p_star => (T::T7, S::Timeout),
            (Event::CycleException(_), _) if p_star => (T::T8, S::Exception),
            (Event::CycleBadResponse(..), _) if p_star => (T::T9, S::BadResponse),
            (Event::PollStopped, _) if p_star => (T::T10, S::Paused),
            (Event::Closed, _) if l_star => (T::T12, S::Idle),
            (Event::LinkLost(_), _) if l_star => (T::T13, S::Disconnected),
            (Event::Dismiss, S::Disconnected) => (T::T15, S::Idle),
            _ => {
                return Err(IllegalTransition {
                    from,
                    event: event_name(&event),
                })
            }
        };

        let before = self.snapshot();
        let failures = match &event {
            Event::CycleTimeout if from == S::Timeout => {
                self.consecutive_failures.saturating_add(1)
            }
            Event::CycleException(code)
                if from == S::Exception && self.exception_code == Some(*code) =>
            {
                self.consecutive_failures.saturating_add(1)
            }
            Event::CycleBadResponse(kind, _)
                if from == S::BadResponse && self.bad_kind == Some(*kind) =>
            {
                self.consecutive_failures.saturating_add(1)
            }
            Event::CycleTimeout | Event::CycleException(_) | Event::CycleBadResponse(..) => 1,
            _ => 0,
        };
        self.state = to;
        self.consecutive_failures = failures;
        (
            self.reason,
            self.exception_code,
            self.bad_kind,
            self.bad_detail,
        ) = match event {
            Event::ConnectFailed(r) | Event::LinkLost(r) => (Some(r), None, None, None),
            Event::CycleException(code) => (None, Some(code), None, None),
            Event::CycleBadResponse(kind, detail) => (None, None, Some(kind), Some(detail)),
            _ => (None, None, None, None),
        };
        // `since` marks the last visible change; a repeated ok cycle does not move it.
        if from != to || id != T::T6 {
            self.since = at;
        }
        // Every transition is visible except a T6 that changes nothing (polling -> polling).
        let changed = id != T::T6 || self.snapshot() != before;
        Ok((id, changed))
    }
}

fn event_name(e: &Event) -> &'static str {
    match e {
        Event::Connect => "Connect",
        Event::LinkUp => "LinkUp",
        Event::ConnectFailed(_) => "ConnectFailed",
        Event::ConnectCancelled => "ConnectCancelled",
        Event::PollStarted => "PollStarted",
        Event::CycleOk => "CycleOk",
        Event::CycleTimeout => "CycleTimeout",
        Event::CycleException(_) => "CycleException",
        Event::CycleBadResponse(..) => "CycleBadResponse",
        Event::PollStopped => "PollStopped",
        Event::Closed => "Closed",
        Event::LinkLost(_) => "LinkLost",
        Event::Dismiss => "Dismiss",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared_types::{ReasonKind, ReasonPhase};
    use SessionState as S;
    use TransitionId as T;

    const ALL: [S; 9] = [
        S::Idle,
        S::Connecting,
        S::Connected,
        S::Polling,
        S::Paused,
        S::Timeout,
        S::Exception,
        S::BadResponse,
        S::Disconnected,
    ];
    const P_STAR: [S; 4] = [S::Polling, S::Timeout, S::Exception, S::BadResponse];
    const L_STAR: [S; 6] = [
        S::Connected,
        S::Paused,
        S::Polling,
        S::Timeout,
        S::Exception,
        S::BadResponse,
    ];

    fn reason(phase: ReasonPhase) -> SessionReason {
        SessionReason {
            kind: ReasonKind::Refused,
            phase,
            message: "x".into(),
        }
    }

    fn detail() -> BadResponseDetail {
        BadResponseDetail {
            expected: None,
            got: None,
            message: "m".into(),
        }
    }

    fn all_events() -> Vec<Event> {
        vec![
            Event::Connect,
            Event::LinkUp,
            Event::ConnectFailed(reason(ReasonPhase::ConnectFailed)),
            Event::ConnectCancelled,
            Event::PollStarted,
            Event::CycleOk,
            Event::CycleTimeout,
            Event::CycleException(ExceptionCode(2)),
            Event::CycleBadResponse(BadResponseKind::Crc, detail()),
            Event::PollStopped,
            Event::Closed,
            Event::LinkLost(reason(ReasonPhase::LinkLost)),
            Event::Dismiss,
        ]
    }

    fn machine_in(state: S) -> StateMachine {
        let mut m = StateMachine::new(0);
        m.state = state;
        m
    }

    /// DES-001 section 2.2: (transition, from states, event, to state).
    fn table() -> Vec<(T, Vec<S>, Event, S)> {
        vec![
            (T::T1, vec![S::Idle], Event::Connect, S::Connecting),
            (T::T2, vec![S::Connecting], Event::LinkUp, S::Connected),
            (
                T::T3,
                vec![S::Connecting],
                Event::ConnectFailed(reason(ReasonPhase::ConnectFailed)),
                S::Disconnected,
            ),
            (T::T4, vec![S::Connecting], Event::ConnectCancelled, S::Idle),
            (
                T::T5,
                vec![S::Connected, S::Paused],
                Event::PollStarted,
                S::Polling,
            ),
            (T::T6, P_STAR.to_vec(), Event::CycleOk, S::Polling),
            (T::T7, P_STAR.to_vec(), Event::CycleTimeout, S::Timeout),
            (
                T::T8,
                P_STAR.to_vec(),
                Event::CycleException(ExceptionCode(2)),
                S::Exception,
            ),
            (
                T::T9,
                P_STAR.to_vec(),
                Event::CycleBadResponse(BadResponseKind::Crc, detail()),
                S::BadResponse,
            ),
            (T::T10, P_STAR.to_vec(), Event::PollStopped, S::Paused),
            (T::T11, P_STAR.to_vec(), Event::PollStarted, S::Polling),
            (T::T12, L_STAR.to_vec(), Event::Closed, S::Idle),
            (
                T::T13,
                L_STAR.to_vec(),
                Event::LinkLost(reason(ReasonPhase::LinkLost)),
                S::Disconnected,
            ),
            (T::T14, vec![S::Disconnected], Event::Connect, S::Connecting),
            (T::T15, vec![S::Disconnected], Event::Dismiss, S::Idle),
        ]
    }

    #[test]
    fn every_transition_of_the_table() {
        for (id, froms, event, to) in table() {
            for from in froms {
                let mut m = machine_in(from);
                let (got, _) = m
                    .apply(event.clone(), 10)
                    .unwrap_or_else(|e| panic!("{id:?} from {from:?}: {e}"));
                assert_eq!(got, id, "from {from:?} with {event:?}");
                assert_eq!(m.state(), to, "{id:?} from {from:?}");
            }
        }
    }

    #[test]
    fn every_other_pair_is_illegal() {
        let table = table();
        for from in ALL {
            for event in all_events() {
                let allowed = table.iter().any(|(_, froms, e, _)| {
                    std::mem::discriminant(e) == std::mem::discriminant(&event)
                        && froms.contains(&from)
                });
                let mut m = machine_in(from);
                let before = m.clone();
                let result = m.apply(event.clone(), 10);
                assert_eq!(result.is_ok(), allowed, "{from:?} + {event:?}");
                if !allowed {
                    assert_eq!(m, before, "illegal transition changed state");
                }
            }
        }
    }

    #[test]
    fn consecutive_failure_counting() {
        let mut m = machine_in(S::Polling);
        for n in 1..=3 {
            m.apply(Event::CycleTimeout, n).unwrap();
            assert_eq!(m.snapshot().consecutive_failures, u32::try_from(n).unwrap());
        }
        m.apply(Event::CycleException(ExceptionCode(2)), 4).unwrap();
        assert_eq!(m.snapshot().consecutive_failures, 1);
        m.apply(Event::CycleException(ExceptionCode(2)), 5).unwrap();
        assert_eq!(m.snapshot().consecutive_failures, 2);
        // Same state, different code: counting restarts.
        m.apply(Event::CycleException(ExceptionCode(3)), 6).unwrap();
        assert_eq!(m.snapshot().consecutive_failures, 1);
        assert_eq!(m.snapshot().exception_code, Some(ExceptionCode(3)));
        m.apply(Event::CycleBadResponse(BadResponseKind::Crc, detail()), 7)
            .unwrap();
        m.apply(Event::CycleBadResponse(BadResponseKind::Crc, detail()), 8)
            .unwrap();
        assert_eq!(m.snapshot().consecutive_failures, 2);
        assert_eq!(m.snapshot().exception_code, None);
        m.apply(Event::CycleOk, 9).unwrap();
        let s = m.snapshot();
        assert_eq!(
            (s.consecutive_failures, s.bad_response_kind, s.at),
            (0, None, 9)
        );
    }

    #[test]
    fn failure_count_saturates() {
        // REV-001 N3: no overflow panic after 2^32 failed cycles.
        let mut m = machine_in(S::Timeout);
        m.consecutive_failures = u32::MAX;
        m.apply(Event::CycleTimeout, 1).unwrap();
        assert_eq!(m.snapshot().consecutive_failures, u32::MAX);
    }
    #[test]
    fn repeated_ok_cycle_is_not_a_visible_change() {
        let mut m = machine_in(S::Polling);
        assert_eq!(m.apply(Event::CycleOk, 5).unwrap(), (T::T6, false));
        assert_eq!(m.snapshot().at, 0);
        assert_eq!(m.apply(Event::PollStarted, 6).unwrap(), (T::T11, true));
    }

    #[test]
    fn reason_is_kept_only_in_disconnected() {
        let mut m = machine_in(S::Connecting);
        m.apply(Event::ConnectFailed(reason(ReasonPhase::ConnectFailed)), 1)
            .unwrap();
        assert!(m.snapshot().reason.is_some());
        m.apply(Event::Connect, 2).unwrap();
        assert!(m.snapshot().reason.is_none());
    }
}
