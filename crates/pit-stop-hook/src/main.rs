use pit_stop_core::{normalize, security, Operation, Source};
use std::{
    io::{self, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    time::{Duration, Instant},
};

const MAX_INPUT: usize = 1024 * 1024;
const DEADLINE: Duration = Duration::from_millis(75);

fn main() {
    // Expected failures are intentionally silent. Payloads and bearer tokens never reach stderr.
    std::panic::set_hook(Box::new(|_| {}));
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|v| v.to_string_lossy().into_owned())
        .collect();
    let cursor = args
        .windows(2)
        .any(|w| w[0] == "--source" && w[1] == "cursor");
    let explicit_pre = args
        .windows(2)
        .any(|w| w[0] == "--event" && w[1] == "preToolUse");
    if cursor && explicit_pre {
        let _ = io::stdout().write_all(b"{\"permission\":\"allow\"}\n");
    }
    let _ = std::panic::catch_unwind(|| run(&args, cursor, explicit_pre));
}

fn run(args: &[String], cursor: bool, explicit_pre: bool) -> io::Result<()> {
    let mode = args.first().map(String::as_str).unwrap_or("");
    if !matches!(mode, "hook" | "notify") {
        return Ok(());
    }
    let source = match option(args, "--source") {
        Some("claude") => Source::Claude,
        Some("cursor") => Source::Cursor,
        Some("codex") => Source::Codex,
        _ => return Ok(()),
    };
    let bytes = if mode == "notify" {
        if source != Source::Codex {
            return Ok(());
        }
        let Some(payload) = args
            .last()
            .filter(|v| v.starts_with('{') && v.len() <= MAX_INPUT)
        else {
            return Ok(());
        };
        payload.as_bytes().to_vec()
    } else {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut data = Vec::new();
            let result = io::stdin()
                .take((MAX_INPUT + 1) as u64)
                .read_to_end(&mut data)
                .map(|_| data);
            let _ = sender.send(result);
        });
        let Ok(result) = receiver.recv_timeout(Duration::from_millis(50)) else {
            return Ok(());
        };
        let data = result?;
        if data.len() > MAX_INPUT {
            return Ok(());
        }
        data
    };
    let Ok(input) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Ok(());
    };
    if cursor
        && !explicit_pre
        && option(args, "--event").is_none()
        && input.get("hook_event_name").and_then(|v| v.as_str()) == Some("preToolUse")
    {
        let _ = io::stdout().write_all(b"{\"permission\":\"allow\"}\n");
    }
    let runtime_path = option(args, "--runtime")
        .map(std::path::PathBuf::from)
        .map(Ok)
        .unwrap_or_else(security::runtime_path)?;
    let runtime = security::read_runtime(&runtime_path)?;
    let Some(mut event) = normalize(
        source,
        option(args, "--event"),
        &input,
        runtime.token.as_bytes(),
    ) else {
        return Ok(());
    };
    if !runtime.infer_commands && matches!(event.operation, Operation::Test | Operation::Build) {
        event.operation = Operation::Shell;
    }
    let body = serde_json::to_vec(&event)?;
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, runtime.port));
    let start = Instant::now();
    let mut connection = TcpStream::connect_timeout(&address, DEADLINE)?;
    connection.set_write_timeout(Some(
        DEADLINE
            .saturating_sub(start.elapsed())
            .max(Duration::from_millis(1)),
    ))?;
    // No proxy, DNS resolution, redirect handling, arbitrary address or provider text is involved.
    let header=format!("POST /v1/events HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",runtime.port,runtime.token,body.len());
    let mut request = header.into_bytes();
    request.extend_from_slice(&body);
    connection.write_all(&request)?;
    // Delivery is best effort. The helper never waits for a receiver/animation acknowledgement.
    Ok(())
}
fn option<'a>(args: &'a [String], key: &str) -> Option<&'a str> {
    args.windows(2).find(|w| w[0] == key).map(|w| w[1].as_str())
}
