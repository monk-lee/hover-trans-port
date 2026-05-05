use hover_trans_port_helper::protocol::{read_frame_from_slice, write_frame_to_vec};
use serde_json::json;

#[test]
fn writes_little_endian_length_prefixed_json() {
    let bytes = write_frame_to_vec(&json!({"type":"PING","requestId":"abc"})).unwrap();

    assert_eq!(&bytes[0..4], &[33, 0, 0, 0]);
    assert_eq!(&bytes[4..], br#"{"requestId":"abc","type":"PING"}"#);
}

#[test]
fn reads_little_endian_length_prefixed_json() {
    let mut bytes = vec![33, 0, 0, 0];
    bytes.extend_from_slice(br#"{"type":"PING","requestId":"abc"}"#);

    let value = read_frame_from_slice(&bytes).unwrap();

    assert_eq!(value["type"], "PING");
    assert_eq!(value["requestId"], "abc");
}
