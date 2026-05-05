use hover_trans_port_helper::bridge::{handle_request, BridgeDeps};
use hover_trans_port_helper::protocol::{read_frame, write_frame};
use serde_json::json;
use std::io::Write;

fn main() {
    if let Err(error) = run() {
        eprintln!("hover-trans-port-helper: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), hover_trans_port_helper::protocol::ProtocolError> {
    let mut stdin = std::io::stdin().lock();
    let mut stdout = std::io::stdout().lock();
    let deps = BridgeDeps::default();

    loop {
        let request = match read_frame(&mut stdin) {
            Ok(Some(request)) => request,
            Ok(None) => return Ok(()),
            Err(error) => {
                eprintln!("hover-trans-port-helper: {error}");
                let response = json!({
                    "type": "ERROR",
                    "ok": false,
                    "error": "INVALID_MESSAGE",
                    "message": "Native message could not be parsed.",
                    "retryable": false
                });
                write_frame(&mut stdout, &response)?;
                stdout.flush()?;
                continue;
            }
        };

        let response = handle_request(request, deps.clone());
        write_frame(&mut stdout, &response)?;
        stdout.flush()?;
    }
}
