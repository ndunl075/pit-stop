import { sessionId, type PitStopEvent } from "../contracts/events";
export interface Tool {
  key: string;
  event: PitStopEvent;
  startedAt: number | null;
  receivedAt: number;
  state: "running" | "finished" | "unknown";
}
export interface Session {
  id: string;
  source: PitStopEvent["source"];
  number: number;
  startedAt: number;
  lastAt: number;
  last: PitStopEvent;
  tools: Map<string, Tool>;
  ended: boolean;
  finished: boolean;
}
export interface EventState {
  sessions: Map<string, Session>;
  events: PitStopEvent[];
  seen: Set<string>;
  nextNumber: number;
  total: number;
}
export const emptyState = (): EventState => ({
  sessions: new Map(),
  events: [],
  seen: new Set(),
  nextNumber: 1,
  total: 0,
});
/** All collections have hard ceilings, including active and terminal tool tombstones. */
export function reduceEvent(
  state: EventState,
  e: PitStopEvent,
  now: number,
): EventState {
  if (state.seen.has(e.event_id)) return state;
  const id = sessionId(e),
    prior = state.sessions.get(id),
    key = e.tool_key ?? e.event_id;
  const tool = prior?.tools.get(key);
  if (
    (e.kind === "tool.finish" && tool?.state === "finished") ||
    (e.kind === "tool.start" && tool && tool.state !== "unknown") ||
    (prior?.ended && e.kind !== "session.start")
  )
    return state;
  const sessions = new Map(state.sessions),
    tools = new Map(prior?.tools);
  const session: Session = prior
    ? { ...prior, tools, last: e, lastAt: now }
    : {
        id,
        source: e.source,
        number: state.nextNumber,
        startedAt: now,
        lastAt: now,
        last: e,
        tools,
        ended: false,
        finished: false,
      };
  if (e.kind === "session.start") {
    session.ended = false;
    session.finished = false;
  }
  if (e.kind === "tool.start") {
    session.finished = false;
    tools.set(key, {
      key,
      event: e,
      startedAt: now,
      receivedAt: now,
      state: "running",
    });
  }
  if (e.kind === "tool.finish")
    tools.set(key, {
      key,
      event: e,
      startedAt: tool?.startedAt ?? null,
      receivedAt: now,
      state: "finished",
    });
  if (e.kind === "turn.complete" || e.kind === "session.end") {
    session.finished = true;
    session.ended = e.kind === "session.end";
    for (const [k, t] of tools)
      if (t.state === "running")
        tools.set(k, {
          ...t,
          state: "unknown",
          event: { ...t.event, outcome: "unknown" },
        });
  }
  while (tools.size > 200) tools.delete(tools.keys().next().value!);
  sessions.delete(id);
  sessions.set(id, session);
  while (sessions.size > 8) sessions.delete(sessions.keys().next().value!);
  const events = [...state.events, e].slice(-200),
    seen = new Set(events.map((x) => x.event_id));
  return {
    sessions,
    events,
    seen,
    nextNumber: state.nextNumber + (prior ? 0 : 1),
    total: state.total + 1,
  };
}
export function expireTools(state: EventState, now: number): EventState {
  let changed = false;
  const sessions = new Map(state.sessions);
  for (const [id, s] of sessions) {
    const tools = new Map(s.tools);
    let dirty = false;
    for (const [k, t] of tools)
      if (t.state === "running" && now - t.receivedAt > 120_000) {
        tools.set(k, { ...t, state: "unknown" });
        dirty = true;
      }
    if (dirty) {
      sessions.set(id, { ...s, tools });
      changed = true;
    }
  }
  return changed ? { ...state, sessions } : state;
}
export function sessionStatus(
  s: Session | undefined,
): "Disconnected" | "Waiting" | "Working" | "Finishing" | "Unknown" {
  if (!s) return "Disconnected";
  if (s.ended) return "Waiting";
  if (s.finished) return "Finishing";
  if ([...s.tools.values()].some((t) => t.state === "running"))
    return "Working";
  if ([...s.tools.values()].some((t) => t.state === "unknown"))
    return "Unknown";
  return "Waiting";
}
