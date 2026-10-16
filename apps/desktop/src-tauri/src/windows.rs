//! Window creation helpers (one window per tool instance).

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
/// must allow `<id>-*`.
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
}
