import type { PitStopEvent } from "../contracts/events";
import { clipFor, type Clip } from "./AnimationCatalog";
export interface Scheduled {
  clip: Clip;
  event: PitStopEvent;
  count: number;
  started: number;
  finishAt: number | null;
}
/** Presentation time is supplied by the renderer, so pause and deterministic captures agree. */
export class TimelineScheduler {
  queue: Scheduled[] = [];
  active: Scheduled[] = [];
  coalesced = 0;
  dropped = 0;
  reset() {
    this.queue = [];
    this.active = [];
    this.coalesced = 0;
    this.dropped = 0;
  }
  push(event: PitStopEvent, now: number) {
    if (event.kind === "tool.finish") {
      const existing = [...this.active, ...this.queue].find(
        (x) =>
          x.event.tool_key === event.tool_key &&
          x.event.source === event.source &&
          x.event.session_key === event.session_key &&
          x.event.kind === "tool.start",
      );
      if (existing) existing.finishAt = now;
      if (existing && event.outcome !== "failure") return;
    }
    const clip = clipFor(event);
    if (clip.id === "inspect") {
      const same = [...this.queue, ...this.active].find(
        (x) => x.clip.id === "inspect",
      );
      if (same) {
        same.count++;
        this.coalesced++;
        return;
      }
    }
    const entry = {
      clip,
      event,
      count: 1,
      started: now,
      finishAt: event.kind === "tool.finish" ? now : null,
    };
    if (clip.id === "release" || clip.id === "end") {
      this.queue = [];
      this.active = this.active.filter((x) => x.clip.id === "warning");
    }
    if (this.queue.length >= 24) {
      const low = this.queue.reduce((a, b) =>
        a.clip.priority <= b.clip.priority ? a : b,
      );
      if (low.clip.priority > clip.priority) {
        this.dropped++;
        return;
      }
      this.queue.splice(this.queue.indexOf(low), 1);
      this.dropped++;
    }
    this.queue.push(entry);
    this.queue.sort((a, b) => b.clip.priority - a.clip.priority);
    this.tick(now);
  }
  tick(now: number) {
    this.active = this.active.filter((x) => {
      const elapsed = now - x.started;
      return (
        elapsed < x.clip.duration &&
        (x.finishAt === null || elapsed < x.clip.min || now - x.finishAt < 350)
      );
    });
    for (let i = 0; i < this.queue.length; ) {
      const x = this.queue[i];
      if (
        this.active.some((a) =>
          a.clip.resources.some((r) => x.clip.resources.includes(r)),
        )
      ) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      x.started = now;
      this.active.push(x);
    }
    return this.active;
  }
}
