//! Modbus Master profile schema 5: explicit migration from schemas 1–4,
//! validation, and canonical JSON written only on Save. Reading never rewrites a file.
//! The store rejects newer schemas; malformed supported documents are invalidProfile.
//! Connection drafts remain permissive, while all persisted view settings are checked.

use serde_json::Value;
use shared_types::{
    check_aliases, check_display, check_poll_name, check_scale, check_scale_overrides,
    same_poll_name, DisplaySettings, PollHostKind, PollProfile, PollViewPlacement, Profile,
    ProfileV1, ProfileV2, ValueColumns, WorkspaceProfile, MAX_POLLS, PROFILE_SCHEMA_VERSION,
};

/// Tool id of Modbus Master profiles.
pub const MODBUS_MASTER_TOOL_ID: &str = "modbus-master";

/// A rule a profile breaks. `field` names the profile part (`polls`, `workspace`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileProblem {
    pub field: &'static str,
    pub message: String,
}

impl std::fmt::Display for ProfileProblem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

fn problem(field: &'static str, message: impl Into<String>) -> ProfileProblem {
    ProfileProblem {
        field,
        message: message.into(),
    }
}

/// Migrates a schema 1 profile (DES-002 6.2): its poll becomes "Poll 1", active, shown in
/// the workspace at the next slot; workspace settings are defaults.
#[must_use]
pub fn migrate_v1(v1: ProfileV1) -> Profile {
    Profile {
        schema_version: PROFILE_SCHEMA_VERSION,
        name: v1.name,
        connection: v1.connection,
        auto_start_poll: v1.auto_start_poll,
        connection_window: None,
        workspace: WorkspaceProfile::default(),
        polls: vec![PollProfile {
            name: "Poll 1".into(),
            definition: v1.poll,
            active: true,
            display: DisplaySettings {
                format: v1.display.format.into(),
                swap_bytes: false,
                reverse_words: false,
                address_base: v1.display.address_base,
                show_alias: true,
                copy_alias: false,
            },
            color_rules: Vec::new(),
            scale: None,
            scale_overrides: Vec::new(),
            value_columns: ValueColumns::Raw,
            aliases: Vec::new(),
            view: PollViewPlacement {
                host: PollHostKind::Workspace,
                open: true,
                workspace: None,
                native: None,
            },
        }],
        migrated_from: Some(1),
    }
}

/// Decodes a stored document (store hook for `get_with` / `list_with`): schema 1 is
/// migrated, schemas 3 through 5 parsed; every resulting configuration is checked.
///
/// # Errors
/// Why the document cannot be opened.
pub fn decode_profile(value: Value) -> Result<Profile, String> {
    let version = value
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or("missing schemaVersion")?;
    let mut profile = match version {
        1 => migrate_v1(serde_json::from_value(value).map_err(|e| e.to_string())?),
        2 => migrate_v2(serde_json::from_value(value).map_err(|e| e.to_string())?),
        3..=5 => {
            let mut p: Profile = serde_json::from_value(value).map_err(|e| e.to_string())?;
            p.migrated_from = (version < PROFILE_SCHEMA_VERSION as u64).then_some(version as u32);
            p.schema_version = PROFILE_SCHEMA_VERSION;
            p
        }
        other => return Err(format!("unknown profile version {other}")),
    };
    check_profile(&profile).map_err(|p| p.message)?;
    for poll in &mut profile.polls {
        shared_types::normalize_color_rules(&mut poll.color_rules);
    }
    Ok(profile)
}

/// The JSON object written by `profiles_save` (without `migratedFrom`).
///
/// # Errors
/// Serialization failures (none expected).
pub fn encode_profile(profile: &Profile) -> Result<Value, String> {
    check_profile(profile).map_err(|p| p.message)?;
    let mut profile = profile.clone();
    for poll in &mut profile.polls {
        shared_types::normalize_color_rules(&mut poll.color_rules);
    }
    let mut value = serde_json::to_value(&profile).map_err(|e| e.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        obj.remove("migratedFrom");
        obj.insert("schemaVersion".into(), Value::from(PROFILE_SCHEMA_VERSION));
    }
    Ok(value)
}

/// Checks a schema 3 profile: at most 16 polls, valid and unique poll names, function
/// 1-4, address base 0/1, alias lists, scale shapes, and `minimizedOrder` indexes.
///
/// # Errors
/// The first problem.
pub fn check_profile(profile: &Profile) -> Result<(), ProfileProblem> {
    if profile.schema_version != PROFILE_SCHEMA_VERSION {
        return Err(problem("schemaVersion", "Unsupported profile schema."));
    }
    if profile.polls.len() > MAX_POLLS {
        return Err(problem(
            "polls",
            format!(
                "A connection can have at most 16 polls (found {}).",
                profile.polls.len()
            ),
        ));
    }
    for (i, p) in profile.polls.iter().enumerate() {
        let at = |m: String| problem("polls", format!("Poll {}: {m}", i + 1));
        check_poll_name(&p.name).map_err(at)?;
        if profile.polls[..i]
            .iter()
            .any(|o| same_poll_name(&o.name, &p.name))
        {
            return Err(at(format!("the name \"{}\" is used twice.", p.name)));
        }
        if !(1..=4).contains(&p.definition.function) {
            return Err(at(format!(
                "definition.function must be 1, 2, 3 or 4 (found {}).",
                p.definition.function
            )));
        }
        check_display(&p.display).map_err(at)?;
        shared_types::check_color_rules(&p.color_rules, p.display.format)
            .map_err(|e| at(format!("{}: {}", e.field, e.message)))?;
        check_aliases(&p.aliases).map_err(at)?;
        if let Some(s) = &p.scale {
            check_scale(s).map_err(at)?;
        }
        check_scale_overrides(&p.scale_overrides).map_err(at)?;
    }
    let order = &profile.workspace.minimized_order;
    for (i, index) in order.iter().enumerate() {
        let valid = usize::try_from(*index).is_ok_and(|n| n < profile.polls.len());
        if !valid || order[..i].contains(index) {
            return Err(problem(
                "workspace",
                format!("workspace.minimizedOrder has an invalid poll index {index}."),
            ));
        }
    }
    Ok(())
}

/// Upgrade schema 2 without changing any existing setting.
#[must_use]
pub fn migrate_v2(v2: ProfileV2) -> Profile {
    Profile {
        schema_version: PROFILE_SCHEMA_VERSION,
        name: v2.name,
        connection: v2.connection,
        auto_start_poll: v2.auto_start_poll,
        connection_window: v2.connection_window,
        workspace: v2.workspace,
        polls: v2
            .polls
            .into_iter()
            .map(|p| PollProfile {
                name: p.name,
                definition: p.definition,
                active: p.active,
                display: DisplaySettings {
                    format: p.display.format.into(),
                    address_base: p.display.address_base,
                    show_alias: p.display.show_alias,
                    copy_alias: p.display.copy_alias,
                    swap_bytes: false,
                    reverse_words: false,
                },
                color_rules: Vec::new(),
                scale: p.scale,
                scale_overrides: p.scale_overrides,
                value_columns: p.value_columns,
                aliases: p.aliases,
                view: p.view,
            })
            .collect(),
        migrated_from: Some(2),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::ProfileStore;

    /// A schema 1 file exactly as BE-001 wrote it.
    const V1_TCP: &str = r#"{
  "schemaVersion": 1,
  "name": "Boiler-PLC",
  "connection": {"mode": "tcp", "host": "192.168.1.10", "port": 502, "timeoutMs": 1000},
  "poll": {"slaveId": 1, "function": 3, "startAddress": 0, "quantity": 10, "scanRateMs": 1000},
  "display": {"format": "hex", "addressBase": 1},
  "autoStartPoll": true
}"#;

    const V1_RTU: &str = r#"{
  "schemaVersion": 1,
  "name": "Pump-RTU",
  "connection": {"mode": "rtu", "port": "COM3", "baud": 9600, "dataBits": 8, "parity": "even", "stopBits": 1, "timeoutMs": 500},
  "poll": {"slaveId": 5, "function": 1, "startAddress": 100, "quantity": 32, "scanRateMs": 250},
  "display": {"format": "binary", "addressBase": 0},
  "autoStartPoll": false
}"#;

    const V6: &str = r#"{"schemaVersion": 6, "name": "Future", "polls": [], "something": true}"#;

    fn v2_value() -> Value {
        json!({
            "schemaVersion": 2,
            "name": "Two",
            "connection": {"mode": "tcp", "host": "h", "port": 502, "timeoutMs": 1000},
            "autoStartPoll": false,
            "connectionWindow": {"x": 10, "y": 10, "width": 1280, "height": 800, "maximized": false, "monitor": "\\\\.\\DISPLAY1"},
            "workspace": {"tileMode": true, "compact": false, "sidebarWidth": 280, "sidebarCollapsed": false,
                          "trafficExpanded": false, "trafficHeight": null, "minimizedOrder": [1]},
            "polls": [
                {"name": "Tank 1", "definition": {"slaveId": 1, "function": 3, "startAddress": 0, "quantity": 10, "scanRateMs": 100},
                 "active": true, "display": {"format": "unsigned", "addressBase": 0, "showAlias": true, "copyAlias": false},
                 "scale": null, "scaleOverrides": [], "valueColumns": "raw",
                 "aliases": [{"address": 0, "alias": "Tank top"}],
                 "view": {"host": "workspace", "open": true, "workspace": null, "native": null}},
                {"name": "Valves", "definition": {"slaveId": 1, "function": 1, "startAddress": 0, "quantity": 32, "scanRateMs": 500},
                 "active": false, "display": {"format": "binary", "addressBase": 1, "showAlias": false, "copyAlias": true},
                 "scale": null, "scaleOverrides": [], "valueColumns": "raw", "aliases": [],
                 "view": {"host": "native", "open": true, "workspace": null,
                          "native": {"x": 1940, "y": 20, "width": 900, "height": 640, "maximized": false, "monitor": "\\\\.\\DISPLAY2"}}}
            ]
        })
    }

    #[test]
    fn v1_tcp_and_rtu_files_migrate_without_data_loss() {
        let p = decode_profile(serde_json::from_str(V1_TCP).unwrap()).unwrap();
        assert_eq!(p.migrated_from, Some(1));
        assert_eq!(p.schema_version, 5);
        assert_eq!(p.name, "Boiler-PLC");
        assert!(p.auto_start_poll);
        assert_eq!(p.connection.summary(), "TCP 192.168.1.10:502");
        assert_eq!(p.polls.len(), 1);
        let poll = &p.polls[0];
        assert_eq!(poll.name, "Poll 1");
        assert!(poll.active);
        assert_eq!(
            (poll.definition.quantity, poll.definition.scan_rate_ms),
            (10, 1000)
        );
        assert_eq!(poll.display.address_base, 1);
        assert_eq!(poll.display.format, shared_types::ValueFormat::Hex);
        assert!(poll.display.show_alias && !poll.display.copy_alias);
        assert_eq!(poll.value_columns, ValueColumns::Raw);
        assert!(poll.scale.is_none() && poll.aliases.is_empty());
        assert_eq!(poll.view.host, PollHostKind::Workspace);
        assert!(poll.view.open && poll.view.workspace.is_none());
        assert_eq!(p.workspace, WorkspaceProfile::default());
        assert!(p.connection_window.is_none());

        let p = decode_profile(serde_json::from_str(V1_RTU).unwrap()).unwrap();
        assert_eq!(p.connection.summary(), "RTU COM3 9600 8E1");
        assert_eq!(p.polls[0].definition.function, 1);
        assert_eq!(p.polls[0].definition.slave_id, 5);
        assert!(!p.auto_start_poll);
    }

    #[test]
    fn v2_round_trips_and_encoding_drops_migrated_from() {
        let p = decode_profile(v2_value()).unwrap();
        assert_eq!(p.migrated_from, Some(2));
        assert_eq!(
            p.polls[1].view.native.as_ref().unwrap().monitor,
            "\\\\.\\DISPLAY2"
        );
        let mut migrated = p.clone();
        migrated.migrated_from = Some(1);
        let v = encode_profile(&migrated).unwrap();
        assert!(v.get("migratedFrom").is_none());
        assert_eq!(v["schemaVersion"], 5);
        let mut expected = p;
        expected.migrated_from = None;
        assert_eq!(decode_profile(v).unwrap(), expected);
    }

    #[test]
    fn schemas_three_and_four_migrate_to_five_without_losing_poll_settings() {
        let original = decode_profile(v2_value()).unwrap();
        for version in [3, 4] {
            let mut legacy = encode_profile(&original).unwrap();
            legacy["schemaVersion"] = json!(version);
            let migrated = decode_profile(legacy).unwrap();
            assert_eq!(migrated.schema_version, 5);
            assert_eq!(migrated.migrated_from, Some(version));
            assert_eq!(migrated.polls, original.polls);
            assert_eq!(migrated.workspace, original.workspace);
        }
    }

    #[test]
    fn legacy_formats_are_closed_and_schema3_requires_new_fields() {
        for format in ["unsigned", "signed", "hex", "binary"] {
            let mut v1: Value = serde_json::from_str(V1_TCP).unwrap();
            v1["display"]["format"] = json!(format);
            let migrated = decode_profile(v1).unwrap();
            assert_eq!(
                serde_json::to_value(migrated.polls[0].display.format).unwrap(),
                json!(format)
            );
            assert!(!migrated.polls[0].display.swap_bytes);
            assert!(migrated.polls[0].color_rules.is_empty());
        }
        let mut legacy = v2_value();
        legacy["polls"][0]["display"]["format"] = json!("unsigned64");
        assert!(decode_profile(legacy).is_err());
        let current = encode_profile(&decode_profile(v2_value()).unwrap()).unwrap();
        for format in [
            "unsigned",
            "signed",
            "hex",
            "binary",
            "signed32",
            "unsigned32",
            "float32",
            "signed64",
            "unsigned64",
            "float64",
        ] {
            for swap in [false, true] {
                for reverse in [false, true] {
                    let mut v = current.clone();
                    v["polls"][0]["display"]["format"] = json!(format);
                    v["polls"][0]["display"]["swapBytes"] = json!(swap);
                    v["polls"][0]["display"]["reverseWords"] = json!(reverse);
                    assert_eq!(
                        encode_profile(&decode_profile(v.clone()).unwrap()).unwrap(),
                        v
                    );
                }
            }
        }
        for key in ["swapBytes", "reverseWords", "format"] {
            let mut bad = current.clone();
            bad["polls"][0]["display"]
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert!(decode_profile(bad).is_err());
        }
        let mut bad = current.clone();
        bad["polls"][1]
            .as_object_mut()
            .unwrap()
            .remove("colorRules");
        assert!(decode_profile(bad).is_err());
        let mut bad = current.clone();
        bad["polls"][0]["display"]["swapBytes"] = json!(1);
        assert!(decode_profile(bad).is_err());
        for version in [
            json!(0),
            json!(-1),
            json!(1.5),
            json!("3"),
            json!(null),
            json!(6),
        ] {
            let mut bad = current.clone();
            bad["schemaVersion"] = version;
            assert!(decode_profile(bad).is_err());
        }
        let mut profile = decode_profile(current).unwrap();
        profile.schema_version = 6;
        assert!(encode_profile(&profile).is_err());
    }

    type Mutation = Box<dyn Fn(&mut Value)>;

    #[test]
    fn damaged_v2_files_are_refused() {
        let cases: Vec<(&str, Mutation)> = vec![
            (
                "16 polls",
                Box::new(|v| {
                    let poll = v["polls"][0].clone();
                    let polls: Vec<Value> = (0..17)
                        .map(|i| {
                            let mut p = poll.clone();
                            p["name"] = json!(format!("P{i}"));
                            p
                        })
                        .collect();
                    v["polls"] = json!(polls);
                }),
            ),
            (
                "used twice",
                Box::new(|v| v["polls"][1]["name"] = json!("TANK 1")),
            ),
            (
                "Enter a poll name",
                Box::new(|v| v["polls"][1]["name"] = json!(" ")),
            ),
            (
                "function",
                Box::new(|v| v["polls"][0]["definition"]["function"] = json!(6)),
            ),
            (
                "addressBase",
                Box::new(|v| v["polls"][0]["display"]["addressBase"] = json!(2)),
            ),
            (
                "more than one alias",
                Box::new(|v| {
                    v["polls"][0]["aliases"] =
                        json!([{"address": 1, "alias": "a"}, {"address": 1, "alias": "b"}]);
                }),
            ),
            (
                "32 characters",
                Box::new(|v| {
                    v["polls"][0]["aliases"] = json!([{"address": 1, "alias": "x".repeat(33)}]);
                }),
            ),
            (
                "2000 aliases",
                Box::new(|v| {
                    let many: Vec<Value> = (0..2001)
                        .map(|i| json!({"address": i, "alias": "a"}))
                        .collect();
                    v["polls"][0]["aliases"] = json!(many);
                }),
            ),
            (
                "minimizedOrder",
                Box::new(|v| v["workspace"]["minimizedOrder"] = json!([2])),
            ),
            (
                "minimizedOrder",
                Box::new(|v| v["workspace"]["minimizedOrder"] = json!([1, 1])),
            ),
            (
                "missing field",
                Box::new(|v| {
                    v["polls"][0].as_object_mut().unwrap().remove("view");
                }),
            ),
        ];
        for (expected, mutate) in cases {
            let mut v = v2_value();
            mutate(&mut v);
            let err = decode_profile(v).unwrap_err();
            assert!(err.contains(expected), "{expected}: {err}");
        }
    }

    #[test]
    fn store_lists_migrated_damaged_and_newer_files() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(tmp.path().join("profiles"), PROFILE_SCHEMA_VERSION);
        let dir = store.root().join(MODBUS_MASTER_TOOL_ID);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Boiler-PLC.json"), V1_TCP).unwrap();
        std::fs::write(dir.join("Future.json"), V6).unwrap();
        let mut damaged = v2_value();
        damaged["workspace"]["minimizedOrder"] = json!([9]);
        std::fs::write(dir.join("Damaged.json"), damaged.to_string()).unwrap();

        let list = store
            .list_with(MODBUS_MASTER_TOOL_ID, decode_profile)
            .unwrap();
        let readable: Vec<(&str, bool)> = list
            .iter()
            .map(|e| (e.name.as_str(), e.document.is_ok()))
            .collect();
        assert_eq!(
            readable,
            [("Boiler-PLC", true), ("Damaged", false), ("Future", false)]
        );
        assert!(matches!(
            store.get_with(MODBUS_MASTER_TOOL_ID, "future", decode_profile),
            Err(crate::ProfileError::UnsupportedSchema {
                found: 6,
                supported: 5,
                ..
            })
        ));
        assert!(matches!(
            store.get_with(MODBUS_MASTER_TOOL_ID, "Damaged", decode_profile),
            Err(crate::ProfileError::Invalid { .. })
        ));
        // A migrated profile stays version 1 on disk until it is saved.
        let p = store
            .get_with(MODBUS_MASTER_TOOL_ID, "boiler-plc", decode_profile)
            .unwrap();
        assert_eq!(p.migrated_from, Some(1));
        let on_disk: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("Boiler-PLC.json")).unwrap())
                .unwrap();
        assert_eq!(on_disk["schemaVersion"], 1);
        // Saving writes schema 3 without migratedFrom; it then reads back unchanged.
        store
            .save(
                MODBUS_MASTER_TOOL_ID,
                "Boiler-PLC",
                &encode_profile(&p).unwrap(),
                true,
            )
            .unwrap();
        let on_disk: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("Boiler-PLC.json")).unwrap())
                .unwrap();
        assert_eq!(on_disk["schemaVersion"], 5);
        assert!(on_disk.get("migratedFrom").is_none());
        let again = store
            .get_with(MODBUS_MASTER_TOOL_ID, "Boiler-PLC", decode_profile)
            .unwrap();
        assert_eq!(again.migrated_from, None);
        assert_eq!(again.polls, p.polls);
    }
}
