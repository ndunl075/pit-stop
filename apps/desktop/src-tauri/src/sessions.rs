use pit_stop_core::{Event, Kind};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};

#[derive(Default)]
pub struct Sessions {
    history: VecDeque<Event>,
    seen: VecDeque<String>,
    sessions: VecDeque<String>,
    running: HashMap<String, u64>,
    terminal: VecDeque<String>,
    pub accepted: u64,
    pub duplicates: u64,
    pub stale: u64,
    pub last_event_ms: Option<u64>,
}
#[derive(Serialize)]
pub struct Summary {
    pub accepted: u64,
    pub duplicates: u64,
    pub stale: u64,
    pub active_tools: usize,
    pub sessions: usize,
    pub history: usize,
    pub last_event_ms: Option<u64>,
}
impl Sessions {
    pub fn has_session(&self, source: pit_stop_core::Source, key: &str) -> bool {
        self.history
            .iter()
            .any(|event| event.source == source && event.session_key == key)
    }
    pub fn accept(&mut self, event: Event) -> Option<Event> {
        if self.seen.contains(&event.event_id) {
            self.duplicates += 1;
            return None;
        }
        self.seen.push_back(event.event_id.clone());
        while self.seen.len() > 512 {
            self.seen.pop_front();
        }
        let source = serde_json::to_string(&event.source).unwrap_or_default();
        let session = format!("{}:{}", source, event.session_key);
        if let Some(index) = self.sessions.iter().position(|s| s == &session) {
            self.sessions.remove(index);
        }
        self.sessions.push_back(session.clone());
        while self.sessions.len() > 8 {
            if let Some(old) = self.sessions.pop_front() {
                self.running
                    .retain(|k, _| !k.starts_with(&format!("{old}:")));
            }
        }
        let kind = event.kind;
        if let Some(tool) = &event.tool_key {
            let key = format!("{}:{}", session, tool);
            match kind {
                Kind::ToolStart => {
                    if self.terminal.contains(&key) || self.running.contains_key(&key) {
                        self.duplicates += 1;
                        return None;
                    }
                    if self.running.len() < 256 {
                        self.running.insert(key, event.timestamp_ms);
                    }
                }
                Kind::ToolFinish => {
                    if self.terminal.contains(&key) {
                        self.duplicates += 1;
                        return None;
                    }
                    self.running.remove(&key);
                    self.terminal.push_back(key);
                    while self.terminal.len() > 512 {
                        self.terminal.pop_front();
                    }
                }
                _ => {}
            }
        }
        if matches!(kind, Kind::SessionEnd | Kind::TurnComplete) {
            self.running
                .retain(|k, _| !k.starts_with(&format!("{session}:")));
        }
        self.accepted += 1;
        self.last_event_ms = Some(event.timestamp_ms);
        self.history.push_back(event.clone());
        while self.history.len() > 200 {
            self.history.pop_front();
        }
        Some(event)
    }
    pub fn expire(&mut self, now: u64) {
        let before = self.running.len();
        self.running.retain(|_, t| now.saturating_sub(*t) < 300_000);
        self.stale += (before - self.running.len()) as u64;
    }
    pub fn summary(&self) -> Summary {
        Summary {
            accepted: self.accepted,
            duplicates: self.duplicates,
            stale: self.stale,
            active_tools: self.running.len(),
            sessions: self.sessions.len(),
            history: self.history.len(),
            last_event_ms: self.last_event_ms,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use pit_stop_core::{Operation, Outcome, Source};
    fn event(kind: Kind, session: u8, tool: u8) -> Event {
        Event {
            version: 1,
            event_id: uuid::Uuid::new_v4().to_string(),
            source: Source::Claude,
            session_key: format!("{session:064x}"),
            tool_key: matches!(kind, Kind::ToolStart | Kind::ToolFinish)
                .then(|| format!("{tool:064x}")),
            kind,
            operation: Operation::Edit,
            timestamp_ms: crate::app::now_ms(),
            duration_ms: None,
            outcome: Outcome::Unknown,
        }
    }
    #[test]
    fn duplicates_and_terminal_transitions() {
        let mut s = Sessions::default();
        let start = event(Kind::ToolStart, 1, 1);
        assert!(s.accept(start.clone()).is_some());
        assert!(s.accept(start).is_none());
        assert!(s.accept(event(Kind::ToolFinish, 1, 1)).is_some());
        assert!(s.accept(event(Kind::ToolFinish, 1, 1)).is_none());
        assert!(s.accept(event(Kind::ToolStart, 1, 1)).is_none());
        assert_eq!(s.summary().active_tools, 0);
    }
    #[test]
    fn concurrent_tools_stop_and_stale() {
        let mut s = Sessions::default();
        s.accept(event(Kind::ToolStart, 1, 1));
        s.accept(event(Kind::ToolStart, 1, 2));
        s.accept(event(Kind::ToolStart, 2, 1));
        s.accept(event(Kind::SessionEnd, 1, 0));
        assert_eq!(s.summary().active_tools, 1);
        s.expire(u64::MAX);
        assert_eq!(s.summary().active_tools, 0);
        assert_eq!(s.stale, 1);
    }
    #[test]
    fn memory_is_bounded_under_load() {
        let mut s = Sessions::default();
        for n in 0..6000 {
            s.accept(event(Kind::ToolFinish, (n % 16) as u8, (n % 255) as u8));
        }
        assert!(s.history.len() <= 200);
        assert!(s.sessions.len() <= 8);
        assert!(s.seen.len() <= 512);
        assert!(s.terminal.len() <= 512);
    }
}
