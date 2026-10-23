use serde_json::json;

use super::*;

#[test]
fn app_info_serializes_as_camel_case() {
    let json = serde_json::to_string(&AppInfo::new("ESEfact", "0.1.0")).unwrap();
    assert_eq!(json, r#"{"name":"ESEfact","version":"0.1.0"}"#);
}

#[test]
fn app_error_shape() {
    let v = serde_json::to_value(AppError::new(AppErrorCode::ProfileExists, "x")).unwrap();
    assert_eq!(
        v,
        json!({"code": "profileExists", "message": "x", "field": null})
    );
    let v =
        serde_json::to_value(AppError::new(AppErrorCode::Validation, "m").with_field("timeoutMs"))
            .unwrap();
    assert_eq!(v["field"], "timeoutMs");
    let v = serde_json::to_value(AppError::new(AppErrorCode::PollNotFound, "y")).unwrap();
    assert_eq!(v["code"], "pollNotFound");
}

#[test]
fn connection_config_wire_shape() {
    let tcp = ConnectionConfig::Tcp {
        host: "10.0.0.1".into(),
        port: 502,
        timeout_ms: 1000,
    };
    assert_eq!(
        serde_json::to_value(&tcp).unwrap(),
        json!({"mode": "tcp", "host": "10.0.0.1", "port": 502, "timeoutMs": 1000})
    );
    let rtu: ConnectionConfig = serde_json::from_value(json!({
        "mode": "rtu", "port": "COM3", "baud": 9600, "dataBits": 8,
        "parity": "even", "stopBits": 1, "timeoutMs": 1000
    }))
    .unwrap();
    assert_eq!(rtu.summary(), "RTU COM3 9600 8E1");
    assert_eq!(tcp.summary(), "TCP 10.0.0.1:502");
}

fn status(id: u32, state: PollState) -> PollStatus {
    PollStatus {
        poll_id: PollId(id),
        state,
        consecutive_failures: 0,
        exception_code: None,
        bad_response_kind: None,
        bad_response_detail: None,
        at: 7,
    }
}

#[test]
fn session_event_wire_shape() {
    let ev = SessionEvent::ConnectionStateChanged(ConnectionStatus {
        state: ConnectionState::Disconnected,
        reason: Some(SessionReason {
            kind: ReasonKind::ClosedByPeer,
            phase: ReasonPhase::LinkLost,
            message: "closed".into(),
        }),
        config: None,
        at: 5,
    });
    let v = serde_json::to_value(&ev).unwrap();
    assert_eq!(v["type"], "ConnectionStateChanged");
    assert_eq!(v["state"], "disconnected");
    assert_eq!(v["reason"]["kind"], "closedByPeer");

    let mut s = status(3, PollState::BadResponse);
    s.consecutive_failures = 2;
    s.bad_response_kind = Some(BadResponseKind::WrongSlave);
    let v = serde_json::to_value(SessionEvent::PollStateChanged(s)).unwrap();
    assert_eq!(v["type"], "PollStateChanged");
    assert_eq!(v["pollId"], 3);
    assert_eq!(v["state"], "badResponse");
    assert_eq!(v["badResponseKind"], "wrongSlave");

    let v = serde_json::to_value(SessionEvent::RevealPoll(RevealPoll {
        poll_id: PollId(4),
        workspace_rect: None,
    }))
    .unwrap();
    assert_eq!(
        v,
        json!({"type": "RevealPoll", "pollId": 4, "workspaceRect": null})
    );

    let v = serde_json::to_value(SessionEvent::PrefsChanged(Prefs {
        ask_on_poll_close: true,
        compact: false,
    }))
    .unwrap();
    assert_eq!(
        v,
        json!({"type": "PrefsChanged", "askOnPollClose": true, "compact": false})
    );
    let v =
        serde_json::to_value(SessionEvent::PollListChanged(PollList { polls: vec![] })).unwrap();
    assert_eq!(v, json!({"type": "PollListChanged", "polls": []}));
}

#[test]
fn poll_view_event_wire_shape() {
    let v = serde_json::to_value(PollViewEvent::ViewDetached(ViewDetached {
        poll_id: PollId(2),
        reason: DetachReason::PoppedOut,
    }))
    .unwrap();
    assert_eq!(
        v,
        json!({"type": "ViewDetached", "pollId": 2, "reason": "poppedOut"})
    );
    let v = serde_json::to_value(PollViewEvent::HandoffRequested(HandoffRequested {
        poll_id: PollId(2),
    }))
    .unwrap();
    assert_eq!(v, json!({"type": "HandoffRequested", "pollId": 2}));
    let v = serde_json::to_value(PollViewEvent::PollCounters(PollCounters {
        poll_id: PollId(2),
        counters: Counters::default(),
        effective_scan_ms: Some(140),
        last_ok_at: None,
    }))
    .unwrap();
    assert_eq!(v["type"], "PollCounters");
    assert_eq!(v["effectiveScanMs"], 140);
    assert_eq!(v["counters"]["requests"], 0);
}

#[test]
fn write_result_wire_shape() {
    assert_eq!(
        serde_json::to_value(WriteResult::BroadcastSent).unwrap(),
        json!({"status": "broadcastSent"})
    );
    assert_eq!(
        serde_json::to_value(WriteResult::Exception {
            code: ExceptionCode(2)
        })
        .unwrap(),
        json!({"status": "exception", "code": 2})
    );
    assert_eq!(
        serde_json::to_value(WriteResult::LinkLost).unwrap(),
        json!({"status": "linkLost"})
    );
}

#[test]
fn traffic_origin_shape() {
    assert_eq!(
        serde_json::to_value(TrafficOrigin::Poll { poll_id: PollId(3) }).unwrap(),
        json!({"kind": "poll", "pollId": 3})
    );
    assert_eq!(
        serde_json::to_value(TrafficOrigin::Write { poll_id: None }).unwrap(),
        json!({"kind": "write", "pollId": null})
    );
}

#[test]
fn layout_wire_shapes() {
    let a: PopOutAnchor = serde_json::from_value(json!({
        "kind": "rect", "rect": {"x": 8, "y": 8, "width": 640, "height": 368}
    }))
    .unwrap();
    assert_eq!(
        a,
        PopOutAnchor::Rect {
            rect: LogicalRect::new(8.0, 8.0, 640.0, 368.0)
        }
    );
    let a: PopOutAnchor =
        serde_json::from_value(json!({"kind": "cursor", "grabOffset": {"x": 20, "y": 10}}))
            .unwrap();
    assert!(matches!(a, PopOutAnchor::Cursor { .. }));
    let t: ArrangeTarget =
        serde_json::from_value(json!({"kind": "monitor", "monitorId": "\\\\.\\DISPLAY2"})).unwrap();
    assert_eq!(
        t,
        ArrangeTarget::Monitor {
            monitor_id: "\\\\.\\DISPLAY2".into()
        }
    );
    assert_eq!(
        serde_json::from_value::<ArrangeTarget>(json!({"kind": "eachMonitor"})).unwrap(),
        ArrangeTarget::EachMonitor
    );
    assert_eq!(
        serde_json::to_value(ArrangeLayout::SideBySide).unwrap(),
        "sideBySide"
    );
}

#[test]
fn view_settings_patch_distinguishes_missing_and_null() {
    let p: PollViewSettings = serde_json::from_value(json!({})).unwrap();
    assert_eq!(p, PollViewSettings::default());
    let p: PollViewSettings = serde_json::from_value(json!({"scale": null})).unwrap();
    assert_eq!(p.scale, Some(None));
    let p: PollViewSettings = serde_json::from_value(json!({
        "scale": {"preset": "divide", "rawSigned": false, "xMin": 0, "xMax": 65535,
                  "yMin": 0, "yMax": 1, "divisor": 10, "decimals": 1, "unit": "°C",
                  "outOfRange": "flag"},
        "hasUnappliedEdits": true,
        "aliases": [{"address": 3, "alias": "Tank"}]
    }))
    .unwrap();
    assert_eq!(p.scale.unwrap().unwrap().preset, ScalePreset::Divide);
    assert_eq!(p.has_unapplied_edits, Some(true));
    assert_eq!(p.aliases.unwrap()[0].alias, "Tank");
    assert!(p.display.is_none());
}

fn poll_profile(name: &str) -> PollProfile {
    PollProfile {
        name: name.into(),
        definition: PollDefinition {
            slave_id: 1,
            function: 3,
            start_address: 0,
            quantity: 10,
            scan_rate_ms: 1000,
        },
        active: true,
        display: DisplaySettings::default(),
        format_overrides: vec![],
        color_rules: Vec::new(),
        scale: None,
        scale_overrides: vec![],
        value_columns: ValueColumns::Raw,
        aliases: vec![AliasEntry {
            address: 0,
            alias: "Tank top".into(),
        }],
        view: PollViewPlacement {
            host: PollHostKind::Workspace,
            open: true,
            workspace: Some(WorkspaceRect {
                x: 8.0,
                y: 8.0,
                width: 640.0,
                height: 368.0,
                z: 1,
                state: SubWindowState::Normal,
                restore: None,
                grid: None,
            }),
            native: None,
        },
    }
}

#[test]
fn profile_round_trip() {
    let p = Profile {
        schema_version: PROFILE_SCHEMA_VERSION,
        name: "Boiler-PLC".into(),
        connection: ConnectionConfig::Tcp {
            host: "192.168.1.10".into(),
            port: 502,
            timeout_ms: 1000,
        },
        auto_start_poll: true,
        connection_window: None,
        workspace: WorkspaceProfile::default(),
        polls: vec![poll_profile("Poll 1")],
        migrated_from: None,
    };
    let v = serde_json::to_value(&p).unwrap();
    assert_eq!(v["schemaVersion"], 6);
    assert_eq!(v["polls"][0]["formatOverrides"], json!([]));
    assert!(v["polls"][0]["display"].get("format").is_none());
    assert_eq!(v["polls"][0]["definition"]["scanRateMs"], 1000);
    assert_eq!(v["polls"][0]["display"]["showAlias"], true);
    assert_eq!(v["polls"][0]["view"]["workspace"]["state"], "normal");
    assert_eq!(v["workspace"]["sidebarWidth"], 280.0);
    assert_eq!(serde_json::from_value::<Profile>(v).unwrap(), p);
}

#[test]
fn poll_name_rules() {
    let msg = |n: &str| check_poll_name(n).unwrap_err();
    assert!(check_poll_name("Tank 1 temperatures").is_ok());
    assert!(check_poll_name(&"a".repeat(48)).is_ok());
    assert_eq!(msg(""), "Enter a poll name.");
    assert_eq!(msg("   "), "Enter a poll name.");
    assert_eq!(
        msg(&"a".repeat(49)),
        "Poll name must be at most 48 characters."
    );
    assert_eq!(msg(" a"), "Poll name cannot start or end with a space.");
    assert_eq!(msg("a\tb"), "Poll name cannot contain control characters.");
    assert!(same_poll_name("Pump", "PUMP"));
    assert_eq!(
        duplicate_poll_name_message("Pump"),
        "A poll named \"Pump\" already exists on this connection."
    );
}

#[test]
fn alias_and_scale_rules() {
    let a = |address: u16, alias: &str| AliasEntry {
        address,
        alias: alias.into(),
    };
    assert!(check_aliases(&[a(0, "Tank top"), a(1, "Tank top")]).is_ok());
    assert!(check_aliases(&[a(0, "x"), a(0, "y")])
        .unwrap_err()
        .contains("more than one alias"));
    assert!(check_aliases(&[a(0, &"x".repeat(33))])
        .unwrap_err()
        .contains("at most 32 characters"));
    assert!(check_aliases(&[a(0, " x")]).unwrap_err().contains("space"));
    assert!(check_aliases(&[a(0, "a\nb")])
        .unwrap_err()
        .contains("control"));
    let many: Vec<AliasEntry> = (0..2001).map(|i| a(i, "x")).collect();
    assert_eq!(
        check_aliases(&many).unwrap_err(),
        "A poll can have at most 2000 aliases."
    );
    assert!(check_aliases(&many[..2000]).is_ok());

    let scale = ScaleSettings {
        preset: ScalePreset::Linear,
        raw_signed: false,
        x_min: 0,
        x_max: 65535,
        y_min: 4.0,
        y_max: 20.0,
        divisor: 1.0,
        decimals: 2,
        unit: "mA".into(),
        out_of_range: ScaleOutOfRange::Flag,
    };
    assert!(check_scale(&scale).is_ok());
    let mut bad = scale.clone();
    bad.unit = "x".repeat(17);
    assert!(check_scale(&bad).is_err());
    let mut bad = scale.clone();
    bad.decimals = 7;
    assert!(check_scale(&bad).is_err());
    let o = |start, end| ScaleOverride {
        start,
        end,
        scale: scale.clone(),
    };
    assert!(check_scale_overrides(&[o(0, 4), o(5, 5)]).is_ok());
    assert!(check_scale_overrides(&[o(5, 4)]).is_err());
    let many: Vec<ScaleOverride> = (0..65).map(|i| o(i, i)).collect();
    assert!(check_scale_overrides(&many).is_err());
}

fn fo(start: u16, end: u16, format: ValueFormat) -> FormatOverride {
    FormatOverride {
        start,
        end,
        format,
        swap_bytes: false,
        reverse_words: false,
    }
}

/// BE-009 test vectors 1 and 2.
#[test]
fn format_override_rules() {
    use ValueFormat as F;
    assert_eq!(
        [F::Unsigned, F::Signed, F::Hex, F::Binary].map(format_width),
        [1; 4]
    );
    assert_eq!(
        [F::Signed32, F::Unsigned32, F::Float32].map(format_width),
        [2; 3]
    );
    assert_eq!(
        [F::Signed64, F::Unsigned64, F::Float64].map(format_width),
        [4; 3]
    );
    assert!(check_format_overrides(&[]).is_ok());
    assert!(check_format_overrides(&[fo(0, 1, F::Float32)]).is_ok());
    assert!(check_format_overrides(&[fo(0, 3, F::Unsigned64), fo(4, 4, F::Hex)]).is_ok());
    assert!(check_format_overrides(&[fo(65534, 65535, F::Float32)]).is_ok());
    assert!(check_format_overrides(&[fo(65532, 65535, F::Float64)]).is_ok());
    // The default is accepted as given.
    assert!(check_format_overrides(&[fo(7, 7, F::Unsigned)]).is_ok());
    let err = |list: &[FormatOverride]| check_format_overrides(list).unwrap_err();
    assert_eq!(
        err(&[fo(0, 2, F::Float32)]),
        "Format override 0-2: Float 32-bit needs a multiple of 2 registers."
    );
    assert_eq!(
        err(&[fo(0, 5, F::Unsigned64)]),
        "Format override 0-5: Unsigned 64-bit needs a multiple of 4 registers."
    );
    for (format, label) in [
        (F::Signed32, "Signed 32-bit"),
        (F::Unsigned32, "Unsigned 32-bit"),
        (F::Signed64, "Signed 64-bit"),
        (F::Float64, "Float 64-bit"),
    ] {
        assert!(err(&[fo(10, 10, format)]).contains(label), "{label}");
    }
    assert_eq!(
        err(&[fo(5, 4, F::Hex)]),
        "Format override 5-4: the end address must not be before the start address."
    );
    let mut swapped = fo(0, 0, F::Hex);
    swapped.swap_bytes = true;
    assert_eq!(
        err(&[swapped]),
        "Format override 0-0: byte and word order apply to 32-bit and 64-bit formats only."
    );
    let mut reversed = fo(0, 0, F::Signed);
    reversed.reverse_words = true;
    assert!(err(&[reversed]).contains("byte and word order"));
    let mut ordered = fo(0, 1, F::Float32);
    ordered.swap_bytes = true;
    ordered.reverse_words = true;
    assert!(check_format_overrides(&[ordered]).is_ok());
    assert_eq!(
        err(&[fo(0, 3, F::Float32), fo(2, 5, F::Float32)]),
        "Format overrides 0-3 and 2-5 overlap."
    );
    assert_eq!(
        err(&[fo(2, 5, F::Float32), fo(0, 3, F::Float32)]),
        "Format overrides 0-3 and 2-5 overlap."
    );
    let many: Vec<FormatOverride> = (0..257).map(|i| fo(i, i, F::Hex)).collect();
    assert_eq!(err(&many), "A poll can have at most 256 format overrides.");
    assert!(check_format_overrides(&many[..256]).is_ok());
    // Unsorted input is accepted and stored sorted.
    let mut unsorted = vec![fo(4, 4, F::Hex), fo(0, 1, F::Float32)];
    assert!(check_format_overrides(&unsorted).is_ok());
    sort_format_overrides(&mut unsorted);
    assert_eq!(unsorted, [fo(0, 1, F::Float32), fo(4, 4, F::Hex)]);
}

#[test]
fn format_override_wire_shape_is_strict() {
    let v = serde_json::to_value(fo(100, 105, ValueFormat::Float32)).unwrap();
    assert_eq!(
        v,
        json!({"start": 100, "end": 105, "format": "float32", "swapBytes": false, "reverseWords": false})
    );
    for key in ["start", "end", "format", "swapBytes", "reverseWords"] {
        let mut bad = v.clone();
        bad.as_object_mut().unwrap().remove(key);
        assert!(
            serde_json::from_value::<FormatOverride>(bad).is_err(),
            "{key}"
        );
    }
    let mut bad = v.clone();
    bad["extra"] = json!(1);
    assert!(serde_json::from_value::<FormatOverride>(bad).is_err());
    let p: PollViewSettings =
        serde_json::from_value(json!({"formatOverrides": [v.clone()]})).unwrap();
    assert_eq!(p.format_overrides.unwrap()[0].end, 105);
    assert!(serde_json::from_value::<PollViewSettings>(json!({"formatOverrides": null})).is_err());
    let p: PollViewSettings = serde_json::from_value(json!({})).unwrap();
    assert!(p.format_overrides.is_none());
    // Schema 6 display settings have no format keys.
    assert!(serde_json::from_value::<DisplaySettings>(json!({
        "addressBase": 0, "showAlias": true, "copyAlias": false, "format": "unsigned"
    }))
    .is_err());
}
