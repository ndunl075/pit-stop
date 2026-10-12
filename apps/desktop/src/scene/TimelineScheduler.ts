import type { PitStopEvent } from "../contracts/events";
import { clipFor, type Clip } from "./AnimationCatalog";
export interface Scheduled {
  clip: Clip;
  event: PitStopEvent;
  count: number;
  started: number;
  finishAt: number | null;
  expiresAt: number;
  pendingTools: Set<string>;
}
const toolIdentity = (event: PitStopEvent) =>
  `${event.source}:${event.session_key}:${event.tool_key ?? event.event_id}`;
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
          event.tool_key !== null && x.pendingTools.has(toolIdentity(event)),
      );
      if (existing) {
        existing.pendingTools.delete(toolIdentity(event));
        if (!existing.pendingTools.size) existing.finishAt = now;
      }
      if (existing && event.outcome !== "failure") return;
    }
    const base = clipFor(event);
    const clip =
      event.kind === "tool.finish"
        ? { ...base, priority: Math.max(base.priority, 6) }
        : base;
    if (clip.id === "inspect" && event.kind === "tool.start") {
      const same = [...this.queue, ...this.active].find(
        (x) =>
          x.clip.id === "inspect" &&
          x.event.kind === "tool.start" &&
          x.finishAt === null,
      );
      if (same) {
        same.count++;
        same.pendingTools.add(toolIdentity(event));
        while (same.pendingTools.size > 200)
          same.pendingTools.delete(same.pendingTools.values().next().value!);
        same.expiresAt = now + 120_000;
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
      expiresAt: now + 120_000,
      pendingTools: new Set(
        event.kind === "tool.start" ? [toolIdentity(event)] : [],
      ),
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
      return now < this.deadline(x);
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
  private deadline(x: Scheduled) {
    if (x.pendingTools.size && x.finishAt === null) return x.expiresAt;
    if (x.finishAt !== null)
      return Math.max(x.started + x.clip.min, x.finishAt + 350);
    return x.started + x.clip.duration;
  }
  nextTransition(now: number): number | null {
    return this.active.length
      ? Math.max(1, Math.min(...this.active.map((x) => this.deadline(x))) - now)
      : null;
  }
  syncOperations(running: ReadonlySet<string>, now: number) {
    for (const x of [...this.active, ...this.queue]) {
      if (x.pendingTools.size && !running.has(x.event.operation)) {
        x.pendingTools.clear();
        x.finishAt = now;
      }
    }
  }
}
