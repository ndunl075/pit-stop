# Security and privacy

Pit Stop is an observational desktop app. It never executes agent commands,
reads transcripts, or includes its own telemetry or remote service client.
Raw provider input stays inside the short-lived helper and is discarded after
classification. Prompts, paths, code, command output and error text are not part
of the event contract. History is bounded and memory-only.

The desktop page permits only packaged local navigation (and the local Vite
server in debug builds); CSP restricts subresources and IPC capabilities.
These page controls do not govern Windows WebView2's OS-managed diagnostics.
On the development host, its browser process opened background HTTPS
connections even with a fresh profile and a closed loopback proxy. The
strict architecture requirement of no remote runtime connections therefore
remains unmet for WebView2. No system firewall, Windows diagnostic policy,
security feature or shared browser setting is changed by Pit Stop.
Microsoft documents required and optional diagnostic collection in
[Data and privacy in WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy).
Use an independently managed network boundary if strict offline isolation
is required; a CSP alone does not establish that boundary.

The HTTP receiver binds to 127.0.0.1 on an ephemeral port, requires a rotating
256-bit bearer token, rejects browser Origin headers and caps JSON bodies at
8 KiB. Runtime credentials are restricted to the current OS user. This does
not protect against malware already running as that user.

Hooks always exit successfully. Cursor preToolUse emits an allow response even
for malformed input or an unavailable desktop. An app failure must not change
the agent's permission decisions. Do not add transcript scraping or raw
payload logging when diagnosing an integration.

Integration setup previews the change and requires explicit confirmation in
the UI. It backs up existing config, checks for concurrent edits and preserves
third-party hooks. Existing Codex notify commands are never silently replaced.

For a suspected vulnerability, contact the maintainer privately through the
repository owner's GitHub profile before publishing sensitive details. Public
bug reports should use synthetic fixtures and sanitized diagnostic counts.
