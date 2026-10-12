# Release validation — Windows x64, 0.1.0

This file records observed checks, not compatibility promises.

| Area | Evidence |
| --- | --- |
| Native workspace | Core sanitization/classification, runtime ACL, helper fail-open, installer preservation, receiver auth/body bounds and session lifecycle tests |
| Frontend | 19 Vitest scheduler/reducer/demo/scene-loop tests; TypeScript and Vite production build |
| Scene | Browser inspection of original artwork, compact layout, settings and reduced motion |
| Native distribution | Optimized Windows executable and NSIS installer built using locked dependencies; per-user test installation contains helper and license resources; installed app returned HTTP 202; uninstaller removed test application |
| Receiver load | 6,000 authenticated requests in 64.48 seconds (about 93/s on this Windows host); bounded 200 history and 8 sessions; no retained active tools or rejected requests |
| Helper latency | Release Cursor launcher tested with Unicode, spaces and apostrophe path; observed p95 90 ms in 10 launches |
| Shutdown | Native process opens/responds; normal window close removes private runtime descriptor |
| Agent compatibility | Synthetic fixtures/transport only; real Claude Code, Cursor and Codex sessions remain unverified |

Installed provider versions observed without starting model sessions:
Claude Code 2.1.287, Cursor 3.14.27, Codex CLI 0.159.3.
These version checks do not verify event delivery.

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
