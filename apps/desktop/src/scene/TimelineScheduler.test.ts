import { describe, it, expect } from "vitest";
import { TimelineScheduler } from "./TimelineScheduler";
import { demoEvent, demoSequence } from "./demo";
import type { PitStopEvent } from "../contracts/events";
const e = (n: number, patch: Partial<PitStopEvent> = {}): PitStopEvent => ({
  version: 1,
  event_id: `e${n}`,
  source: "claude",
  session_key: "s",
  tool_key: `t${n}`,
  kind: "tool.start",
  operation: "edit",
  timestamp_ms: 0,
  duration_ms: null,
  outcome: "unknown",
  ...patch,
});
describe("visual scheduler", () => {
  it("locks shared resources but overlaps independent crew", () => {
    const s = new TimelineScheduler();
    s.push(e(0), 0);
    s.push(e(1), 0);
    s.push(e(2, { operation: "inspect" }), 0);
    expect(s.active).toHaveLength(2);
    expect(s.queue).toHaveLength(1);
    s.tick(2000);
    expect(s.active).toHaveLength(2);
    expect(s.queue).toHaveLength(1);
    s.push(e(0, { event_id: "finish", kind: "tool.finish" }), 2000);
    s.tick(2350);
    expect(s.active.some((x) => x.event.tool_key === "t1")).toBe(true);
  });
  it("coalesces reads and bounds a burst while preserving failure and release", () => {
    const s = new TimelineScheduler();
    for (let i = 0; i < 100; i++) s.push(e(i, { operation: "inspect" }), 0);
    expect(s.active).toHaveLength(1);
    expect(s.coalesced).toBe(99);
    for (let i = 100; i < 1000; i++) s.push(e(i), 0);
    expect(s.queue.length).toBeLessThanOrEqual(24);
    s.push(e(1001, { kind: "tool.finish", outcome: "failure" }), 0);
    expect([...s.active, ...s.queue].some((x) => x.clip.id === "warning")).toBe(
      true,
    );
    s.push(e(1002, { kind: "turn.complete", tool_key: null }), 1);
    expect(s.active.some((x) => x.clip.id === "release")).toBe(true);
    expect(s.queue.length).toBe(0);
  });
  it("gives instant tool results a readable minimum animation", () => {
    const s = new TimelineScheduler();
    s.push(e(1), 0);
    s.push(
      e(1, { event_id: "finish", kind: "tool.finish", outcome: "success" }),
      1,
    );
    s.tick(300);
    expect(s.active).toHaveLength(1);
    s.tick(700);
    expect(s.active).toHaveLength(0);
  });
  it("demo is deterministic and covers every operation, failure and release", () => {
    expect(demoEvent(3, 1, 100)).toEqual(demoEvent(3, 1, 100));
    expect(new Set(demoSequence.map((x) => x.operation)).size).toBe(8);
    expect(demoSequence.some((x) => x.outcome === "failure")).toBe(true);
    expect(demoSequence.some((x) => x.kind === "turn.complete")).toBe(true);
  });
  it("holds a long tool and its resource until finish, then cools down", () => {
    const s = new TimelineScheduler();
    s.push(e(1), 0);
    s.push(e(2, { operation: "test" }), 1);
    s.tick(60_000);
    expect(s.active[0].event.tool_key).toBe("t1");
    expect(s.queue).toHaveLength(1);
    s.push(e(1, { event_id: "done", kind: "tool.finish" }), 60_000);
    s.tick(60_349);
    expect(s.active[0].event.tool_key).toBe("t1");
    s.tick(60_350);
    expect(s.active[0].event.tool_key).toBe("t2");
  });
  it("stale and cancelled operations release their loops without a successful result", () => {
    const s = new TimelineScheduler();
    s.push(e(1), 0);
    s.tick(120_000);
    expect(s.active).toHaveLength(0);
    s.push(e(2), 120_000);
    s.syncOperations(new Set(), 120_100);
    s.tick(120_650);
    expect(s.active).toHaveLength(0);
    expect(s.queue).toHaveLength(0);
    s.push(e(3), 121_000);
    s.push(e(4, { kind: "session.end", tool_key: null }), 121_001);
    expect(s.active.map((x) => x.clip.id)).toEqual(["end"]);
  });
  it("coalesced inspect calls remain active until every tracked call finishes", () => {
    const s = new TimelineScheduler();
    s.push(e(1, { operation: "inspect" }), 0);
    s.push(e(2, { operation: "inspect" }), 10);
    s.push(e(1, { operation: "inspect", kind: "tool.finish" }), 100);
    s.tick(2000);
    expect(s.active).toHaveLength(1);
    expect(s.active[0].pendingTools.size).toBe(1);
    s.push(e(2, { operation: "inspect", kind: "tool.finish" }), 2000);
    s.tick(2350);
    expect(s.active).toHaveLength(0);
  });
  it("caps coalesced tool identities and protects orphan finish signals from read bursts", () => {
    const s = new TimelineScheduler();
    for (let i = 0; i < 1000; i++) s.push(e(i, { operation: "inspect" }), 0);
    expect(s.active[0].pendingTools.size).toBe(200);
    s.push(e(1001, { operation: "inspect", kind: "tool.finish" }), 0);
    for (let i = 1002; i < 2000; i++) s.push(e(i, { operation: "mcp" }), 0);
    expect(s.queue.length).toBe(24);
    expect(s.queue.some((x) => x.event.kind === "tool.finish")).toBe(true);
  });
});
