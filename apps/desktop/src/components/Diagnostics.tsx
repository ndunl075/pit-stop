import { useEffect, useState } from "react";
import { command, native } from "../native";
interface DiagnosticsData {
  version?: string;
  listener_health?: string;
  helper_installed?: boolean;
  rejected?: number;
  summary?: {
    accepted?: number;
    duplicates?: number;
    stale?: number;
    active_tools?: number;
    sessions?: number;
    history?: number;
    last_event_ms?: number | null;
  };
  support?: Record<string, string>;
}
export function Diagnostics({ onDemo }: { onDemo: () => void }) {
  const [data, setData] = useState<DiagnosticsData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (native)
      command<DiagnosticsData>("get_diagnostics")
        .then(setData)
        .catch((e) => setError(String(e)));
  }, []);
  const age = data?.summary?.last_event_ms;
  return (
    <div className="panel-body">
      <p className="intro-copy">
        Under the hood.
        <br />
        <span>
          Only local health and event counts. No raw commands or transcripts.
        </span>
      </p>
      <dl className="diagnostics">
        <dt>App version</dt>
        <dd>{data?.version ?? "0.1.0"}</dd>
        <dt>Listener</dt>
        <dd>
          {native
            ? (data?.listener_health ?? "Checking…")
            : "Disconnected · browser preview"}
        </dd>
        <dt>Hook helper</dt>
        <dd>{data?.helper_installed ? "Installed" : "Not verified"}</dd>
        <dt>Last live event</dt>
        <dd>
          {age
            ? `${Math.max(0, Math.floor((Date.now() - age) / 1000))}s ago`
            : "None received"}
        </dd>
        <dt>Accepted / rejected</dt>
        <dd>
          {data?.summary?.accepted ?? 0} / {data?.rejected ?? 0}
        </dd>
        <dt>Duplicate events</dt>
        <dd>{data?.summary?.duplicates ?? 0}</dd>
        <dt>Active tools / sessions</dt>
        <dd>
          {data?.summary?.active_tools ?? 0} / {data?.summary?.sessions ?? 0}
        </dd>
        <dt>Historical logging</dt>
        <dd>Off · events held in memory</dd>
        <dt>Compatibility</dt>
        <dd>
          Claude & Cursor: tool hooks
          <br />
          Codex: turn completion only
        </dd>
      </dl>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <button className="primary" onClick={onDemo}>
        Test animation with offline demo
      </button>
      <p className="fine-print">
        A demo verifies the animation. It does not verify an agent's hook
        configuration.
      </p>
    </div>
  );
}
