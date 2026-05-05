use hover_trans_port_helper::bridge::{handle_request, BridgeDeps};
use serde_json::json;

#[test]
fn ping_returns_pong_with_same_request_id() {
    let response = handle_request(
        json!({"type":"PING","requestId":"req-ping"}),
        BridgeDeps::test(),
    );

    assert_eq!(response["type"], "PONG");
    assert_eq!(response["requestId"], "req-ping");
    assert_eq!(response["ok"], true);
    assert!(response["bridgeVersion"]
        .as_str()
        .unwrap()
        .starts_with("0.2.0"));
}

#[test]
fn unsupported_type_returns_error() {
    let response = handle_request(
        json!({"type":"NOPE","requestId":"req-nope"}),
        BridgeDeps::test(),
    );

    assert_eq!(response["type"], "ERROR");
    assert_eq!(response["requestId"], "req-nope");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "UNSUPPORTED_MESSAGE");
    assert_eq!(response["retryable"], false);
}

#[test]
fn invalid_translate_without_target_lang_returns_translate_result_error() {
    let response = handle_request(
        json!({"type":"TRANSLATE","requestId":"req-translate","text":"Hello"}),
        BridgeDeps::test(),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-translate");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "INVALID_MESSAGE");
    assert_eq!(response["retryable"], false);
}

#[test]
fn provider_status_returns_all_provider_ids() {
    let response = handle_request(
        json!({"type":"PROVIDER_STATUS","requestId":"req-providers"}),
        BridgeDeps::test(),
    );

    assert_eq!(response["type"], "PROVIDER_STATUS_RESULT");
    assert_eq!(response["requestId"], "req-providers");
    assert_eq!(response["ok"], true);

    let providers = response["providers"].as_array().unwrap();
    let ids = providers
        .iter()
        .map(|provider| provider["id"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert_eq!(ids, vec!["codex", "claude", "gemini"]);
}
