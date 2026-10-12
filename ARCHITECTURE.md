# Pit Stop — Architecture

**Status:** implementation specification (v1)  
**Repository:** https://github.com/ndunl075/pit-stop  
**Default branch:** main  
**License target:** MIT, subject to verifying licenses for bundled artwork, fonts, audio, and dependencies  
**Operating cost target:** $0, with no API keys, subscriptions, external hosting, paid assets, or required paid distribution services

> Pit Stop is a small, open-source desktop spectator app that turns coding-agent activity into an animated motorsport pit stop. Tool calls, edits, test runs, builds, failures, and completed turns trigger different crew operations. The visualization reflects observable agent events; it never runs an AI model itself.

This document is the implementation contract. Favor shipping a polished, responsive animation over inventing analytics, dashboards, a hosted backend, or complex agent integrations that cannot reliably provide live events.

---

## 1. Non-negotiable principles

1. **Completely local at runtime.** No application server, cloud database, login, telemetry service, hosted LLM, billing account, or paid API. Data travels only between processes on the same computer. Internet access is not needed after installation.
2. **Never interfere with the coding agent.** Instrumentation is observational. A broken/stopped Pit Stop app must not deny a tool call, modify tool arguments, delay the agent meaningfully, or turn a successful task into a failure.
3. **No content collection.** By default, do not store or forward prompts, code, file contents, full paths, shell output, error text, API keys, model messages, or transcripts.
4. **Accurate status.** An agent tool returning successfully does not necessarily mean tests passed, a build succeeded, or the work was correct. Present only evidence actually exposed by the integration.
5. **Works for screen recordings.** The pit crew must be identifiable and animated within seconds of running the demo, with a small always-on-top window and an optional larger clean 16:9 scene.
6. **Use established hooks, not log scraping.** Do not monkeypatch agents, poll their private data, scrape terminals, or rely on unstable transcript formats.
7. **Original motorsport artwork.** Formula 1 is inspiration, not a licensed affiliation. Do not ship official F1 logos, team liveries, car designs copied from current teams, driver likenesses, trademarks used as branding, broadcast graphics, or copyrighted racing audio.

Pit Stop itself costs nothing to run; a user's separate coding-agent subscription or API usage, if any, is outside Pit Stop and not bundled with it.

## 2. User experience and product scope

### Main experience

- Install Pit Stop, open it, click **Connect Claude Code** or **Connect Cursor**, and allow the installer to add narrowly scoped hooks to the user's existing configuration.
- Start working in the chosen coding agent. A car enters the pit box on session start; animated crew members react to tool activity.
- A small overlay sits at the edge of the screen. It can be dragged, resized, pinned above other windows, muted, or expanded for recording.
- An unobtrusive status indicator shows **Waiting**, **Working**, **Finishing**, or **Disconnected**. A compact event label shows actions such as **Inspecting**, **Editing**, **Running tests**, **Building**, or **Tool failed**.
- When the agent turn finishes, the car leaves the pit box. This means **turn finished**, not **tests passed** or **code shipped**.
- **Demo mode** runs a deterministic local scripted sequence without any coding agent; this is useful for onboarding, screenshots, development, and short social videos.

### v1 features

- Windows 11 desktop build first; macOS next; Linux best-effort after platform validation.
- Tauri desktop window, PixiJS 2D animated scene, React controls.
- Claude Code and Cursor hooks for tool-level activity.
- Codex CLI notification support for **turn completion only**. Do not advertise live tool-by-tool Codex coverage until a documented, tested source of those events exists.
- Local-only communication, animation scheduler, session selector, accessible motion settings, configurable colorways, and an integration setup/diagnostics screen.
- Original vector/sprite graphics and a silent-by-default sound pack made in-house or with compatible free licenses.
- No built-in screen recorder; use the operating system's recorder or OBS. **Capture mode** only adjusts the scene layout.

### Explicitly out of scope for v1

Cloud sync, accounts, team analytics, leaderboards, shared sessions, marketplace, mobile companion, built-in coding agent, LLM-based event classification, transcript ingestion, code inspection, real-world lap timing, third-party data feeds, paid themes, remote sockets, and automatic upload of clips.

---

## 3. Technology decisions

| Layer | Decision | Why |
| --- | --- | --- |
| Desktop shell | **Tauri v2** | Free, open source, small cross-platform shell with a Rust backend |
| UI | **React + TypeScript + Vite** | Straightforward settings, onboarding, panels, and component testing |
| Animated pit lane | **PixiJS** | Smooth WebGL/WebGPU/canvas-compatible 2D rendering with authored sprites; no 3D engine needed |
| UI state | **Zustand** or a small typed React store | Separate event state from the Pixi render loop |
| Native processing | **Rust** | Shared safe event models, loopback receiver, CLI helper, config installer |
| Local receiver | **Tokio + Axum**, embedded in the Tauri process | Short-lived, authenticated loopback POSTs from hooks |
| Hook executable | **pit-stop-hook**, a lightweight Rust executable | No Node/Python requirement for end users; usable by CLI-based agents |
| Configuration | User-local **settings.json** | Human-inspectable; no remote DB |
| History | **In-memory ring buffer** in v1 | No sensitive event archive or unnecessary persistence |
| Tests | Rust tests + Vitest + Playwright where practical | Unit, integration, and visual regression coverage |
| Package manager | **pnpm** for frontend, **Cargo** for Rust | Free, deterministic lockfiles |
| Distribution | Locally built installers and optional public GitHub Releases | No hosted runtime; no mandatory paid signing service |

Pin exact dependency versions in lockfiles. Audit dependency licenses before distributing binaries. Prefer permissive MIT/Apache-2.0/BSD dependencies.

**Why not Electron?** Electron is viable but introduces a bundled Node/Chromium runtime that is unnecessary for this small visualization. Do not change stacks merely to optimize theoretical performance; Tauri and PixiJS should be benchmarked on the Windows MVP.

---

## 4. System diagram

~~~text
Claude Code hooks       Cursor hooks           Codex notify
     |                       |                      |
     +-----------------------+----------------------+
                             |
                 pit-stop-hook (Rust CLI)
            parse input, classify, REDACT
            ALWAYS return safe hook output
                             |
         localhost HTTP POST, short deadline
           127.0.0.1:<ephemeral-port>
           private rotating bearer token
                             |
                 Tauri Rust backend
        auth -> schema check -> normalize ->
        deduplicate -> match tool/session IDs
                             |
                  in-memory event bus
                   /             \
           Tauri UI emit      bounded counters
                 |
             React store
                 |
          animation scheduler
                 |
          PixiJS pit-stop scene
                 |
     Always-on-top / expanded demo window
~~~

There is **no remote event receiver**. The local loopback port must never bind to a public interface. No CDN or externally hosted image/font assets are loaded at runtime.

### Process boundaries

**Desktop process**
- Owns the Tauri window, receiver, authenticated runtime file, memory-only session state, and event emissions to the frontend.
- Starts listening on an OS-selected free port on 127.0.0.1 and generates a fresh 256-bit cryptographically random bearer token each launch.
- Stops accepting events and deletes the runtime file on clean exit; stale files are harmless because the old port/token no longer identify a valid listener.

**Hook executable**
- Separate tiny executable installed to a stable per-user location. It is spawned by agent hook systems, reads their event payload, immediately reduces it to a non-sensitive fixed schema, delivers it to the local app, and exits.
- Never performs a subprocess command based on the agent's supplied text.
- Never requires an account, network login, language runtime, or the Pit Stop window to be open.
- When Pit Stop is closed, silently exits without blocking the agent.
- For permission-sensitive Cursor hooks it must always emit valid **allow** JSON on stdout, even when the app is offline or event processing fails.

**Frontend**
- Receives already-normalized events from the Tauri backend.
- Never needs access to raw prompts, command strings, source files, private transcripts, or hook bearer tokens.
- Runs rendering at a fixed maximum frame rate without being coupled to the number of incoming events.

---

## 5. Proposed repository layout

~~~text
pit-stop/
├── ARCHITECTURE.md
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
├── Cargo.toml                         # Rust workspace
├── Cargo.lock
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── package.json
├── apps/
│   └── desktop/
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── OverlayControls.tsx
│       │   │   ├── ConnectionStatus.tsx
│       │   │   ├── IntegrationsScreen.tsx
│       │   │   └── SettingsScreen.tsx
│       │   ├── scene/
│       │   │   ├── PitLaneScene.ts
│       │   │   ├── CrewMember.ts
│       │   │   ├── Car.ts
│       │   │   ├── TimelineScheduler.ts
│       │   │   ├── AnimationCatalog.ts
│       │   │   └── assets.ts
│       │   ├── state/
│       │   │   ├── eventStore.ts
│       │   │   └── settingsStore.ts
│       │   ├── contracts/
│       │   │   └── events.ts
│       │   └── styles/
│       │       └── theme.css
│       └── src-tauri/
│           ├── Cargo.toml
│           ├── tauri.conf.json
│           ├── capabilities/
│           └── src/
│               ├── main.rs
│               ├── app.rs
│               ├── receiver.rs
│               ├── sessions.rs
│               ├── settings.rs
│               └── commands.rs
├── crates/
│   ├── pit-stop-core/
│   │   └── src/{event,normalize,classify,security}.rs
│   ├── pit-stop-hook/
│   │   └── src/main.rs
│   └── pit-stop-integrations/
│       └── src/{claude,cursor,codex,install}.rs
├── assets/
│   ├── sprites/
│   ├── animations/
│   ├── sounds/
│   └── LICENSES.md
├── fixtures/
│   ├── claude/
│   ├── cursor/
│   ├── codex/
│   └── demo-sequence.json
├── scripts/
│   ├── package-helper.*
│   └── check-licenses.*
└── tests/
    ├── integration/
    └── visual/
~~~

This is the target structure, **not a claim that implementation files exist yet**. Start small: core, hook, desktop and original scene assets are required; extra directories should appear when they have code.

---

## 6. Agent integrations

Each integration implements the same internal adapter contract:

~~~ts
interface AgentAdapter {
  source: "claude" | "cursor" | "codex";
  supportedEvents: ReadonlySet<string>;
  normalize(input: unknown, context: HookContext): PitStopEvent | null;
  install(): Promise<InstallResult>;
  uninstall(): Promise<InstallResult>;
  diagnose(): Promise<DiagnosticResult>;
}
~~~

The Rust implementations are authoritative. The TypeScript interface above documents the behavior required by the frontend and tests; do not deserialize arbitrary provider payloads into the frontend.

### 6.1 Claude Code — full tool-level adapter (P0)

Use the documented command-hook API with these events:

| Native hook | Internal event |
| --- | --- |
| SessionStart | session.start |
| PreToolUse | tool.start |
| PostToolUse | tool.finish with reported tool success |
| PostToolUseFailure | tool.finish with tool failure |
| Stop | turn.complete |
| SessionEnd | session.end |
| SubagentStart / SubagentStop | subagent.start / subagent.end (after basic tool flow works) |

Claude Code commonly exposes tool_name, tool_input, tool_use_id, session_id and hook_event_name. The helper **may inspect** a Bash/PowerShell command temporarily to identify a test or build invocation, but must immediately discard the command string. Never forward command text to the desktop process.

The installer should safely merge Pit Stop's command hooks with existing hooks in the user's Claude settings (generally ~/.claude/settings.json), preserving unrelated settings and hook order. Use per-user configuration initially; no changes to repositories by default.

Illustrative configuration fragment **only** (the installer must generate the full config with a correctly quoted absolute executable path and additional events):

~~~json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "PIT_STOP_HOOK_COMMAND hook --source claude"
          }
        ]
      }
    ]
  }
}
~~~

On exit code 0 the Claude hook helper prints no stdout and never prints JSON decisions, context updates, or tool-control fields. Use short timeouts. Its failure must be non-blocking.

### 6.2 Cursor — full tool-level adapter (P0)

Use Cursor's documented user-level hooks (generally ~/.cursor/hooks.json). The relevant hooks include:

- sessionStart / sessionEnd / stop
- preToolUse / postToolUse / postToolUseFailure
- subagentStart / subagentStop where useful and safe

Prefer the generic tool hooks over stacking both generic and specific shell/file hooks; this avoids double counting the same operation. Cursor uses tool names such as Shell, Read and Write rather than always using Claude's names. The adapter performs provider-specific normalization.

**Important Cursor safety rule:** permission-related hooks treat invalid output as a possible block. For preToolUse, the CLI must print exactly a valid allow response on stdout, regardless of Pit Stop's health; it must never intentionally set deny or updated_input. Do not enable failClosed. Add fixture tests covering disconnected receivers, invalid input, and slow receivers.

Example (illustrative, not a complete generated config):

~~~json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "PIT_STOP_HOOK_COMMAND hook --source cursor --event preToolUse"
      }
    ],
    "postToolUse": [
      {
        "command": "PIT_STOP_HOOK_COMMAND hook --source cursor --event postToolUse"
      }
    ]
  }
}
~~~

For the **preToolUse** invocation, print:

~~~json
{"permission":"allow"}
~~~

For ordinary post hooks, emit no text. Always return process exit code 0. If the user runs Cursor in a remote/cloud environment, that environment cannot assume it can reach the user's local desktop port. Mark those sessions unsupported rather than pretending they are observed.

### 6.3 OpenAI Codex CLI — honest limited adapter (P1)

The documented user-level notify configuration runs an external program with **one JSON command-line argument**. The documented event is **agent-turn-complete**; it does not provide individual live tool start/finish events through notify. Therefore:

- Parse the JSON argument locally.
- Use thread-id (hashed), turn-id (hashed), and type.
- Map it to **turn.complete** and show the car leaving the pit box.
- Do **not** fabricate tool animations, commands, tests, builds, or a preceding live pit stop.
- Label the integration in the UI **Turn completion only**.

Illustrative ~/.codex/config.toml setting:

~~~toml
notify = ["ABSOLUTE_PATH_TO_PIT_STOP_HOOK", "notify", "--source", "codex"]
~~~

Codex notify is a **user-level** setting. The setup tool must preserve TOML formatting/other keys and must not clobber an existing notify command. If another notifier is already configured, present a safe manual setup or an explicitly opt-in chain after testing, rather than silently replacing it.

Future full Codex support requires an officially documented tool-event stream or a separately launched, opt-in agent process with structured JSON events. Do not ingest local session transcripts as a workaround.

### 6.4 Adapter compatibility rules

- Each adapter is version-aware and identified in diagnostics.
- Unknown event names are ignored safely and counted only in ephemeral debug counters.
- Do not use provider-private application APIs.
- Each hook is idempotently installed: running Connect again must not duplicate entries.
- Uninstall removes **only Pit Stop-owned entries** and leaves every other hook untouched.
- On a malformed settings file, make no changes. Show a useful error and retain an original backup.
- Confirm tool-level behavior with real agents before marking an integration **Verified**.

Sources: [Claude Code hooks](https://code.claude.com/docs/en/hooks), [Cursor hooks](https://prod.cursor.com/docs/hooks), [Codex advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced).

---

## 7. Canonical event model

Normalize events **in the CLI**, before crossing the process boundary. A sample event received by the desktop process:

~~~json
{
  "version": 1,
  "event_id": "2afc4f77-22e7-4d53-b31e-d4e9322d9bda",
  "source": "claude",
  "session_key": "local-opaque-session-key",
  "tool_key": "local-opaque-tool-key",
  "kind": "tool.start",
  "operation": "test",
  "timestamp_ms": 1791777600000,
  "duration_ms": null,
  "outcome": "unknown"
}
~~~

### Typed contract

~~~ts
type Source = "claude" | "cursor" | "codex";
type Kind =
  | "session.start"
  | "session.end"
  | "turn.complete"
  | "tool.start"
  | "tool.finish"
  | "subagent.start"
  | "subagent.end";
type Operation = "inspect" | "edit" | "test" | "build" |
  "shell" | "mcp" | "delegate" | "other";
type Outcome = "unknown" | "success" | "failure";

interface PitStopEvent {
  version: 1;
  event_id: string;
  source: Source;
  session_key: string;
  tool_key: string | null;
  kind: Kind;
  operation: Operation;
  timestamp_ms: number;
  duration_ms: number | null;
  outcome: Outcome;
}
~~~

**Payload rules**
- Strict allowlist only. Reject unknown schema versions, unexpected extra fields, excessive nesting and payloads over 8 KiB at the local receiver.
- The hook process caps the raw provider input it reads (for example, 1 MiB). Oversized, invalid and missing payloads are safely dropped.
- Never include raw user-provided strings in the normalized event model. Operation and outcome are enums.
- For session and tool keys, derive stable-within-a-run opaque identifiers using a keyed hash with an ephemeral per-app-run secret; never forward a provider's raw ID.
- timestamp_ms comes from a local clock, is validated for reasonableness, and is not treated as proof of external event order.
- tool_key is null for events without a tool; duration_ms is only set when the source actually supplies it or it can be measured from matching local start/finish events.
- Preserve the difference between a **tool's success** and a **test suite's pass/fail result**. Rendering success means only the corresponding tool event completed without an integration-reported error.

### Event mapping

| Signal | Classification | Pit crew action |
| --- | --- | --- |
| Session starts | session.start | Car rolls into pit lane and stops |
| Read, Grep, Glob, search | inspect | Engineer checks monitor/telemetry |
| Edit, Write, MultiEdit | edit | Mechanic swaps a tire / turns impact wrench |
| Recognized test command | test | Crew checks tire pressure and verification board |
| Recognized build command | build | Crew fits front wing and checks assembly |
| Other shell command | shell | Jack crew raises car and works under it |
| MCP/external tool | mcp | Radio engineer responds at pit wall |
| Spawn subagent | delegate | Additional mechanic joins the crew |
| Tool fails | tool.finish/failure | Caution light and recovery animation |
| Turn finishes | turn.complete | Release signal, car exits |
| Codex notify completes | turn.complete | Turn-finished animation only, with no fictional prior tools |

### Command classifier

Classify the **tool action**, not arbitrary text found anywhere in a log or output. For shell-like tools, recognize executable/argument patterns for common test/build tasks, such as:

- Tests: npm/pnpm/yarn/bun test; pytest; cargo test; go test; dotnet test; vitest; jest; gradle test; mvn test.
- Builds: npm/pnpm/yarn/bun run build or build; cargo build; go build; dotnet build; gradle build; mvn package/compile.

Treat command chaining, wrappers, aliases and ambiguous invocations conservatively as **shell**. Do not evaluate shell syntax or execute commands. Unknown tools get **other**. The classifier must include fixtures for false positives (e.g. a grep searching for the word "test"), Windows PowerShell variants, and quoted command arguments. The user can disable test/build inference if desired.

---

## 8. Local event delivery and failure handling

### Receiver protocol

- Bind TCP only to **127.0.0.1** with an ephemeral OS-assigned port, never 0.0.0.0.
- Support POST /v1/events with Content-Type: application/json and Authorization: Bearer <per-run-secret>.
- Other HTTP methods and routes return 404/405. Reject requests with a browser Origin and do not enable CORS.
- Rate-limit by connection and globally, reject invalid schemas, and return immediately after enqueuing a valid event.
- The app writes a per-user restricted runtime descriptor with port, PID, startup identifier and ephemeral token into its OS user-data directory. On Unix ensure mode 0600; on Windows set ACLs to the current user.
- The hook helper reads that file only if ownership/permissions are valid, uses a short local connect/request timeout, and exits successfully even if it cannot connect.
- Do not listen on a public interface or expose a web dashboard over the LAN.

### In-memory lifecycle

Use a reducer keyed by (source, session_key, tool_key):

1. On tool.start, mark that tool as running.
2. On matching tool.finish, record outcome and estimated elapsed time; remove from active tools after an animation cooldown.
3. On duplicate finish, ignore the duplicate by event_id or terminal tool state.
4. On finish without a preceding start, play a compressed finish-only operation; do not synthesize a fake real start time.
5. On out-of-order events, prefer per-tool transition validity over wall-clock ordering.
6. On session.end, release any remaining animations as **cancelled/unknown**, not success.
7. If a tool remains active for an extended period, keep an unobtrusive working loop. After an appropriate stale timeout, mark status **unknown** without claiming the tool failed.
8. Multiple simultaneous tools remain distinct internally even when rendered in one pit box.

Bound memory to a configured maximum (initially: last 200 event summaries across 8 active sessions). Coalesce high-frequency repetitive inspect events, rather than allocating an animation for every individual read.

### Throughput and performance targets

These are **targets to test**, not measured guarantees:

- Hook helper: aim for p95 under 100 ms elapsed in normal local operation, using optimized release builds.
- Receiver: process 100 normalized events/s without frame stutter or memory growth.
- UI: aim for 60 fps in normal mode, adapt to 30 fps / reduced motion on slower machines.
- Screen overlays: minimize inactive CPU/GPU use (pause rendering when hidden, sleep on idle, limit particle effects).
- Transport must never wait for a frontend animation to finish before acknowledging an event.

The helper exits 0 on every expected failure, including unavailable app, bad token, timeout and malformed event input. Errors may be exposed in **local opt-in diagnostics**; never print secrets or raw hook payloads.

---

> **UI implementation note:** Use **GPT Astra** for Pit Stop's UI design and frontend implementation, including the pit-crew scene, overlay layout, animation presentation, onboarding, and visual polish. Preserve the zero-cost, local-first requirements and use only freely redistributable assets and dependencies.

## 9. Animation engine and visual direction

### Aesthetic

An original, playful **2D top-down/isometric pit bay** with a simplified racing car, crew wearing colored helmets, tools, timing tower, pit-lane markings, and expressive little animations. It should read clearly at approximately 420 x 240 pixels. Use flat colors, precise silhouettes, readable visual hierarchy and a restrained palette; avoid generic AI-generated illustration packs.

Assets are source-controlled original SVGs or sprite sheets that can be redrawn and recolored. Load assets locally. Keep art assets and code separate so community artists can contribute themes without editing event logic.

### Scene graph

~~~text
PitLaneScene
├── Background (pit box, markings, garage)
├── Car (arrival, idle, departure, reaction)
├── CrewLayer
│   ├── FrontJack
│   ├── RearMechanic
│   ├── LeftWheelCrew
│   ├── RightWheelCrew
│   └── PitWallEngineer
├── Props (wheel, jack, impact wrench, monitor, front wing)
├── EffectLayer (sparks, dust, checkmarks, warning signal)
└── HUD (event title, source, status, activity counter)
~~~

### Finite state machine

~~~text
EMPTY -> ARRIVING -> READY -> OPERATING -> RELEASING -> EMPTY
                       ^         |
                       |         v
                       +-- IDLE/WAITING
                       |
                       +-- CAUTION/RECOVERY
~~~

Tool animations are **substates**, not permission to force the whole car to release. Each animation clip has: id, trigger, priority, resource locks, minimum visual duration, maximum presentation duration (not tool timeout), cancel behavior, reduced-motion fallback, and optional sound cue.

### Recommended clips

| Clip ID | Trigger | Action |
| --- | --- | --- |
| car.arrive | session.start | Car enters, brakes and settles |
| telemetry.inspect | inspect | Engineer taps monitor and points at dashboard |
| tire.change | edit | Wheel crew lifts tire, swaps it, uses wrench |
| pressure.check | test | Mechanic checks tires; board displays verification-in-progress |
| wing.install | build | Front crew aligns wing and tightens fasteners |
| jack.operate | shell | Jack moves, mechanic works beneath car |
| radio.receive | mcp | Pit-wall engineer holds radio, antenna flashes |
| crew.join | subagent.start | Secondary crew member runs into pit lane |
| warning.flash | tool failure | Amber/red caution pulse, no misleading fire/crash |
| car.release | turn.complete | Jack lowers, release light flashes, car pulls away |
| idle.breathing | no current tools | Small ambient animations at low power |

### Scheduling and concurrency

- **Do not block or serialize real agent events.** This is a visual scheduler only.
- Maintain a small priority queue per visible session (e.g. 24 entries). Higher-priority finish/failure/turn-complete signals cannot be silently overwritten by repeated reads.
- A clip owns virtual resources (car front, left wheel, right wheel, pit wall). Independent clips can overlap; clips sharing a resource queue or replace lower-priority idle loops.
- Extremely fast real operations should still get a readable micro-animation (roughly 350–750 ms); a long tool keeps the corresponding crew in a repeating active loop until its finish event arrives.
- If many calls happen rapidly, combine repeated read/inspect events into a **xN** activity badge and a single montage; never make the screen backlog grow unbounded.
- The *displayed* pit-stop timer is purely a stylistic **elapsed session/activity timer**. Do not present invented competitive timings or compare developer performance.
- Deterministic seeded animations are required for repeatable demo scripts and visual tests.
- Prefer keyframe/sprite animation over physics simulation. The pit scene is a compact animation toy, not a game engine.

---

## 10. Windows, layout and accessibility

### Window presets

| Mode | Default size | Purpose |
| --- | --- | --- |
| Compact | ~420 x 240 | Corner overlay while coding |
| Expanded | ~720 x 405 | Detailed pit box and readable activity labels |
| Capture | 1280 x 720 scene layout, window-resizable | Clear 16:9 framing for OBS or screen capture |

Windows 11 is first-class. Tauri should persist last chosen size and position, clamp off-screen coordinates, and offer a **Reset window position** action and hotkey.

Controls: always-on-top, resize, drag, compact/expanded/capture, pause animation, mute, theme (light/dark/team colors), reset demo, select active session, connect/disconnect integration. Transparent-window / click-through mode is optional and platform-gated; provide a reliable global way to restore interactivity if implemented. macOS/Linux behaviors vary, especially under Wayland; do not declare full support until tested.

### Accessibility

- Respect reduced-motion OS settings; replace movement with static poses and status transitions.
- Provide sufficient text contrast and never convey a failure only through red color.
- Make audio opt-in, muted by default, independently adjustable from system audio.
- Keyboard-navigable controls and tooltips; do not require fast clicks or precise dragging.
- Don't show raw project names/paths while in recording mode unless a user explicitly opts in.

### Screen recording support

Capture mode is an overlay presentation mode, **not** a recording/upload feature. It should hide configuration clutter, display a simple session label, show the car/crew clearly at 16:9, and allow a looping demo sequence suitable for a 10–20 second screen capture.

---

## 11. Settings, setup and uninstall behavior

### Settings storage

Use the OS user-data directory (e.g. the platform application-data folder) rather than hard-coding a location that breaks under Windows roaming profiles. Separate:
- settings.json: preferences and integration metadata, no secrets from agents.
- runtime.json: ephemeral port/token with strict permissions; recreated every launch.
- backups/: timestamped backups of agent settings before any modification.
- logs/: created only if the user explicitly enables local diagnostic logging; sanitized and capped by size/retention.

No SQLite database is required in v1. If optional historical activity statistics are added later, store only aggregate counts and dates in a local SQLite file, disabled by default.

### Installation flow

1. Check whether the hook executable has been copied to the stable, per-user install path.
2. Detect locally installed integrations and show each integration's **real** support level.
3. Show a diff of planned changes to agent hook configuration.
4. Ask permission before editing external config files.
5. Create an atomic backup, parse existing JSON/TOML, merge only Pit Stop entries, and atomically replace the config.
6. Run a synthetic event through the hook executable; verify the app receives it.
7. Explain whether restarting the agent is necessary for it to reload settings.
8. Offer a one-click **Disconnect** that removes only the added Pit Stop entries, with a test proving preservation of third-party hooks.

On update, replace the helper binary atomically and update stale absolute hook paths only when needed. On app uninstall, provide an explicit disconnect workflow; document manual cleanup if the OS uninstaller cannot run it. Avoid global PATH edits and administrator rights.

### Diagnostics

Show: version, connected agent, installed hook location, last event age, listener health, hook format compatibility, failures by class, and **test animation** button. Never show raw prompts or command lines.

---

## 12. Security and privacy boundaries

### Threat model

- Agent hook inputs may contain secrets and must be treated as **untrusted sensitive material**.
- Other local software may try to send arbitrary HTTP requests to loopback.
- Browser pages can attempt local requests and cross-origin tricks.
- User-level settings may already contain arbitrary third-party hooks.
- A malicious process running as the **same OS user** may be able to read local files despite ACLs; local bearer authentication does not defend against an already-compromised user account.

### Required controls

- The hook helper uses an input-size cap, strict parsing, no arbitrary deserialization side effects, and a fixed event allowlist.
- Classification happens locally; command strings are **not logged, displayed, persisted or transported**.
- The listener accepts only authenticated application/json POSTs on 127.0.0.1, enforces an 8 KiB body limit, requires a custom Authorization header, does not set permissive CORS headers, and rejects unexpected browser Origin headers.
- Tauri's capability allowlist should be narrow; disable unneeded shell, filesystem, and HTTP access in the frontend.
- No command execution based on agent-reported contents.
- No external URL requests from the app or hidden update checks by default. Manual release-checking, if later added, must be opt-in.
- Do not bundle telemetry SDKs, crash uploaders, analytics pixels, web fonts, video/CDN loaders, API clients requiring paid services, or secrets in build artifacts.
- Verify signed/official dependency downloads where possible and pin dependency versions.
- A hook installer must make reversible config edits, must not modify agent security policy settings, and must support an explicit dry-run diff.
- Logs are off by default. With local debugging enabled, store only counts, event types and diagnostic error codes, not user content.

Security testing must include maliciously large event inputs, unauthorized localhost requests, bad auth, concurrent hook invocations, invalid provider JSON, Cursor permission-hook failures and app shutdown during a hook.

---

## 13. Development and test plan

### Local build prerequisites

Rust stable, Cargo, Node.js LTS, pnpm, and Tauri v2 platform prerequisites. On Windows use free Microsoft C++ build tools and the system WebView2 runtime when required. The development workflow should not require Docker, paid CI, a cloud service, an API key, or model access.

Suggested project commands once scripts are implemented:

~~~bash
pnpm install
cargo test --workspace
pnpm test
pnpm --filter desktop dev
pnpm --filter desktop tauri dev
pnpm --filter desktop tauri build
~~~

These are intended targets, not a claim that package scripts currently exist.

### Fixture and unit tests

- Provider fixtures cover Claude tool success/failure, Cursor permission allow, Codex notify with sensitive fields, malformed inputs and missing IDs.
- Classifier fixtures distinguish reads, writes, shell, tests, builds, nested commands, Windows PowerShell and false matches.
- Session reducer tests cover start/finish pairs, duplicates, out-of-order results, concurrent calls, stop before finish and stale tools.
- Hook CLI tests assert **exit code 0** for unavailable listener, wrong token, unsupported event and malformed inputs; Cursor preToolUse always prints valid allow JSON.
- Schema tests prove no provider-defined freeform strings can escape sanitization.
- Installer tests use temporary fake config directories and verify idempotency, backup/restore, third-party hook preservation and atomic-write behavior.
- Security tests send unauthenticated POSTs and wrong content types; all are rejected.

### Visual and integration tests

- Snapshot major animations at deterministic timestamps.
- Show the pit scene on Windows with no external internet access.
- Stress with 100 events/sec for 60 seconds, then return to idle without memory growth.
- Verify a real Claude Code session produces starts, finishes and a stop, and a real Cursor session does so without affecting tool permissions.
- Verify Codex shows **completion only**, with no fabricated test/build operations.
- Ensure that closing the desktop app while hooks are installed never breaks an agent command.
- Test overlay and recording presets at 100%, 125%, 150% display scaling and reduced-motion settings.
- Test open/quit/reopen, repeated Connect/Disconnect, app upgrades and an interrupted settings write.

### Definition of done for v1

1. Fresh Windows install can display a full high-quality animated demo completely offline.
2. Claude Code and Cursor can each drive live crew animations from real user-level hooks.
3. Every permitted tool action remains permitted with Pit Stop open, closed, or malfunctioning.
4. Test and build labels are inferred conservatively from actual tool commands; unknown results are never reported as passes.
5. Codex is clearly labeled as turn-completion only.
6. Demo/capture mode is clean enough to screen-record without editing or hiding debug UI.
7. Removing Pit Stop restores the existing agent configuration without deleting third-party settings.
8. The release makes no remote connections, consumes no API tokens, and needs no paid service.

---

## 14. Implementation order

**Milestone 0 — make it visually compelling**
- Create original car, four-to-six crew characters, props and a clean pit-bay scene.
- Implement deterministic demo animations first: inspect, edit, test, build, failure and release.
- Ship small/expanded/capture layouts. If this is not fun to watch, integration work will not fix it.

**Milestone 1 — event engine**
- Implement Rust event contract, sanitizer, command classifier and tests.
- Build a local ephemeral receiver plus authenticated pit-stop-hook binary.
- Add reducer, debouncing, concurrency and UI state transitions.

**Milestone 2 — Claude Code**
- Implement safe, reversible user-level hook installation.
- Drive real tool-start and tool-finish animations and turn completion.
- Test Windows paths, offline mode, failure behavior and restart requirements.

**Milestone 3 — Cursor**
- Add its different event naming and permission-hook output requirements.
- Validate real sessions, user-level settings merging and no duplicate events.

**Milestone 4 — Codex + final polish**
- Add notify-based turn-complete adapter with explicit support limitation.
- Finish sound toggle, themes, reduced motion, diagnostics and hotkeys.

**Milestone 5 — release**
- Add MIT LICENSE, README demo GIF/video, contribution guide and asset attribution.
- Perform clean Windows installer/build testing; add macOS and Linux when verified.
- Publish an optional GitHub Release or documented local build steps. No paid signing should be required; explain that unsigned installers may display operating-system warnings.

The project does **not** need a server, SaaS account, app store, or paid CDN to ship. Public GitHub Actions may be useful for open-source CI within GitHub's current free-usage rules, but releases must also be reproducible locally. Paid code-signing certificates, app-store distribution and paid runner overages are explicitly optional and outside the required zero-cost path.

---

## 15. Contribution and licensing policy

Use an MIT license for original source code after verifying the included assets can be licensed compatibly. Require license/attribution information for every non-original artwork, font, icon or sound. Favor completely original sprites, freely redistributable audio and permissive dependencies.

Accept PRs for adapter fixtures, new original crew animations, performance improvements, accessibility, OS support and UI themes. Avoid PRs that introduce telemetry, cloud backends, proprietary art, required API keys, or unverified claims about agents' capabilities.

For feature proposals that depend on a provider's internal format, require a public specification or stable documented hook first. Build the product around what agents **actually emit**.

## 16. Authoritative references

- [Claude Code hook event reference](https://code.claude.com/docs/en/hooks)
- [Cursor hooks and their permission output schemas](https://prod.cursor.com/docs/hooks)
- [OpenAI Codex advanced configuration and notify limitations](https://learn.chatgpt.com/docs/config-file/config-advanced)
- [Tauri v2 embedding external executables](https://v2.tauri.app/develop/sidecar/)
- [PixiJS source and license](https://github.com/pixijs/pixijs)

These references describe upstream APIs as reviewed when this architecture was written (October 2026). Verify the installed provider version and hook format during implementation rather than relying on undocumented compatibility.

---

**North star:** the user starts a coding agent, glances at the corner of the screen, and sees a tiny coordinated pit crew respond to genuine work—instantly, locally, accurately, and for free.
