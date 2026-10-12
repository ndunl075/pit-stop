import type { Operation, PitStopEvent } from "../contracts/events";
export type ClipId = Operation | "arrive" | "release" | "warning" | "end";
export interface Clip {
  id: ClipId;
  priority: number;
  resources: string[];
  duration: number;
  min: number;
}
export const catalog: Record<ClipId, Clip> = {
  arrive: {
    id: "arrive",
    priority: 8,
    resources: ["car"],
    duration: 1200,
    min: 750,
  },
  release: {
    id: "release",
    priority: 10,
    resources: ["car", "front", "wheels", "wall"],
    duration: 1600,
    min: 750,
  },
  warning: {
    id: "warning",
    priority: 9,
    resources: ["signal"],
    duration: 1300,
    min: 750,
  },
  end: { id: "end", priority: 9, resources: ["car"], duration: 700, min: 350 },
  inspect: {
    id: "inspect",
    priority: 1,
    resources: ["wall"],
    duration: 1500,
    min: 450,
  },
  edit: {
    id: "edit",
    priority: 3,
    resources: ["wheels"],
    duration: 1900,
    min: 650,
  },
  test: {
    id: "test",
    priority: 4,
    resources: ["wheels"],
    duration: 1900,
    min: 650,
  },
  build: {
    id: "build",
    priority: 4,
    resources: ["front"],
    duration: 2000,
    min: 650,
  },
  shell: {
    id: "shell",
    priority: 2,
    resources: ["front"],
    duration: 1600,
    min: 450,
  },
  mcp: {
    id: "mcp",
    priority: 2,
    resources: ["wall"],
    duration: 1700,
    min: 450,
  },
  delegate: {
    id: "delegate",
    priority: 3,
    resources: ["extra"],
    duration: 1700,
    min: 500,
  },
  other: {
    id: "other",
    priority: 1,
    resources: ["wall"],
    duration: 1000,
    min: 450,
  },
};
export function clipFor(e: PitStopEvent): Clip {
  return catalog[
    e.outcome === "failure"
      ? "warning"
      : e.kind === "session.start"
        ? "arrive"
        : e.kind === "turn.complete"
          ? "release"
          : e.kind === "session.end"
            ? "end"
            : e.kind.startsWith("subagent.")
              ? "delegate"
              : e.operation
  ];
}
