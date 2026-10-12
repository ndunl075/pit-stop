import { expect, it, vi } from "vitest";
import { PitLaneScene } from "./PitLaneScene";
import type { PitStopEvent } from "../contracts/events";

const event = (
  kind: PitStopEvent["kind"],
  operation: PitStopEvent["operation"] = "other",
): PitStopEvent => ({
  version: 1,
  event_id: kind,
  source: "codex",
  session_key: "session",
  tool_key: null,
  kind,
  operation,
  timestamp_ms: 0,
  duration_ms: null,
  outcome: "unknown",
});

it("keeps a released car absent when late tool finishes change the status board", () => {
  const scene = new PitLaneScene();
  // Exercise the real event/frame lifecycle without initializing a GPU renderer.
  scene.render = vi.fn();
  scene.event(event("turn.complete"));
  scene.frame(1599, true);
  expect(scene.carVisible).toBe(true);
  scene.frame(1600, true);
  expect(scene.carVisible).toBe(false);
  scene.event(event("tool.finish", "test"));
  scene.board.text = "CHECKING…";
  scene.frame(1650, true);
  expect(scene.carVisible).toBe(false);
  scene.frame(2500, true);
  expect(scene.carVisible).toBe(false);
  scene.event(event("tool.start", "edit"));
  scene.frame(2550, true);
  expect(scene.carVisible).toBe(true);
});

it("settles departure even when a warning remains visible", () => {
  const scene = new PitLaneScene();
  scene.render = vi.fn();
  scene.event(event("turn.complete"));
  scene.frame(1300, true);
  scene.event({ ...event("tool.finish"), outcome: "failure" });
  scene.frame(1600, true);
  expect(
    scene.scheduler.active.some((entry) => entry.clip.id === "warning"),
  ).toBe(true);
  expect(scene.carVisible).toBe(false);
});

it("renders the complete crew retreat before returning the frame loop to sleep", () => {
  const scene = new PitLaneScene();
  scene.render = vi.fn();
  scene.event({ ...event("tool.start", "edit"), tool_key: "edit-1" }, 0);
  scene.frame(1000, true);
  scene.event({ ...event("tool.finish", "edit"), tool_key: "edit-1" }, 1000);
  expect(scene.frame(1350, true).animate).toBe(true);
  expect(scene.scheduler.active).toHaveLength(0);
  expect(scene.frame(2199, false).animate).toBe(true);
  expect(scene.frame(2200, false)).toEqual({ animate: false, wakeAfter: null });
  scene.reset();
  expect(scene.motion.size).toBe(0);
});

it("does not animate reduced-motion retirement tails", () => {
  const scene = new PitLaneScene();
  scene.render = vi.fn();
  scene.options.reduced = true;
  scene.event({ ...event("tool.start", "edit"), tool_key: "edit-1" }, 0);
  scene.event({ ...event("tool.finish", "edit"), tool_key: "edit-1" }, 1000);
  expect(scene.frame(1350, true)).toEqual({ animate: false, wakeAfter: null });
});
