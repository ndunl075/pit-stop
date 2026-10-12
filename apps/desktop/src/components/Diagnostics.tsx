import { Fragment, useEffect, useState } from "react";
import { command, native } from "../native";
interface IntegrationDiagnostic {
  source: string;
  configPath?: string;
  configured?: boolean;
  support?: string;
  compatibility?: string;
  remoteSupported?: boolean;
}
interface DiagnosticsData {
  version?: string;
  listener_health?: string;
  helper_installed?: boolean;
  helper_path?: string;
  rejected?: number;
  rejections?: Record<string, number>;
  integrations?: (IntegrationDiagnostic | null)[];
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
const adapters = [
  {
    source: "claude",
    name: "Claude Code",
    support: "Tool-level events · local sessions",
  },
  {
    source: "cursor",
    name: "Cursor",
    support: "Tool-level events · local sessions",
  },
  { source: "codex", name: "Codex CLI", support: "Turn completion only" },
];
const rejectionClasses = [
  ["400", "Malformed event"],
  ["401", "Authentication rejected"],
  ["403", "Browser origin rejected"],
  ["408", "Request timeout"],
  ["413", "Payload too large"],
  ["415", "Unsupported content type"],
  ["429", "Rate or concurrency limit"],
  ["503", "Receiver backpressure"],
];
export function Diagnostics({ onDemo }: { onDemo: () => void }) {
  const [data, setData] = useState<DiagnosticsData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    if (native)
      command<DiagnosticsData>("get_diagnostics")
        .then((result) => {
          if (mounted) setData(result);
        })
        .catch((e) => {
          if (mounted) setError(String(e));
        });
    return () => {
      mounted = false;
    };
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
        <dt>Helper location</dt>
        <dd style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {data?.helper_path ? (
            <code>{data.helper_path}</code>
          ) : native ? (
            "Location unavailable"
          ) : (
            "Unavailable in browser preview"
          )}
        </dd>
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
      </dl>
      <details>
        <summary>Rejected event classes</summary>
        <p className="fine-print">
          Sanitized HTTP status counters for this app launch. No request bodies,
          tokens, or agent content are retained.
        </p>
        <dl className="diagnostics">
          {rejectionClasses.map(([status, label]) => (
            <Fragment key={status}>
              <dt>
                {status} · {label}
              </dt>
              <dd>
                {native && data
                  ? (data.rejections?.[status] ?? 0)
                  : "Unavailable"}
              </dd>
            </Fragment>
          ))}
        </dl>
      </details>
      <section aria-label="Agent integration diagnostics">
        <h3 style={{ fontSize: 14, marginTop: 24 }}>Agent integrations</h3>
        <p className="fine-print">
          Real-provider compatibility: <strong>UNVERIFIED</strong> for every
          adapter. Installed hooks and a successful local transport test do not
          verify live provider behavior.
        </p>
        {adapters.map((adapter) => {
          const integration = data?.integrations?.find(
            (item) => item?.source === adapter.source,
          );
          return (
            <details key={adapter.source}>
              <summary>
                {adapter.name} ·{" "}
                {integration?.configured === true
                  ? "Configured"
                  : integration?.configured === false
                    ? "Not configured"
                    : "Status unavailable"}{" "}
                · UNVERIFIED
              </summary>
              <dl className="diagnostics">
                <dt>Source</dt>
                <dd>{integration?.source ?? adapter.source}</dd>
                <dt>Configuration file</dt>
                <dd style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {integration?.configPath ? (
                    <code>{integration.configPath}</code>
                  ) : native ? (
                    "Configuration could not be inspected"
                  ) : (
                    "Unavailable in browser preview"
                  )}
                </dd>
                <dt>Pit Stop hooks</dt>
                <dd>
                  {integration?.configured === true
                    ? "Configured"
                    : integration?.configured === false
                      ? "Not configured"
                      : "Unknown"}
                </dd>
                <dt>Supported events</dt>
                <dd>
                  {integration?.support ??
                    data?.support?.[adapter.source] ??
                    adapter.support}
                </dd>
                <dt>Compatibility</dt>
                <dd>
                  {integration?.compatibility ??
                    "Installed provider version and real-session behavior unverified"}
                </dd>
                <dt>Remote sessions</dt>
                <dd>
                  {integration?.remoteSupported === true
                    ? "Supported by adapter · live compatibility unverified"
                    : integration?.remoteSupported === false
                      ? "Unsupported · local sessions only"
                      : "Not verified · local sessions only"}
                </dd>
              </dl>
            </details>
          );
        })}
      </section>
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
