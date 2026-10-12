export type Source = "claude" | "cursor" | "codex";
export type Kind =
  | "session.start"
  | "session.end"
  | "turn.complete"
  | "tool.start"
  | "tool.finish"
  | "subagent.start"
  | "subagent.end";
export type Operation =
  | "inspect"
  | "edit"
  | "test"
  | "build"
  | "shell"
  | "mcp"
  | "delegate"
  | "other";
export type Outcome = "unknown" | "success" | "failure";
export interface PitStopEvent {
  version: 1;
  event_id: string;
  source: Source;
  session_key: string;
  tool_key: string | null;
  kind: Kind;
  operation: Operation;
  timestamp_ms: number;
  duration_ms: number | null;
  outcome: Outcome;
}
export const operationLabels: Record<Operation, string> = {
  inspect: "Inspecting",
  edit: "Editing",
  test: "Running tests",
  build: "Building",
  shell: "Running a command",
  mcp: "Receiving a tool signal",
  delegate: "Calling in the crew",
  other: "Working",
};
export function eventLabel(e: PitStopEvent): string {
  if (e.outcome === "failure") return "Tool failed";
  if (e.kind === "turn.complete") return "Turn finished";
  if (e.kind === "session.start") return "Rolling into the pit";
  if (e.kind === "session.end") return "Session ended";
  if (e.kind === "subagent.start") return "Extra hands on deck";
  if (e.kind === "subagent.end") return "Extra crew finished";
  return (
    operationLabels[e.operation] +
    (e.kind === "tool.finish" ? " · tool finished" : "")
  );
}
export function sessionId(e: Pick<PitStopEvent, "source" | "session_key">) {
  return `${e.source}:${e.session_key}`;
}
