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
    let v = serde_json::to_value(AppError::new(AppErrorCode::NotConnected, "y")).unwrap();
    assert_eq!(v["code"], "notConnected");
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

#[test]
fn session_event_wire_shape() {
    let ev = SessionEvent::Counters(Counters {
        requests: 1,
        responses: 2,
        errors: 3,
        timeouts: 4,
    });
    assert_eq!(
        serde_json::to_value(&ev).unwrap(),
        json!({"type": "Counters", "requests": 1, "responses": 2, "errors": 3, "timeouts": 4})
    );
    let ev = SessionEvent::StateChanged(StateChanged {
        state: SessionState::BadResponse,
        reason: None,
        consecutive_failures: 2,
        exception_code: None,
        bad_response_kind: Some(BadResponseKind::WrongSlave),
        bad_response_detail: Some(BadResponseDetail {
            expected: Some(1),
            got: Some(5),
            message: "reply from slave 5, expected 1".into(),
        }),
        at: 7,
    });
    let v = serde_json::to_value(&ev).unwrap();
    assert_eq!(v["type"], "StateChanged");
    assert_eq!(v["state"], "badResponse");
    assert_eq!(v["badResponseKind"], "wrongSlave");
    assert_eq!(v["consecutiveFailures"], 2);
    assert_eq!(v["badResponseDetail"]["got"], 5);
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
fn profile_round_trip() {
    let p = Profile {
        schema_version: PROFILE_SCHEMA_VERSION,
        name: "Boiler-PLC".into(),
        connection: ConnectionConfig::Tcp {
            host: "192.168.1.10".into(),
            port: 502,
            timeout_ms: 1000,
        },
        poll: PollDefinition {
            slave_id: 1,
            function: 3,
            start_address: 0,
            quantity: 10,
            scan_rate_ms: 1000,
        },
        display: DisplaySettings {
            format: ValueFormat::Hex,
            address_base: 1,
        },
        auto_start_poll: true,
    };
    let v = serde_json::to_value(&p).unwrap();
    assert_eq!(v["schemaVersion"], 1);
    assert_eq!(v["poll"]["scanRateMs"], 1000);
    assert_eq!(v["display"]["addressBase"], 1);
    assert_eq!(serde_json::from_value::<Profile>(v).unwrap(), p);
}

#[test]
fn snapshot_is_flat() {
    let snap = SessionSnapshot {
        current: StateChanged {
            state: SessionState::Idle,
            reason: None,
            consecutive_failures: 0,
            exception_code: None,
            bad_response_kind: None,
            bad_response_detail: None,
            at: 5,
        },
        config: None,
        poll: None,
        counters: Counters::default(),
        last_update: None,
    };
    let v = serde_json::to_value(&snap).unwrap();
    assert_eq!(v["state"], "idle");
    assert_eq!(v["at"], 5);
    assert_eq!(v["counters"]["requests"], 0);
    assert!(v.get("current").is_none());
    assert_eq!(serde_json::from_value::<SessionSnapshot>(v).unwrap(), snap);
}

#[test]
fn profile_shape_checks() {
    let mut p: Profile = serde_json::from_value(json!({
        "schemaVersion": 1, "name": "A",
        "connection": {"mode": "tcp", "host": "h", "port": 502, "timeoutMs": 1000},
        "poll": {"slaveId": 1, "function": 3, "startAddress": 0, "quantity": 1, "scanRateMs": 1000},
        "display": {"format": "hex", "addressBase": 0},
        "autoStartPoll": false
    }))
    .unwrap();
    assert!(p.check_shape().is_ok());
    p.display.address_base = 2;
    assert!(p.check_shape().unwrap_err().contains("addressBase"));
    p.display.address_base = 1;
    p.poll.function = 6;
    assert!(p.check_shape().unwrap_err().contains("poll.function"));
    // Permissive otherwise: an empty host is still a savable draft.
    p.poll.function = 4;
    p.connection = ConnectionConfig::Tcp {
        host: String::new(),
        port: 0,
        timeout_ms: 0,
    };
    assert!(p.check_shape().is_ok());
}
