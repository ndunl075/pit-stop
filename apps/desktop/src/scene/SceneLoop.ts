export interface FrameEnvironment {
  now(): number;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(id: number): void;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(id: number): void;
}
interface FrameResult {
  animate: boolean;
  wakeAfter: number | null;
}
const browserEnvironment: FrameEnvironment = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (id) => window.clearTimeout(id),
};
/** Sleeps completely at rest; hidden/paused time never advances the presentation clock. */
export class SceneLoop {
  clock = 0;
  private last = 0;
  private lastDraw = 0;
  private pending: { kind: "frame" | "timer"; id: number } | null = null;
  private dirty = true;
  private stopped = false;
  private paused = false;
  private hidden = false;
  private fps: 30 | 60 = 60;
  constructor(
    private draw: (clock: number, dirty: boolean) => FrameResult,
    private env = browserEnvironment,
  ) {}
  time() {
    if (this.pending && !this.paused && !this.hidden && !this.stopped) {
      const now = this.env.now();
      this.clock += Math.max(0, now - this.last);
      this.last = now;
    }
    return this.clock;
  }
  configure(options: { paused: boolean; hidden: boolean; fps: 30 | 60 }) {
    this.time();
    this.cancel();
    this.paused = options.paused;
    this.hidden = options.hidden;
    this.fps = options.fps;
    this.wake();
  }
  wake() {
    this.dirty = true;
    if (this.stopped || this.paused || this.hidden) return;
    // Incoming signals interrupt a reduced-motion sleep without postponing an active frame.
    if (this.pending?.kind === "timer") {
      this.env.clearTimer(this.pending.id);
      this.pending = { kind: "frame", id: this.env.requestFrame(this.step) };
    } else if (!this.pending) {
      this.last = this.env.now();
      this.lastDraw = this.last;
      this.pending = { kind: "frame", id: this.env.requestFrame(this.step) };
    }
  }
  reset() {
    this.clock = 0;
    this.last = this.env.now();
    this.lastDraw = this.last;
    this.wake();
  }
  private step = (now: number) => {
    this.pending = null;
    if (this.stopped || this.paused || this.hidden) return;
    const dt = Math.max(0, now - this.last);
    if (now - this.lastDraw < 1000 / this.fps - 0.5) {
      this.pending = { kind: "frame", id: this.env.requestFrame(this.step) };
      return;
    }
    this.clock += dt;
    this.last = now;
    this.lastDraw = now;
    const result = this.draw(this.clock, this.dirty);
    this.dirty = false;
    if (result.animate)
      this.pending = { kind: "frame", id: this.env.requestFrame(this.step) };
    else if (result.wakeAfter !== null)
      this.pending = {
        kind: "timer",
        id: this.env.setTimer(
          () => this.step(this.env.now()),
          Math.max(1, result.wakeAfter),
        ),
      };
  };
  private cancel() {
    if (this.pending?.kind === "frame") this.env.cancelFrame(this.pending.id);
    if (this.pending?.kind === "timer") this.env.clearTimer(this.pending.id);
    this.pending = null;
  }
  destroy() {
    this.stopped = true;
    this.cancel();
  }
}
