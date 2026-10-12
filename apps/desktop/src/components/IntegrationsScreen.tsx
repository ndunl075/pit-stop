import { useState } from "react";
import type { Source } from "../contracts/events";
import { command, native, type IntegrationPreview } from "../native";
import { Icon } from "./Icon";
const integrations: [Source, string, string][] = [
  ["claude", "Claude Code", "Tool activity · sessions · turns"],
  ["cursor", "Cursor", "Tool activity · sessions · turns"],
  ["codex", "Codex CLI", "Turn completion only"],
];
export function IntegrationsScreen() {
  const [preview, setPreview] = useState<IntegrationPreview | null>(null),
    [disconnect, setDisconnect] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false),
    [approved, setApproved] = useState(false);
  async function prepare(source: Source, remove = false) {
    setBusy(true);
    setPreview(null);
    setMessage("");
    setApproved(false);
    setDisconnect(remove);
    try {
      setPreview(
        await command<IntegrationPreview>("preview_integration", {
          source,
          disconnect: remove,
        }),
      );
    } catch (e) {
      setError(true);
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview || !approved) return;
    setBusy(true);
    try {
      const result = await command<{ transportTest?: string }>(
        disconnect ? "uninstall_integration" : "install_integration",
        { source: preview.source, expectedContent: preview.before },
      );
      setMessage(
        disconnect
          ? "Pit Stop hooks removed. Other settings are preserved. Restart your agent to reload its hooks."
          : "Hooks installed. Restart your agent to reload its hooks, then run a tool to verify live activity.",
      );
      if (!disconnect && result.transportTest)
        setMessage(
          (current) =>
            current +
            " Local transport check: " +
            result.transportTest +
            ". This does not verify live agent compatibility.",
        );
      setError(false);
      setPreview(null);
    } catch (e) {
      setError(true);
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel-body">
      <p className="intro-copy">
        Give your coding agent a pit crew.
        <br />
        <span>
          Local hooks send activity labels. Your code and conversations stay out
          of the scene.
        </span>
      </p>
      {!native && (
        <div className="notice">
          Browser preview · Open the desktop app to connect local agents. The
          demo works here offline.
        </div>
      )}
      <div className="integration-list">
        {integrations.map(([source, name, detail], i) => (
          <article className="integration" key={source}>
            <div className={"agent-logo agent-" + source}>
              {["✳", "↗", "›_"][i]}
            </div>
            <div className="integration-name">
              <h3>{name}</h3>
              <p>{detail}</p>
              <small>Live compatibility requires local verification</small>
            </div>
            <div className="integration-actions">
              <button
                disabled={!native || busy}
                onClick={() => prepare(source)}
              >
                Connect <Icon name="arrow" size={14} />
              </button>
              <button
                className="text-button"
                disabled={!native || busy}
                onClick={() => prepare(source, true)}
              >
                Disconnect
              </button>
            </div>
          </article>
        ))}
      </div>
      {preview && (
        <section className="preview">
          <h3>
            {disconnect
              ? "Remove Pit Stop hooks"
              : "Review configuration changes"}
          </h3>
          <p className="config-path">{preview.path}</p>
          {preview.warning && <div className="notice">{preview.warning}</div>}
          <p>
            Existing configuration is backed up before changes. Only Pit Stop
            entries are managed.
          </p>
          <details>
            <summary>Current configuration</summary>
            <pre>{preview.before ?? "(new file)"}</pre>
          </details>
          <details open>
            <summary>Proposed configuration</summary>
            <pre>{preview.after}</pre>
          </details>
          <label className="check-row">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I approve these changes to my local agent configuration.
          </label>
          <button
            className="primary"
            disabled={!approved || busy || !preview.changed}
            onClick={apply}
          >
            {busy
              ? "Applying…"
              : disconnect
                ? "Approve & disconnect"
                : "Approve & install hooks"}
          </button>
          {!preview.changed && <p>No changes needed.</p>}
        </section>
      )}
      {message && (
        <div
          role={error ? "alert" : "status"}
          className={error ? "notice error" : "notice"}
        >
          {message}
        </div>
      )}
      <div className="privacy-note">
        <Icon name="check" size={16} /> No account. No cloud. No tokens
        consumed.
      </div>
    </div>
  );
}
