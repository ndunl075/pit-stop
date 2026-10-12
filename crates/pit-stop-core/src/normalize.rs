use crate::{classify::classify, event::now_ms, Event, Kind, Operation, Outcome, Source};
use serde_json::Value;

fn text<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input
        .get(key)?
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 4096)
}

fn key(source: Source, category: &str, id: &str, secret: &[u8]) -> String {
    let key = blake3::derive_key("pit-stop ephemeral provider identity v1", secret);
    let mut hash = blake3::Hasher::new_keyed(&key);
    hash.update(format!("{source:?}:{category}:").as_bytes());
    hash.update(id.as_bytes());
    hash.finalize().to_hex().to_string()
}

/// Discards every provider-defined string except opaque keyed identifiers. Missing session/tool
/// identities are dropped: inventing shared fallback IDs would incorrectly merge concurrent work.
pub fn normalize(
    source: Source,
    event_override: Option<&str>,
    input: &Value,
    secret: &[u8],
) -> Option<Event> {
    if !input.is_object() || secret.len() < 32 {
        return None;
    }
    let native = event_override.or_else(|| {
        text(
            input,
            if source == Source::Codex {
                "type"
            } else {
                "hook_event_name"
            },
        )
    })?;
    let kind = match (source, native) {
        (Source::Claude, "SessionStart") | (Source::Cursor, "sessionStart") => Kind::SessionStart,
        (Source::Claude, "SessionEnd") | (Source::Cursor, "sessionEnd") => Kind::SessionEnd,
        (Source::Claude, "Stop")
        | (Source::Cursor, "stop")
        | (Source::Codex, "agent-turn-complete") => Kind::TurnComplete,
        (Source::Claude, "PreToolUse") | (Source::Cursor, "preToolUse") => Kind::ToolStart,
        (Source::Claude, "PostToolUse" | "PostToolUseFailure")
        | (Source::Cursor, "postToolUse" | "postToolUseFailure") => Kind::ToolFinish,
        (Source::Claude, "SubagentStart") | (Source::Cursor, "subagentStart") => {
            Kind::SubagentStart
        }
        (Source::Claude, "SubagentStop") | (Source::Cursor, "subagentStop") => Kind::SubagentEnd,
        _ => return None,
    };
    let session_id = text(
        input,
        match source {
            Source::Claude => "session_id",
            Source::Cursor => "conversation_id",
            Source::Codex => "thread-id",
        },
    )?;
    let session_key = key(source, "session", session_id, secret);
    let is_tool = matches!(kind, Kind::ToolStart | Kind::ToolFinish);
    let tool_key = if is_tool {
        Some(key(
            source,
            &format!("tool:{session_key}"),
            text(input, "tool_use_id")?,
            secret,
        ))
    } else {
        None
    };
    let operation = if is_tool {
        classify(
            text(input, "tool_name").unwrap_or(""),
            input
                .get("tool_input")
                .and_then(|v| v.get("command"))
                .and_then(Value::as_str),
        )
    } else if matches!(kind, Kind::SubagentStart | Kind::SubagentEnd) {
        Operation::Delegate
    } else {
        Operation::Other
    };
    let outcome = if kind != Kind::ToolFinish {
        Outcome::Unknown
    } else if matches!(native, "PostToolUseFailure" | "postToolUseFailure") {
        Outcome::Failure
    }
    // This means reported tool success only; it does not establish a test/build passed.
    else {
        Outcome::Success
    };
    let duration_ms = if source == Source::Cursor && kind == Kind::ToolFinish {
        input
            .get("duration")
            .and_then(Value::as_u64)
            .filter(|n| *n <= 86_400_000)
    } else {
        None
    };
    // Codex retries of the same turn get the same opaque UUID, enabling deduplication without
    // a new freeform turn field. Other hook events get independent random IDs.
    let event_id = if source == Source::Codex {
        text(input, "turn-id")
            .map(|turn| {
                let digest = key(source, &format!("turn:{session_key}"), turn, secret);
                let mut bytes = [0u8; 16];
                for (i, byte) in bytes.iter_mut().enumerate() {
                    *byte = u8::from_str_radix(&digest[i * 2..i * 2 + 2], 16).unwrap_or(0);
                }
                uuid::Builder::from_random_bytes(bytes)
                    .into_uuid()
                    .to_string()
            })
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
    } else {
        uuid::Uuid::new_v4().to_string()
    };
    let event = Event {
        version: 1,
        event_id,
        source,
        session_key,
        tool_key,
        kind,
        operation,
        timestamp_ms: now_ms(),
        duration_ms,
        outcome,
    };
    event.validate().ok()?;
    Some(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const SECRET: &[u8] = &[42; 32];
    #[test]
    fn sensitive_fields_never_escape() {
        let payload = json!({"hook_event_name":"PreToolUse","session_id":"SECRET_ID","tool_use_id":"SECRET_TOOL","tool_name":"Bash","tool_input":{"command":"cargo test","api_key":"SECRET_KEY"},"cwd":"SECRET_PATH","prompt":"SECRET_PROMPT"});
        let event = normalize(Source::Claude, None, &payload, SECRET).unwrap();
        assert_eq!(event.operation, Operation::Test);
        assert!(!serde_json::to_string(&event).unwrap().contains("SECRET"));
        assert_eq!(
            event.session_key,
            normalize(Source::Claude, None, &payload, SECRET)
                .unwrap()
                .session_key
        );
        assert_ne!(
            event.session_key,
            normalize(Source::Claude, None, &payload, &[99; 32])
                .unwrap()
                .session_key
        );
        assert_ne!(
            event.session_key,
            normalize(
                Source::Cursor,
                Some("preToolUse"),
                &json!({"conversation_id":"SECRET_ID","tool_use_id":"SECRET_TOOL"}),
                SECRET
            )
            .unwrap()
            .session_key
        );
    }
    #[test]
    fn missing_ids_and_unknown_events_drop() {
        for v in [
            json!({}),
            json!({"hook_event_name":"PreToolUse","session_id":"s"}),
            json!({"hook_event_name":"Unknown","session_id":"s"}),
            json!({"hook_event_name":"Stop"}),
        ] {
            assert!(normalize(Source::Claude, None, &v, SECRET).is_none());
        }
        assert!(normalize(
            Source::Codex,
            None,
            &json!({"type":"tool.start","thread-id":"s"}),
            SECRET
        )
        .is_none());
    }
    #[test]
    fn provider_mappings_and_honest_results() {
        let e=normalize(Source::Codex,None,&json!({"type":"agent-turn-complete","thread-id":"s","turn-id":"t","last-assistant-message":"SECRET"}),SECRET).unwrap();
        assert_eq!(e.kind, Kind::TurnComplete);
        assert_eq!(e.operation, Operation::Other);
        assert_eq!(e.tool_key, None);
        let v = json!({"conversation_id":"s","tool_use_id":"t","tool_name":"Shell","tool_input":{"command":"npm test"},"duration":5});
        let e = normalize(Source::Cursor, Some("postToolUse"), &v, SECRET).unwrap();
        assert_eq!(e.outcome, Outcome::Success);
        assert_eq!(e.duration_ms, Some(5));
        assert_eq!(
            normalize(Source::Cursor, Some("postToolUseFailure"), &v, SECRET)
                .unwrap()
                .outcome,
            Outcome::Failure
        );
    }
    #[test]
    fn rejects_injected_schema_fields() {
        let mut v = serde_json::to_value(
            normalize(
                Source::Codex,
                None,
                &json!({"type":"agent-turn-complete","thread-id":"s"}),
                SECRET,
            )
            .unwrap(),
        )
        .unwrap();
        v["prompt"] = json!("SECRET");
        assert!(serde_json::from_value::<Event>(v).is_err());
    }
}
