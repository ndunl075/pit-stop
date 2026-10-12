import { describe, expect, it } from "vitest";
import { catalog } from "./AnimationCatalog";
import {
  carPose,
  crewPose,
  MotionTimeline,
  MOTION_TAIL,
  smooth,
} from "./MotionTimeline";
import type { Scheduled } from "./TimelineScheduler";

function gesture(id: "edit" | "test" = "edit", start = 0): Scheduled {
  return {
    clip: catalog[id],
    started: start,
    finishAt: null,
    expiresAt: start + 120_000,
    pendingTools: new Set(["tool"]),
    count: 1,
    event: {
      version: 1,
      event_id: `${id}-${start}`,
      source: "claude",
      session_key: "session",
      tool_key: "tool",
      kind: "tool.start",
      operation: id,
      timestamp_ms: start,
      duration_ms: null,
      outcome: "unknown",
    },
  };
}
const noRunning = new Set<string>();
const distance = (
  a: ReturnType<typeof crewPose>,
  b: ReturnType<typeof crewPose>,
) => Math.hypot(a.x - b.x, a.y - b.y);

describe("deterministic crew choreography", () => {
  it("approaches in a stagger, with continuous zero-speed attack and retreat endpoints", () => {
    const motion = new MotionTimeline(),
      entry = gesture();
    motion.sync([entry], noRunning, 0);
    expect(crewPose(motion, 0, 0, false).y).toBe(219);
    expect(crewPose(motion, 0, 180, false).y - 219).toBeGreaterThan(
      crewPose(motion, 1, 180, false).y - 220,
    );
    expect(
      distance(crewPose(motion, 0, 0, false), crewPose(motion, 0, 1, false)),
    ).toBeLessThan(0.001);
    entry.finishAt = 1000;
    motion.sync([entry], noRunning, 1000);
    motion.sync([], noRunning, 1350);
    expect(
      distance(
        crewPose(motion, 0, 1349.99, false),
        crewPose(motion, 0, 1350.01, false),
      ),
    ).toBeLessThan(0.001);
    expect(
      distance(
        crewPose(motion, 0, 1949, false),
        crewPose(motion, 0, 1950, false),
      ),
    ).toBeLessThan(0.001);
    expect(crewPose(motion, 0, 1950, false)).toEqual({
      x: 360,
      y: 219,
      rotation: 0,
      alpha: 1,
    });
  });
  it("keeps crew continuous when work restarts mid-retreat or changes from edit to test", () => {
    for (const id of ["edit", "test"] as const) {
      const motion = new MotionTimeline(),
        entry = gesture();
      motion.sync([entry], noRunning, 0);
      entry.finishAt = 1000;
      motion.sync([entry], noRunning, 1000);
      motion.sync([], noRunning, 1350);
      const before = crewPose(motion, 0, 1520, false);
      motion.sync([gesture(id, 1520)], noRunning, 1520);
      expect(crewPose(motion, 0, 1520, false)).toEqual(before);
      expect(
        distance(before, crewPose(motion, 0, 1520.01, false)),
      ).toBeLessThan(0.01);
      expect(crewPose(motion, 0, 2300, false).y).toBeGreaterThan(236);
    }
  });
  it("agrees for sparse seeks and 60fps sampling, including known clip expiration", () => {
    const sample = (frames: number[]) => {
      const motion = new MotionTimeline(),
        entry = gesture();
      motion.sync([entry], noRunning, 0);
      entry.finishAt = 1000;
      motion.sync([entry], noRunning, 1000);
      let active = true;
      for (const at of frames) {
        if (active) motion.sync([entry], noRunning, at);
        if (at >= 1350) {
          motion.sync([], noRunning, at);
          active = false;
        }
        crewPose(motion, 2, at, false);
      }
      return crewPose(motion, 2, 1570, false);
    };
    expect(sample([1570])).toEqual(
      sample(Array.from({ length: 35 }, (_, i) => 1000 + i * 16.5)),
    );
  });
  it("holds long operations, finishes tails, stays bounded under bursts, and resets", () => {
    const motion = new MotionTimeline(),
      entry = gesture();
    motion.sync([entry], noRunning, 0);
    expect(motion.amount(["edit"], 119_000, false)).toBe(1);
    motion.sync([], noRunning, 120_000);
    expect(motion.hasTail(120_000 + MOTION_TAIL - 1)).toBe(true);
    expect(motion.hasTail(120_000 + MOTION_TAIL)).toBe(false);
    for (let i = 0; i < 1000; i++)
      motion.sync([gesture("edit", i)], noRunning, i);
    expect(motion.size).toBeLessThanOrEqual(64);
    motion.reset();
    expect(motion.hasTail(1000)).toBe(false);
    expect(motion.size).toBe(0);
  });
  it("renders reduced-motion work poses without gait, rotation, or time oscillation", () => {
    const motion = new MotionTimeline();
    motion.sync([gesture()], noRunning, 0);
    expect(crewPose(motion, 2, 10, true)).toEqual(
      crewPose(motion, 2, 30_000, true),
    );
    expect(crewPose(motion, 2, 10, true).rotation).toBe(0);
  });
});

it("brakes smoothly at the bay and accelerates from rest after the crew clears", () => {
  const arrival = Array.from(
    { length: 101 },
    (_, i) => carPose("arrive", i / 100, false).x,
  );
  expect(arrival[0]).toBe(-250);
  expect(arrival[100]).toBe(480);
  expect(arrival.every((x, i) => i === 0 || x >= arrival[i - 1])).toBe(true);
  expect(arrival[100] - arrival[99]).toBeLessThan(0.001);
  expect(carPose("release", 0.22, false).x).toBe(480);
  expect(carPose("release", 0.221, false).x - 480).toBeLessThan(0.001);
  expect(carPose("release", 1, false).x).toBeGreaterThan(1140);
  expect(carPose("arrive", 1, false)).toEqual(carPose(undefined, 0, false));
  expect(carPose("release", 0.7, true)).toEqual(carPose("arrive", 0.1, true));
  expect(smooth(-1)).toBe(0);
  expect(smooth(2)).toBe(1);
});
