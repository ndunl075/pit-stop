# Release validation — Windows x64, 0.1.0

This file records observed checks, not compatibility promises.

| Area | Evidence |
| --- | --- |
| Native workspace | Core sanitization/classification, runtime ACL, helper fail-open, installer preservation, receiver auth/body bounds and session lifecycle tests |
| Frontend | Vitest scheduler/reducer/demo tests; TypeScript and Vite production build |
| Scene | Browser inspection of original artwork, compact layout, settings and reduced motion |
| Native distribution | Optimized Windows executable and NSIS installer built using locked dependencies |
| Receiver load | Explicit 6,000 authenticated requests; bounded 200 history and 8 sessions; no retained active tools |
| Helper latency | Release Cursor launcher tested with Unicode, spaces and apostrophe path; observed p95 90 ms in 10 launches |
| Shutdown | Native process opens/responds; normal window close removes private runtime descriptor |
| Agent compatibility | Synthetic fixtures/transport only; real Claude Code, Cursor and Codex sessions remain unverified |

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
