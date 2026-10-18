//! Connection state machine of DES-002 section 1.3: 4 states, transitions C1-C7, nothing else.
//! Poll failures never reach this machine; only socket or port errors cause C6.

use shared_types::{ConnectionConfig, ConnectionState, ConnectionStatus, SessionReason};
use thiserror::Error;

/// Inputs of the connection machine (DES-002 1.3, "Event" column).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnEvent {
    /// User Connect / Reconnect (C1).
    Connect,
    /// C2.
    LinkUp,
    /// C3.
    ConnectFailed(SessionReason),
    /// User Cancel while connecting (C4).
    Cancel,
    /// User Disconnect (C5).
    Disconnect,
    /// C6.
    LinkLost(SessionReason),
    /// User Dismiss (C7).
    Dismiss,
}

/// Transition ids of DES-002 1.3.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnTransition {
    C1,
    C2,
    C3,
    C4,
    C5,
    C6,
    C7,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("connection event {event} is not allowed in state {from:?}")]
pub struct IllegalConnTransition {
    pub from: ConnectionState,
    pub event: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionMachine {
    state: ConnectionState,
    reason: Option<SessionReason>,
    since: u64,
}

impl ConnectionMachine {
    #[must_use]
    pub fn new(at: u64) -> Self {
        Self {
            state: ConnectionState::Idle,
            reason: None,
            since: at,
        }
    }

    #[must_use]
    pub fn state(&self) -> ConnectionState {
        self.state
    }

    #[must_use]
    pub fn is_connected(&self) -> bool {
        self.state == ConnectionState::Connected
    }

    #[must_use]
    pub fn status(&self, config: Option<&ConnectionConfig>) -> ConnectionStatus {
        ConnectionStatus {
            state: self.state,
            reason: self.reason.clone(),
            config: config.cloned(),
            at: self.since,
        }
    }

    /// Applies `event` at `at`. Every legal transition is a visible change.
    ///
    /// # Errors
    /// [`IllegalConnTransition`] for any pair outside C1-C7; the state is unchanged.
    pub fn apply(
        &mut self,
        event: ConnEvent,
        at: u64,
    ) -> Result<ConnTransition, IllegalConnTransition> {
        use ConnTransition as T;
        use ConnectionState as S;
        let (id, to) = match (&event, self.state) {
            (ConnEvent::Connect, S::Idle | S::Disconnected) => (T::C1, S::Connecting),
            (ConnEvent::LinkUp, S::Connecting) => (T::C2, S::Connected),
            (ConnEvent::ConnectFailed(_), S::Connecting) => (T::C3, S::Disconnected),
            (ConnEvent::Cancel, S::Connecting) => (T::C4, S::Idle),
            (ConnEvent::Disconnect, S::Connected) => (T::C5, S::Idle),
            (ConnEvent::LinkLost(_), S::Connected) => (T::C6, S::Disconnected),
            (ConnEvent::Dismiss, S::Disconnected) => (T::C7, S::Idle),
            _ => {
                return Err(IllegalConnTransition {
                    from: self.state,
                    event: event_name(&event),
                })
            }
        };
        self.state = to;
        self.reason = match event {
            ConnEvent::ConnectFailed(r) | ConnEvent::LinkLost(r) => Some(r),
            _ => None,
        };
        self.since = at;
        Ok(id)
    }
}

fn event_name(e: &ConnEvent) -> &'static str {
    match e {
        ConnEvent::Connect => "Connect",
        ConnEvent::LinkUp => "LinkUp",
        ConnEvent::ConnectFailed(_) => "ConnectFailed",
        ConnEvent::Cancel => "Cancel",
        ConnEvent::Disconnect => "Disconnect",
        ConnEvent::LinkLost(_) => "LinkLost",
        ConnEvent::Dismiss => "Dismiss",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared_types::{ReasonKind, ReasonPhase};
    use ConnTransition as T;
    use ConnectionState as S;

    const ALL: [S; 4] = [S::Idle, S::Connecting, S::Connected, S::Disconnected];

    fn reason(phase: ReasonPhase) -> SessionReason {
        SessionReason {
            kind: ReasonKind::Refused,
            phase,
            message: "x".into(),
        }
    }

    fn events() -> Vec<ConnEvent> {
        vec![
            ConnEvent::Connect,
            ConnEvent::LinkUp,
            ConnEvent::ConnectFailed(reason(ReasonPhase::ConnectFailed)),
            ConnEvent::Cancel,
            ConnEvent::Disconnect,
            ConnEvent::LinkLost(reason(ReasonPhase::LinkLost)),
            ConnEvent::Dismiss,
        ]
    }

    /// DES-002 1.3: (transition, from states, event, to state).
    fn table() -> Vec<(T, Vec<S>, ConnEvent, S)> {
        vec![
            (
                T::C1,
                vec![S::Idle, S::Disconnected],
                ConnEvent::Connect,
                S::Connecting,
            ),
            (T::C2, vec![S::Connecting], ConnEvent::LinkUp, S::Connected),
            (
                T::C3,
                vec![S::Connecting],
                ConnEvent::ConnectFailed(reason(ReasonPhase::ConnectFailed)),
                S::Disconnected,
            ),
            (T::C4, vec![S::Connecting], ConnEvent::Cancel, S::Idle),
            (T::C5, vec![S::Connected], ConnEvent::Disconnect, S::Idle),
            (
                T::C6,
                vec![S::Connected],
                ConnEvent::LinkLost(reason(ReasonPhase::LinkLost)),
                S::Disconnected,
            ),
            (T::C7, vec![S::Disconnected], ConnEvent::Dismiss, S::Idle),
        ]
    }

    fn machine_in(state: S) -> ConnectionMachine {
        let mut m = ConnectionMachine::new(0);
        m.state = state;
        m
    }

    #[test]
    fn every_transition_of_the_table() {
        for (id, froms, event, to) in table() {
            for from in froms {
                let mut m = machine_in(from);
                let got = m
                    .apply(event.clone(), 10)
                    .unwrap_or_else(|e| panic!("{id:?} from {from:?}: {e}"));
                assert_eq!(got, id);
                assert_eq!(m.state(), to, "{id:?} from {from:?}");
                assert_eq!(m.status(None).at, 10);
            }
        }
    }

    #[test]
    fn every_other_pair_is_illegal_and_changes_nothing() {
        let table = table();
        for from in ALL {
            for event in events() {
                let allowed = table.iter().any(|(_, froms, e, _)| {
                    std::mem::discriminant(e) == std::mem::discriminant(&event)
                        && froms.contains(&from)
                });
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
    fn reason_only_in_disconnected() {
        let mut m = machine_in(S::Connecting);
        m.apply(
            ConnEvent::ConnectFailed(reason(ReasonPhase::ConnectFailed)),
            1,
        )
        .unwrap();
        assert!(m.status(None).reason.is_some());
        m.apply(ConnEvent::Connect, 2).unwrap();
        assert!(m.status(None).reason.is_none());
    }
}
