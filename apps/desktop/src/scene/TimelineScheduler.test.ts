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
    expect(s.active).toHaveLength(1);
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
});
