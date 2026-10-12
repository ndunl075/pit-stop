# Architecture implementation checklist

Traceability for [ARCHITECTURE.md](../ARCHITECTURE.md), reviewed October 12, 2026.
**Implemented** means code exists; **verified** means the cited check has evidence.
Neither implies that every v1 release acceptance condition has passed. Observed
platform/build results are recorded in [VALIDATION.md](VALIDATION.md); this file
maps requirements to implementation and keeps the remaining work explicit.

Paths below are relative to the repository root. Grouped filenames in braces
identify concrete source/test files, not additional planned modules.

| Architecture | Implementation and check evidence | Remaining acceptance work |
| --- | --- | --- |
| §1 Principles | Local Rust receiver/helper; fixed redacted schema in `crates/pit-stop-core/src/{event,normalize,security}.rs`; original local graphics and synthesized audio; fail-open helper tests in `crates/pit-stop-hook/tests/cli.rs`. No model, account, API key, hosted runtime or telemetry dependency. | Verify installed app offline on a separate Windows 11 machine and monitor its runtime connections. |
| §2 Product scope | `apps/desktop/src/App.tsx`, `components/IntegrationsScreen.tsx`, `scene/{demo,PitLaneScene}.ts`: demo/live modes, sessions, overlay presets, settings and setup. Codex is labeled completion-only. No recorder/upload, cloud sync or other excluded features. | Real agent-driven experience and recording usability. |
| §3 Technology | Tauri v2/Rust, React/TypeScript/Vite, PixiJS, Axum/Tokio; small typed React state rather than an extra store dependency. `Cargo.lock`, `pnpm-lock.yaml`, package manifests, MIT/license notices. Production frontend/native builds recorded. | Platform measurements; audit changed dependencies before each distribution. |
| §4 Boundaries | `apps/desktop/src-tauri/src/{app,receiver}.rs` embeds an ephemeral authenticated loopback receiver and emits normalized events; `crates/pit-stop-hook/src/main.rs` is a separate executable; `apps/desktop/src/native.ts` bridges IPC. Runtime descriptor cleanup is tested/observed. | Repeat open/quit/reopen and simultaneous-instance behavior on clean installation. |
| §5 Layout | Workspace contains desktop, core, hook and integration crates; original assets, provider fixtures, packaging scripts and contribution/security docs. Closely related UI/scene code is combined where extra placeholder modules would add no behavior. | No requirement to create empty target-layout directories. |
| §6.1 Claude | Reversible installer in `crates/pit-stop-integrations/src/lib.rs`; documented executable/args form; session/tool/failure/stop/subagent mappings in core normalization; fixtures and CLI tests. | Real Claude session: start, finish, failure, stop; closed/malfunctioning desktop never changes tool permissions. |
| §6.2 Cursor | Generic hooks avoid duplicate shell/file instrumentation; explicit pre-tool allow output precedes input/transport handling; malformed/offline tests. Fast quoted Windows executable launcher, exact legacy migration and third-party preservation tests. | Real Cursor session, permission behavior, actual Windows provider shell invocation and remote-session explanation. |
| §6.3 Codex | `notify` argument vector invokes helper's notify mode; only `agent-turn-complete` accepted; third-party notify collision is refused; `CODEX_HOME` respected in native commands. | Real Codex turn completion and duplicate notification behavior. No tool-level support claim. |
| §6.4 Compatibility | `docs/integrations.md`, setup and diagnostics explicitly distinguish documented schemas/synthetic transport from verified provider compatibility. Installed versions in validation are observations, not coverage promises. | Record successful real-session version/platform matrix. |
| §7 Event model | Rust `event.rs` and frontend `contracts/events.ts` use fixed enums, opaque keyed identities, UUIDs and bounded timing; `normalize.rs` drops provider text. Conservative `classify.rs`, provider fixtures and sanitizer tests cover privacy, missing IDs, test/build recognition and unknown results. | Expand fixtures for new public provider versions; preserve conservative classification for ambiguous shell commands. |
| §8 Delivery/lifecycle | Auth, Origin/content-type/body/schema rejection and nonwaiting bounded queue in `receiver.rs`; helper short deadlines/input caps and private runtime descriptor; `sessions.rs` and frontend `state/eventStore.ts` handle deduplication, concurrent/out-of-order tools, unknown stale state, 200 event summaries and 8 sessions. | Backend sustained test recorded 6,000 requests in 64.48 seconds (~93/s), not proof of 100/s renderer performance. Repeat with FPS/memory measurements. |
| §9 Animation | Original car/crew SVGs plus authored pit-bay rendering; `AnimationCatalog.ts`, `TimelineScheduler.ts`, `PitLaneScene.ts`, `SceneLoop.ts`, `demo.ts`: arrivals, inspections, tire edits, pressure tests, wing builds, shell work, radio, delegation, warning and departure. Resource locks, bounded 24-entry queue, priorities, coalescing, minimum durations and active loops have unit tests. Hidden/paused rendering sleeps; reduced motion uses static transitions. | Deterministic visual snapshot regression suite is not present; browser visual inspection is recorded. Measure idle CPU/GPU, renderer FPS and long recordings. |
| §10 Windows/accessibility | Compact/expanded/capture sizes, native pin/resize/position reset, persisted placement with monitor clamping; keyboard controls, dialogs, system reduced motion, themes, opt-in sound and local system fonts. `App.tsx`, `styles/theme.css`, `scene/sound.ts`, native `app.rs`/`commands.rs`. Capture is presentation only. | 100/125/150% scaling, multi-monitor/taskbar bounds, keyboard/screen-reader and contrast review on real Windows displays. Reset shortcut is app-focused; transparent/click-through and global restoration are optional and not implemented. |
| §11 Setup/settings/uninstall | Per-user data directory, settings, stable helper, private runtime and backups; preview/explicit consent, stale check, atomic config replacement, idempotency and exact-entry disconnect. Native installation performs synthetic helper-to-receiver check and reports restart needs. Diagnostics show local health/status without raw payloads. README explains disconnect/manual cleanup; uninstall test recorded. | Real provider reload behavior, interrupted upgrade recovery and real-user uninstall after disconnect. Local logging is intentionally absent/off; no SQLite/history archive. |
| §12 Security/privacy | Core strict parsing/allowlists; Unix mode/Windows current-user ACL routines; localhost-only bearer auth, 8 KiB receiver bound and Origin rejection. Tauri CSP/capabilities in `src-tauri/{tauri.conf.json,capabilities/}` constrain frontend access. Config policy keys and third-party hooks preserved. No startup update checks or remote assets. | Rerun runtime ACL tests after the elevation/owner correction under development; separately validate ordinary-user and elevated launches. Installed-agent failure scenarios still need real-session evidence. |
| §13 Development/tests | Rust fixture/CLI/installer/receiver/session tests; Vitest reducer/scheduler/settings/scene-loop tests; TypeScript/Vite build; `.github/workflows/checks.yml` runs Windows tests/build. Commands in README and contribution guide. Backend load and generated Windows command tests are opt-in and reproducible. | Separate-machine clean install, visual regression suite, real providers, display scaling, renderer benchmarks and cross-platform checks remain open. |
| §14 Milestones | See milestone checklist below. Functional code exists across all six milestones; release gate remains partial. | Do not equate merged features with completed manual acceptance. |
| §15 Licensing/contributions | `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `assets/LICENSES.md`, `assets/THIRD_PARTY_NOTICES.txt`; `scripts/{check-licenses,generate-notices}.mjs` generate dependency evidence/notices. Original fictional graphics, icons and synthesized sounds. | Review regenerated reports/notices whenever dependencies/assets change; a report alone is not a legal compatibility conclusion. |
| §16 References | Public Claude/Cursor/Codex hook documentation and command schemas are linked in `docs/integrations.md`; real support limits remain visible in UI/README. | Recheck official docs when adding/upgrading adapters; do not infer compatibility from installed version detection alone. |

## Milestone checks

- [x] **0 — Visual demo:** original scene, crew and props; deterministic scripted
  inspect/edit/test/build/failure/release; three layouts; browser inspection.
- [x] **1 — Event engine:** fixed schema, redaction/classifier, bounded reducer,
  authenticated receiver, fail-open helper and automated tests.
- [x] **2 — Claude implementation:** reversible user hooks, mappings, Windows
  executable arguments, fixtures and offline behavior tests.
- [ ] **2 — Claude live acceptance:** real session and noninterference checks.
- [x] **3 — Cursor implementation:** generic hooks, unconditional pre-tool allow,
  path/launcher test, malformed/offline behavior and reversible merging.
- [ ] **3 — Cursor live acceptance:** actual provider launch and permissions.
- [x] **4 — Codex/polish implementation:** completion-only notify, sound, themes,
  reduced motion, diagnostics, session selection and app-focused hotkeys.
- [ ] **4 — Codex live acceptance:** real completion event; no invented operations.
- [x] **5 — Distribution implementation:** MIT/source/asset notices, screenshot,
  reproducible local build instructions, helper packaging and NSIS configuration.
  Optimized executable, per-user installer and test uninstall evidence is recorded.
- [ ] **5 — Release acceptance:** clean independent Windows 11 installation,
  ordinary/elevated runtime ACL recheck, real providers, scaling, recordings and
  renderer performance. macOS/Linux are not validated release targets. Publishing
  a GitHub Release is optional; no paid signing/service is required.

## v1 definition-of-done gate (§13)

| Requirement | Current evidence / gate |
| --- | --- |
| Fresh Windows install displays offline demo | Installer/demo implemented and tested on development host; **separate clean machine pending**. |
| Claude/Cursor drive live animations | Fixtures and synthetic authenticated transport verified; **both real sessions pending**. |
| Permitted actions remain permitted open/closed/malfunctioning | Helper failure/allow tests verified; **real provider permission checks pending**. |
| Conservative command labels and honest outcomes | Classifier/schema/reducer tests and UI labels implemented/verified at unit level. |
| Codex completion-only | Schema enforcement, notify fixture and visible limitation implemented/verified; real notification pending. |
| Demo/capture ready for recording | Layout/artwork browser inspection and scene-loop tests; **long recording and FPS acceptance pending**. |
| Disconnect preserves existing configuration | Installer idempotency, backups, stale/malformed input and third-party preservation tests verified; manual upgrade/uninstall scenario pending. |
| No remote connections/API tokens/paid runtime | Local design, local assets/CSP and packaging verified by source/build review; **installed offline/network observation on clean machine pending**. |

These open gates require observation, not additional unsupported feature claims.
Update this checklist and `VALIDATION.md` together when new evidence is obtained.
