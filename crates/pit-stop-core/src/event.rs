use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Claude,
    Cursor,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Kind {
    #[serde(rename = "session.start")]
    SessionStart,
    #[serde(rename = "session.end")]
    SessionEnd,
    #[serde(rename = "turn.complete")]
    TurnComplete,
    #[serde(rename = "tool.start")]
    ToolStart,
    #[serde(rename = "tool.finish")]
    ToolFinish,
    #[serde(rename = "subagent.start")]
    SubagentStart,
    #[serde(rename = "subagent.end")]
    SubagentEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Inspect,
    Edit,
    Test,
    Build,
    Shell,
    Mcp,
    Delegate,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Unknown,
    Success,
    Failure,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub version: u8,
    pub event_id: String,
    pub source: Source,
    pub session_key: String,
    pub tool_key: Option<String>,
    pub kind: Kind,
    pub operation: Operation,
    pub timestamp_ms: u64,
    pub duration_ms: Option<u64>,
    pub outcome: Outcome,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn opaque_key(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl Event {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("unsupported_version".into());
        }
        let id = uuid::Uuid::parse_str(&self.event_id).map_err(|_| "invalid_event_id")?;
        if id.to_string() != self.event_id || id.is_nil() {
            return Err("invalid_event_id".into());
        }
        if !opaque_key(&self.session_key)
            || self.tool_key.as_deref().is_some_and(|k| !opaque_key(k))
        {
            return Err("invalid_opaque_key".into());
        }
        if self.timestamp_ms < 1_577_836_800_000
            || self.timestamp_ms > now_ms().saturating_add(300_000)
        {
            return Err("invalid_timestamp".into());
        }
        if self.duration_ms.is_some_and(|d| d > 86_400_000) {
            return Err("invalid_duration".into());
        }
        if matches!(self.kind, Kind::ToolStart | Kind::ToolFinish) != self.tool_key.is_some() {
            return Err("invalid_tool_key".into());
        }
        if self.kind != Kind::ToolFinish
            && (self.outcome != Outcome::Unknown || self.duration_ms.is_some())
        {
            return Err("invalid_outcome".into());
        }
        if self.source == Source::Codex
            && (self.kind != Kind::TurnComplete || self.operation != Operation::Other)
        {
            return Err("codex_completion_only".into());
        }
        Ok(())
    }
}
