import { catalog, type ClipId } from "./AnimationCatalog";
import type { Scheduled } from "./TimelineScheduler";

export const smooth = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * x * (10 + x * (-15 + 6 * x));
};
export const MOTION_TAIL = 850;
interface Gesture {
  key: Scheduled | string;
  id: ClipId;
  start: number;
  end: number;
}
const deadline = (entry: Scheduled) =>
  entry.pendingTools.size && entry.finishAt === null
    ? entry.expiresAt
    : entry.finishAt !== null
      ? Math.max(entry.started + entry.clip.min, entry.finishAt + 350)
      : entry.started + entry.clip.duration;

/** Small event-time envelopes, never a frame-dependent lerp. Retiring gestures
 * overlap their successors so rapid edits and edit→test handoffs remain smooth. */
export class MotionTimeline {
  private gestures: Gesture[] = [];
  private current = new Map<Scheduled | string, Gesture>();

  reset() {
    this.gestures = [];
    this.current.clear();
  }
  sync(
    active: readonly Scheduled[],
    running: ReadonlySet<string>,
    now: number,
  ) {
    const seen = new Set<Scheduled | string>();
    const touch = (
      key: Scheduled | string,
      id: ClipId,
      start: number,
      end: number,
    ) => {
      seen.add(key);
      let gesture = this.current.get(key);
      if (!gesture) {
        gesture = { key, id, start, end };
        this.current.set(key, gesture);
        this.gestures.push(gesture);
      }
      gesture.end = end;
    };
    for (const entry of active)
      touch(entry, entry.clip.id, entry.started, deadline(entry));
    for (const operation of running) {
      const id = operation as ClipId;
      if (
        !catalog[id] ||
        active.some((entry) =>
          entry.clip.resources.some((resource) =>
            catalog[id].resources.includes(resource),
          ),
        )
      )
        continue;
      const key = `running:${id}`;
      touch(key, id, this.current.get(key)?.start ?? now, Infinity);
    }
    for (const [key, gesture] of this.current) {
      if (!seen.has(key)) {
        gesture.end = Math.min(gesture.end, now);
        this.current.delete(key);
      }
    }
    this.gestures = this.gestures.filter(
      (gesture) => now < gesture.end + MOTION_TAIL,
    );
    // Event bursts cannot accumulate unbounded trails. Preserve current/high-priority
    // channels; the scheduler already bounds simultaneous resource users.
    while (this.gestures.length > 64) {
      const index = this.gestures.findIndex(
        (gesture) => !this.current.has(gesture.key),
      );
      if (index < 0) break;
      this.gestures.splice(index, 1);
    }
  }
  amount(
    ids: readonly ClipId[],
    now: number,
    reduced: boolean,
    delay = 0,
    attack = 520,
    retreat = 600,
  ) {
    let remaining = 1;
    for (const gesture of this.gestures) {
      if (!ids.includes(gesture.id)) continue;
      const weight = reduced
        ? Number(now >= gesture.start && now < gesture.end)
        : smooth((now - gesture.start - delay) / attack) *
          (1 - smooth((now - gesture.end - delay / 2) / retreat));
      remaining *= 1 - weight;
    }
    return 1 - remaining;
  }
  hasTail(now: number) {
    return this.gestures.some((gesture) => now < gesture.end + MOTION_TAIL);
  }
  get size() {
    return this.gestures.length;
  }
}

const positions = [
  [360, 219],
  [575, 220],
  [363, 367],
  [575, 368],
  [693, 293],
  [274, 183],
  [718, 180],
];
const roles: ClipId[][] = [
  ["edit", "test"],
  ["edit", "test"],
  ["edit", "test"],
  ["edit", "test"],
  ["build", "shell"],
  ["inspect", "mcp", "other"],
  ["delegate"],
];
/** Purposeful travel, then a small lean and slow working motion. All oscillation
 * is weighted by an envelope with zero endpoint velocity and acceleration. */
export function crewPose(
  timeline: MotionTimeline,
  index: number,
  now: number,
  reduced: boolean,
) {
  const weight = timeline.amount(roles[index], now, reduced, index * 45);
  const work = timeline.amount(
    roles[index],
    now,
    reduced,
    300 + index * 45,
    540,
    350,
  );
  const time = reduced ? 0 : now / 1000;
  const direction = index < 2 ? 1 : -1;
  const travel = reduced ? 0 : 4 * weight * (1 - weight);
  const gait = Math.sin(time * 12 + index * 0.7) * travel;
  return {
    x:
      positions[index][0] +
      (index === 4
        ? -31
        : index === 5
          ? -8
          : index === 6
            ? -15
            : index % 2
              ? -5
              : 5) *
        weight,
    y:
      positions[index][1] +
      (index < 4 ? direction * 19 : index === 6 ? 12 : 0) * weight +
      (reduced
        ? 0
        : gait * 1.5 + Math.sin(time * 3.2 + index * 0.8) * work * 0.9),
    rotation: reduced
      ? 0
      : (index === 4 ? -0.08 : direction * 0.07) * work +
        gait * 0.018 +
        Math.sin(time * 2.8 + index) * work * 0.018,
    alpha: index === 6 ? 0.38 + 0.62 * weight : 1,
  };
}

export function carPose(
  id: "arrive" | "release" | undefined,
  progress: number,
  reduced: boolean,
) {
  if (reduced || !id) return { x: 480, y: 299, rotation: 0 };
  const p = Math.max(0, Math.min(1, progress));
  if (id === "release") {
    // The crew clears the wheels before acceleration. Starts at rest, exits
    // beyond the canvas before the release clip's visibility boundary.
    const acceleration = Math.max(0, (p - 0.22) / 0.78);
    return { x: 480 + 1120 * acceleration ** 3, y: 299, rotation: 0 };
  }
  const braking = 1 - (1 - p) ** 4;
  const settle =
    p === 1 ? 0 : Math.sin(p * Math.PI * 2) * Math.sin(p * Math.PI) ** 2;
  return {
    x: -250 + 730 * braking,
    y: 299 + settle * 1.5,
    rotation: settle * 0.003,
  };
}
