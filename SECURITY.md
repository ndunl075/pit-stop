# Security and privacy

Pit Stop is an observational desktop app. It never executes agent commands,
reads transcripts, sends telemetry, or connects to remote services at runtime.
Raw provider input stays inside the short-lived helper and is discarded after
classification. Prompts, paths, code, command output and error text are not part
of the event contract. History is bounded and memory-only.

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
