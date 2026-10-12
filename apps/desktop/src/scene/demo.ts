import sequence from "../../../../fixtures/demo-sequence.json";
import type {
  Kind,
  Operation,
  Outcome,
  PitStopEvent,
} from "../contracts/events";
export const DEMO_DURATION = 19000;
export const demoSequence = sequence;
export function demoEvent(
  index: number,
  loop: number,
  epoch: number,
): PitStopEvent {
  const item = sequence[index];
  return {
    version: 1,
    event_id: `demo-${loop}-${index}`,
    source: "claude",
    session_key: "demo",
    tool_key: item.tool ? `${loop}-${item.tool}` : null,
    kind: item.kind as Kind,
    operation: item.operation as Operation,
    timestamp_ms: epoch + item.at,
    duration_ms: null,
    outcome: (item.outcome ?? "unknown") as Outcome,
  };
}
