import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneLoop, type FrameEnvironment } from "./SceneLoop";
let wall = 0;
const environment: FrameEnvironment = {
  now: () => wall,
  requestFrame: (callback) =>
    setTimeout(() => callback(wall), 17) as unknown as number,
  cancelFrame: (id) => clearTimeout(id),
  setTimer: (callback, delay) =>
    setTimeout(callback, delay) as unknown as number,
  clearTimer: (id) => clearTimeout(id),
};
function advance(ms: number) {
  for (let i = 0; i < ms; i++) {
    wall++;
    vi.advanceTimersByTime(1);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  wall = 0;
});
afterEach(() => vi.useRealTimers());
describe("power-aware presentation loop", () => {
  it("renders once at rest and schedules no idle polling", () => {
    const draw = vi.fn(() => ({ animate: false, wakeAfter: null }));
    const loop = new SceneLoop(draw, environment);
    loop.wake();
    advance(10_000);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    loop.wake();
    advance(17);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(loop.clock).toBe(34);
  });
  it("cancels hidden and paused work and excludes that time on resume", () => {
    const draw = vi.fn(() => ({ animate: true, wakeAfter: null }));
    const loop = new SceneLoop(draw, environment);
    loop.wake();
    advance(34);
    expect(draw).toHaveBeenCalledTimes(2);
    loop.configure({ hidden: true, paused: false, fps: 60 });
    expect(vi.getTimerCount()).toBe(0);
    advance(20_000);
    loop.wake();
    expect(vi.getTimerCount()).toBe(0);
    loop.configure({ hidden: false, paused: false, fps: 60 });
    advance(17);
    expect(loop.clock).toBe(51);
    loop.configure({ hidden: false, paused: true, fps: 60 });
    advance(20_000);
    expect(loop.clock).toBe(51);
    expect(vi.getTimerCount()).toBe(0);
    loop.destroy();
    loop.wake();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reduced motion sleeps until the next static transition, with immediate signal wakeup", () => {
    const draw = vi.fn(() => ({ animate: false, wakeAfter: 1000 }));
    const loop = new SceneLoop(draw, environment);
    loop.wake();
    advance(17);
    advance(500);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(loop.time()).toBe(517);
    loop.wake();
    advance(17);
    expect(draw).toHaveBeenCalledTimes(2);
    advance(999);
    expect(draw).toHaveBeenCalledTimes(2);
    advance(1);
    expect(draw).toHaveBeenCalledTimes(3);
    loop.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("30fps limits drawing and rapid events cannot postpone an active frame forever", () => {
    const draw = vi.fn(() => ({ animate: true, wakeAfter: null }));
    const loop = new SceneLoop(draw, environment);
    loop.configure({ hidden: false, paused: false, fps: 30 });
    advance(1000);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(30);
    for (let i = 0; i < 100; i++) {
      loop.time();
      loop.wake();
      advance(1);
    }
    expect(draw.mock.calls.length).toBeGreaterThan(30);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(33);
    expect(loop.clock).toBeGreaterThan(1000);
    loop.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
