# Release validation — Windows x64, 0.1.0

This file records observed checks, not compatibility promises.

| Area | Evidence |
| --- | --- |
| Native workspace | 45 regular tests pass: sanitization/classification, runtime ACL and lock contention, helper fail-open, installer preservation/migration, navigation, receiver auth/body bounds and sessions |
| Frontend | 21 Vitest scheduler/reducer/demo/scene-loop/lifecycle tests; TypeScript and Vite production build |
| Scene | Browser inspection of original artwork, compact layout, settings and reduced motion |
| Visual regression | Five Playwright tests pass against 16 reviewed Windows baselines: eleven operation stages, compact/capture layouts, reduced motion and normal-clock pause/resume. Browser rendering only; no native FPS claim. |
| Native distribution | Optimized Windows executable and NSIS installer built using locked dependencies; per-user test installation contains helper and license resources; installed app returned HTTP 202; uninstaller removed test application |
| Receiver load | 6,000 authenticated requests in 60.01 seconds (100/s); bounded 200 history and 8 sessions; no retained active tools or rejected requests |
| Helper latency | Release Cursor launcher tested with Unicode, spaces and apostrophe path; observed p95 68 ms in 10 launches |
| Shutdown/relaunch | Installed process opens/responds; normal close removes private runtime descriptor. Relaunch preserves active credentials; three simultaneous launches leave exactly one responding instance. |
| Agent compatibility | Real Claude Code 2.1.287 generated-config session delivered session/read/edit/shell-failure/completion/end events with HTTP 202; malformed-runtime read still succeeded. Real Codex CLI 0.159.3 completion invoked the release helper once and was accepted with HTTP 202. Cursor live acceptance pending. |
| Hosted Windows | CI run 38254469355 passed all 21 frontend tests, five visual tests, 45 regular native tests, optimized helper and native release build, including elevated runtime ownership regression. |
| Runtime network | App-owned WebView2 browser process opened two remote HTTPS connections to Microsoft IP addresses. Fresh-profile/closed-proxy test did not eliminate them. Accepted v1 exception: retain Tauri with this disclosed limitation; original strict zero-remote requirement remains unsatisfied. |
| Recording | Actual 23-second full-motion demo capture encoded as the README GIF; this is not an FPS benchmark. |

Installed provider versions observed without starting model sessions:
Claude Code 2.1.287, Cursor 3.14.27, Codex CLI 0.159.3.
Version checks alone do not verify event delivery. Codex was separately tested
with a real ephemeral completion, an invocation-only notify override and the
unchanged release helper. A temporary authenticated loopback forwarding probe
recorded only fixed event enums and the app's HTTP 202 response. User provider
configuration remained unchanged; temporary runtime credentials were removed.

Claude's initial executable-plus-args hook format did not execute callbacks
on the installed version. The installer now emits the command-string format
verified in a subsequent real session, explicitly selecting Bash on Windows.
That final configuration came from the installer preview, including a helper
path with Unicode, spaces and an apostrophe. Genuine read/edit success and an
intentional shell failure were distinguished correctly. A separate malformed
runtime descriptor test confirmed Claude still completed its permitted read.
Five small Claude diagnostic/validation sessions reported approximately
$0.117 of model usage; this belongs to the user's separate agent account.

The official Cursor Windows CLI 2026.10.01-e373342 was downloaded and extracted
into an isolated validation directory without running its global installer or
changing PATH. Its status command reports unauthenticated; the editor's existing
login is not shared with that CLI. No Cursor model session was started. Real
Cursor validation requires the user's interactive login to the existing account;
fixture/launcher evidence must not be promoted to live verification.

The final Windows installer is 2,555,297 bytes. Its SHA-256 is
`B741F7775FCD7DA63C9F285D1C2099CCAE84A04CC5F0236FFE9960962906C971`.
Installed authentication checks returned 202 for valid events, 401 for invalid
credentials and 403 for browser Origin requests. Test uninstall removed the app.

Remaining manual platform checks: clean Windows 11 installation on a separate
machine, real agent sessions, multi-monitor and 100/125/150% scaling,
long screen recordings and measured renderer FPS/CPU/GPU. The load test
measures backend processing and bounded state, not renderer frame rate.
macOS and Linux release validation has not been performed.

Repeat the sustained test explicitly (it is omitted from fast unit runs):

```powershell
cargo test -p pit-stop-desktop sustained_100_events -- --ignored --nocapture
$env:PIT_STOP_TEST_HELPER = (Resolve-Path target/release/pit-stop-hook.exe)
cargo test -p pit-stop-integrations generated_cursor_launcher -- --ignored --nocapture
```

The architecture's real-agent and fresh-machine definition-of-done items
must remain open until these manual checks have evidence. Diagnostics never
label an adapter Verified based on a synthetic event.
