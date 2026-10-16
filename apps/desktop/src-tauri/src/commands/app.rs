use shared_types::AppInfo;

/// Returns basic information about the running application.
#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo::new(platform::APP_NAME, env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_name_and_version() {
        let info = app_info();
        assert_eq!(info.name, "ESEfact");
        assert!(!info.version.is_empty());
    }
}
