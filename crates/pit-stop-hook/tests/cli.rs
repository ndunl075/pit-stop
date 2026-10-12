use std::{
    io::Write,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn invoke(args: &[&str], input: &[u8]) -> std::process::Output {
    let home = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_pit-stop-hook"))
        .args(args)
        .env("LOCALAPPDATA", home.path())
        .env("XDG_DATA_HOME", home.path())
        .env("HOME", home.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let _ = child.stdin.take().unwrap().write_all(input);
    child.wait_with_output().unwrap()
}
#[test]
fn cursor_pre_always_allows_even_invalid_or_offline() {
    for input in [
        &b"{"[..],
        &b""[..],
        &b"null"[..],
        include_bytes!("../../../fixtures/cursor/pre-tool-use.json").as_slice(),
        &vec![b'x'; 1024 * 1024 + 1],
    ] {
        let output = invoke(
            &["hook", "--source", "cursor", "--event", "preToolUse"],
            input,
        );
        assert!(output.status.success());
        assert_eq!(output.stdout, b"{\"permission\":\"allow\"}\n");
        assert!(output.stderr.is_empty());
    }
}
#[test]
fn post_claude_and_codex_remain_silent_and_successful() {
    for args in [
        vec!["hook", "--source", "cursor", "--event", "postToolUse"],
        vec!["hook", "--source", "claude"],
        vec!["notify", "--source", "codex", "{invalid"],
        vec!["invalid"],
    ] {
        let output = invoke(&args, b"{}");
        assert!(output.status.success());
        assert!(output.stdout.is_empty());
        assert!(output.stderr.is_empty());
    }
}
#[test]
fn stalled_stdin_does_not_stall_agent() {
    let start = Instant::now();
    let mut child = Command::new(env!("CARGO_BIN_EXE_pit-stop-hook"))
        .args(["hook", "--source", "cursor", "--event", "preToolUse"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // Keep the writer open so the child truly sees no EOF and must enforce its deadline.
    let _held_input = child.stdin.take().unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(start.elapsed() < Duration::from_secs(2));
    assert!(output.status.success());
    assert_eq!(output.stdout, b"{\"permission\":\"allow\"}\n");
}

#[test]
fn authenticated_transport_is_redacted_and_does_not_wait_for_slow_receiver() {
    for infer_commands in [true, false] {
        check_transport(infer_commands);
    }
}

fn check_transport(infer_commands: bool) {
    use pit_stop_core::{
        security::{write_runtime, RuntimeDescriptor},
        Event, Operation,
    };
    use std::{io::Read, net::TcpListener, sync::mpsc};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join("runtime.json");
    let descriptor = RuntimeDescriptor {
        port: listener.local_addr().unwrap().port(),
        pid: std::process::id(),
        startup_id: "bc294ef4-3d1f-419c-8c34-d65d0975721b".into(),
        token: "ab".repeat(32),
        infer_commands,
    };
    write_runtime(&path, &descriptor).unwrap();
    let (sender, receiver) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        socket.read_to_end(&mut bytes).unwrap();
        sender.send(bytes).unwrap();
        // Deliberately never send an HTTP response.
    });
    let start = Instant::now();
    let output = invoke(
        &[
            "hook",
            "--source",
            "cursor",
            "--event",
            "preToolUse",
            "--runtime",
            path.to_str().unwrap(),
        ],
        include_bytes!("../../../fixtures/cursor/pre-tool-use.json"),
    );
    assert!(start.elapsed() < Duration::from_secs(2));
    assert!(output.status.success());
    assert_eq!(output.stdout, b"{\"permission\":\"allow\"}\n");
    let bytes = receiver.recv_timeout(Duration::from_secs(2)).unwrap();
    thread.join().unwrap();
    let request = String::from_utf8(bytes).unwrap();
    assert!(request.starts_with("POST /v1/events HTTP/1.1\r\n"));
    assert!(request.contains(&format!("Authorization: Bearer {}\r\n", descriptor.token)));
    let body = request.split("\r\n\r\n").nth(1).unwrap();
    assert!(!body.contains("private"));
    assert!(!body.contains("DO_NOT_FORWARD"));
    let event: Event = serde_json::from_str(body).unwrap();
    event.validate().unwrap();
    assert_eq!(
        event.operation,
        if infer_commands {
            Operation::Build
        } else {
            Operation::Shell
        }
    );
}

#[test]
fn explicit_post_does_not_print_permission_even_if_payload_lies() {
    let output = invoke(
        &["hook", "--source", "cursor", "--event", "postToolUse"],
        include_bytes!("../../../fixtures/cursor/pre-tool-use.json"),
    );
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
}

#[test]
fn unavailable_listener_and_disabled_inference_are_safe() {
    use pit_stop_core::security::{write_runtime, RuntimeDescriptor};
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join("runtime.json");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    write_runtime(
        &path,
        &RuntimeDescriptor {
            port,
            pid: std::process::id(),
            startup_id: "bc294ef4-3d1f-419c-8c34-d65d0975721b".into(),
            token: "ab".repeat(32),
            infer_commands: false,
        },
    )
    .unwrap();
    let output = invoke(
        &[
            "hook",
            "--source",
            "cursor",
            "--event",
            "preToolUse",
            "--runtime",
            path.to_str().unwrap(),
        ],
        include_bytes!("../../../fixtures/cursor/pre-tool-use.json"),
    );
    assert!(output.status.success());
    assert_eq!(output.stdout, b"{\"permission\":\"allow\"}\n");
    assert!(output.stderr.is_empty());
}
