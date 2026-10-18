//! Window kinds and labels (one connection window per tool instance, one native window per
//! popped-out poll).

use shared_types::PollId;

/// Label of the launcher window declared in `tauri.conf.json`.
#[allow(dead_code)]
pub const LAUNCHER_WINDOW_LABEL: &str = "main";

/// Offset of a new tool window from the window that opened it (DES-001 section 5.4).
pub const NEW_WINDOW_OFFSET: f64 = 24.0;

/// A tool that can be opened in its own window.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ToolWindow {
    pub id: &'static str,
    pub title: &'static str,
    /// Frontend route, without the leading slash.
    pub route: &'static str,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

/// Tools known to the backend. Window labels are `<id>-<n>`; `capabilities/default.json`
/// must allow `<id>-*` (which also covers the poll windows `<id>-<n>-poll-<pollId>`).
pub const TOOLS: &[ToolWindow] = &[ToolWindow {
    id: "modbus-master",
    title: "Modbus Master",
    route: "tools/modbus-master",
    width: 1280.0,
    height: 800.0,
    min_width: 960.0,
    min_height: 600.0,
}];

#[must_use]
pub fn find_tool(id: &str) -> Option<&'static ToolWindow> {
    TOOLS.iter().find(|t| t.id == id)
}

/// The native poll window W2 (DES-002 2.6): default 900 x 640, minimum 480 x 320.
pub const POLL_WINDOW: ToolWindow = ToolWindow {
    id: "modbus-master-poll",
    title: "Poll",
    route: "tools/modbus-master/poll",
    width: 900.0,
    height: 640.0,
    min_width: 480.0,
    min_height: 320.0,
};

const POLL_LABEL_INFIX: &str = "-poll-";

/// `modbus-master-<n>-poll-<pollId>`.
#[must_use]
pub fn poll_window_label(connection_label: &str, id: PollId) -> String {
    format!("{connection_label}{POLL_LABEL_INFIX}{id}")
}

/// The route of a poll window: `/tools/modbus-master/poll?pollId=<pollId>`.
#[must_use]
pub fn poll_window_route(id: PollId) -> String {
    format!("{}?pollId={id}", POLL_WINDOW.route)
}

/// `(connection window label, poll id)` of a poll window label.
#[must_use]
pub fn parse_poll_window_label(label: &str) -> Option<(&str, PollId)> {
    let (base, id) = label.rsplit_once(POLL_LABEL_INFIX)?;
    if base.is_empty() || base.contains(POLL_LABEL_INFIX) || id.starts_with('+') {
        return None;
    }
    id.parse().ok().map(|id| (base, PollId(id)))
}

/// The connection window (session key) of any Modbus Master window label.
#[must_use]
pub fn connection_label(label: &str) -> &str {
    parse_poll_window_label(label).map_or(label, |(base, _)| base)
}

/// True when `label` is a poll window of the connection window `connection`.
#[must_use]
pub fn is_poll_window_of(label: &str, connection: &str) -> bool {
    parse_poll_window_label(label).is_some_and(|(base, _)| base == connection)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modbus_master_window_matches_des_001() {
        let t = find_tool("modbus-master").unwrap();
        assert_eq!(
            (t.width, t.height, t.min_width, t.min_height),
            (1280.0, 800.0, 960.0, 600.0)
        );
        assert_eq!(t.route, "tools/modbus-master");
        assert!(find_tool("ip-scanner").is_none());
    }

    #[test]
    fn poll_window_matches_des_002() {
        assert_eq!((POLL_WINDOW.width, POLL_WINDOW.height), (900.0, 640.0));
        assert_eq!(
            (POLL_WINDOW.min_width, POLL_WINDOW.min_height),
            (480.0, 320.0)
        );
        assert_eq!(
            poll_window_route(PollId(5)),
            "tools/modbus-master/poll?pollId=5"
        );
    }

    #[test]
    fn poll_window_labels() {
        let l = poll_window_label("modbus-master-3", PollId(12));
        assert_eq!(l, "modbus-master-3-poll-12");
        assert_eq!(
            parse_poll_window_label(&l),
            Some(("modbus-master-3", PollId(12)))
        );
        assert_eq!(connection_label(&l), "modbus-master-3");
        assert_eq!(connection_label("modbus-master-3"), "modbus-master-3");
        assert!(is_poll_window_of(&l, "modbus-master-3"));
        assert!(!is_poll_window_of(&l, "modbus-master-31"));
        assert!(!is_poll_window_of(
            "modbus-master-31-poll-1",
            "modbus-master-3"
        ));
        for bad in [
            "modbus-master-3",
            "main",
            "-poll-1",
            "modbus-master-3-poll-",
            "modbus-master-3-poll-x",
            "modbus-master-3-poll-+1",
            "a-poll-1-poll-2",
        ] {
            assert_eq!(parse_poll_window_label(bad), None, "{bad}");
        }
        // The capability glob `modbus-master-*` matches both window kinds.
        assert!(l.starts_with("modbus-master-"));
    }
}
