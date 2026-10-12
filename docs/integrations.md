# Local agent integrations

Pit Stop installs user-level hooks only after displaying a preview and receiving
the user's Connect/Disconnect action. Config files are not changed by opening the
screen or diagnosing an integration. No provider transcript is read.

| Agent | Config | Event coverage |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | Session, generic tool, stop and subagent hooks |
| Cursor | `~/.cursor/hooks.json` | Local session, generic tool, stop and subagent hooks |
| Codex CLI | `${CODEX_HOME}/config.toml` (default `~/.codex/config.toml`) | Turn completion only |

These are documented schemas, **not a claim of verified compatibility with every
installed provider version**. Restart the agent after configuration changes and
use the app's test event to check local delivery. Remote/cloud agent sessions
cannot reach this desktop's loopback receiver and are unsupported.

Claude uses the documented `command` + `args` exec form: the absolute helper path
is a literal executable path, including Unicode and spaces; no shell interprets
it. Cursor's documented API accepts a command string. Windows hooks explicitly
quote the absolute `.exe` path directly, avoiding a second PowerShell startup
for every event. Paths with characters whose interpretation differs across Windows
shell layers are refused with an actionable message. Unicode, spaces and
apostrophes are supported. The generated full command is tested through Windows
`cmd.exe /d /s /c` with a real helper executable; installed Cursor shell selection
still requires real-session verification. POSIX uses shell quoting. Upgrades
replace only exact legacy Pit Stop PowerShell launchers in place, retaining
third-party hook order; disconnect recognizes both generated launcher versions.
The helper never emits Claude decisions and always emits Cursor's valid allow
response for `preToolUse`. Pit Stop does not set `failClosed`, `onFailure: block`,
or provider security policy keys.

Codex supports one notify command. The installer refuses to overwrite an existing
different notifier and explains manual resolution. It never chains arbitrary
commands. Codex notify receives a JSON argument; it is classified and redacted by
the helper, never forwarded wholesale.

## Transaction behavior

`preview(source, config_path, helper_path, disconnect)` returns the existing and
proposed contents without writing. JSON changes preserve unrelated values and
hook array order; whitespace is pretty-printed only when a change is necessary.
TOML editing preserves comments and unrelated formatting. Repeating a successful
connection or disconnection changes no bytes.

`apply(preview, expected_content, backup_dir)` requires the original contents
(including absence), checks for stale edits, takes an exclusive installer lock,
stages and syncs the replacement beside the original, saves a timestamped backup
of the exact original bytes, rechecks the original, then atomically replaces it.
Windows replacement uses `MoveFileExW` with replacement and write-through flags.
No delete-before-rename fallback is used. Malformed input, unsupported Cursor
schema versions, links, oversized configs and stale previews are refused.
Backups belong in the app's per-user data directory, never in a shared directory.

The backend must retain the actual preview until consent; it must not deserialize
arbitrary frontend content into a trusted preview. Config text may contain
third-party secrets: show previews only locally, never log or transmit them, and
hide setup screens in capture mode. The library does not provide Deserialize for
Preview. The returned backup path supports manual recovery. Before restoring an
entire backup, review any newer third-party edits so they are not overwritten.

Disconnect removes exact generated entries for the installed helper path, keeping
third-party hooks and policy settings. If a third-party handler was added to a
generated Claude matcher group, that handler is preserved. User-modified Pit Stop
entries are intentionally retained, since guessing ownership can delete someone
else's hook. Preserve the old helper path in integration metadata when upgrading:
disconnect the old path before connecting the new path, reviewing both previews.
For manual cleanup, remove only the command/args entries that point to your
installed `pit-stop-hook` executable. Codex cleanup removes only its exact notify
array. Never delete the entire hooks object or agent config file.

A stale `.pit-stop.lock` after an interrupted installer can be removed manually
after ensuring no Pit Stop installer is running. The original config remains
valid when replacement fails; any successfully saved backup is retained.

## Official references checked

- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks): command
  exec form, hook event names, user-level settings and nonblocking failure defaults.
- [Cursor hooks](https://cursor.com/docs/hooks): version 1 configuration, generic
  hooks, timeouts, permission output and failClosed behavior.
- [Official OpenAI documentation: Codex advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced):
  notify argument array and `agent-turn-complete` limitation.

The implementation was checked against these public references on October 12,
2026. Real-provider session verification and installed-version detection must be
reported separately from schema-level tests.

## Windows launcher verification

The opt-in test `generated_cursor_launcher_executes_real_helper_with_unicode_spaces_and_apostrophe`
copies a built helper to a temporary `Équipe O'Brien tools` directory, launches
the exact generated command through `cmd.exe /d /s /c`, sends malformed stdin,
and asserts valid allow JSON, empty stderr and exit code zero for ten invocations.
Set `PIT_STOP_TEST_HELPER` to the built helper and run `cargo test -p
pit-stop-integrations -- --ignored --nocapture` to repeat it.

On the development Windows host, ten optimized-release helper invocations took
30–90 ms (sample p95 90 ms), including shell startup and process exit. The previous
PowerShell wrapper took 713–1,204 ms just to start PowerShell and exit, exceeding
the configured one-second timeout in several samples. These are local samples,
not guarantees across computers or a real Cursor session validation.
