import { describe, it, expect } from "vitest";
import {
  emptyState,
  reduceEvent,
  expireTools,
  sessionStatus,
} from "./eventStore";
import type { PitStopEvent } from "../contracts/events";
let n = 0;
const event = (patch: Partial<PitStopEvent> = {}): PitStopEvent => ({
  version: 1,
  event_id: `e-${n++}`,
  source: "claude",
  session_key: "one",
  tool_key: "tool",
  kind: "tool.start",
  operation: "test",
  timestamp_ms: 1000,
  duration_ms: null,
  outcome: "unknown",
  ...patch,
});
describe("bounded session reducer", () => {
  it("keeps concurrent tools distinct and a successful tool does not claim tests passed", () => {
    let s = reduceEvent(emptyState(), event(), 1000);
    s = reduceEvent(s, event({ tool_key: "second" }), 1100);
    s = reduceEvent(
      s,
      event({ kind: "tool.finish", outcome: "success" }),
      1200,
    );
    expect(s.sessions.get("claude:one")?.tools.size).toBe(2);
    expect(sessionStatus(s.sessions.get("claude:one"))).toBe("Working");
    expect(s.sessions.get("claude:one")?.tools.get("tool")?.event.outcome).toBe(
      "success",
    );
  });
  it("ignores duplicates and finish-before-start preserves unknown start time", () => {
    const finish = event({ kind: "tool.finish" });
    const s = reduceEvent(emptyState(), finish, 1000);
    expect(reduceEvent(s, finish, 1001)).toBe(s);
    expect(reduceEvent(s, event(), 1002)).toBe(s);
    expect(
      s.sessions.get("claude:one")?.tools.get("tool")?.startedAt,
    ).toBeNull();
    expect(reduceEvent(s, event({ kind: "tool.finish" }), 1003)).toBe(s);
  });
  it("marks interrupted and stale tools unknown, never failed or passed", () => {
    let s = reduceEvent(emptyState(), event(), 0);
    s = expireTools(s, 120001);
    expect(sessionStatus(s.sessions.get("claude:one"))).toBe("Unknown");
    expect(s.sessions.get("claude:one")?.tools.get("tool")?.event.outcome).toBe(
      "unknown",
    );
    s = reduceEvent(emptyState(), event(), 0);
    s = reduceEvent(s, event({ kind: "session.end", tool_key: null }), 100);
    expect(s.sessions.get("claude:one")?.tools.get("tool")?.state).toBe(
      "unknown",
    );
    expect(reduceEvent(s, event(), 101)).toBe(s);
  });
  it("bounds every collection under a 6000-event burst across 20 sessions", () => {
    let s = emptyState();
    for (let i = 0; i < 6000; i++)
      s = reduceEvent(
        s,
        event({ session_key: `s${i % 20}`, tool_key: `t${i}` }),
        i,
      );
    expect(s.events).toHaveLength(200);
    expect(s.seen.size).toBe(200);
    expect(s.sessions.size).toBe(8);
    let single = emptyState();
    for (let i = 0; i < 1000; i++)
      single = reduceEvent(single, event({ tool_key: `t${i}` }), i);
    expect(single.sessions.get("claude:one")?.tools.size).toBe(200);
  });
  it("separates identical opaque keys from different sources", () => {
    let s = reduceEvent(emptyState(), event(), 0);
    s = reduceEvent(s, event({ source: "cursor" }), 1);
    expect(s.sessions.size).toBe(2);
  });
  it("accepts honest completion-only Codex without inventing a tool", () => {
    const s = reduceEvent(
      emptyState(),
      event({ source: "codex", kind: "turn.complete", tool_key: null }),
      0,
    );
    expect(s.sessions.get("codex:one")?.tools.size).toBe(0);
    expect(sessionStatus(s.sessions.get("codex:one"), 0)).toBe("Finishing");
    expect(sessionStatus(s.sessions.get("codex:one"), 1599)).toBe("Finishing");
    expect(sessionStatus(s.sessions.get("codex:one"), 1600)).toBe("Waiting");
    expect(s.sessions.get("codex:one")?.tools.size).toBe(0);
  });
});
