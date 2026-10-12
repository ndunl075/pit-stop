import { useEffect, useRef, useState } from "react";
import { eventLabel, sessionId, type PitStopEvent } from "./contracts/events";
import {
  emptyState,
  expireTools,
  reduceEvent,
  sessionStatus,
  type EventState,
} from "./state/eventStore";
import { defaults, type Settings } from "./state/settingsStore";
import {
  command,
  native,
  settingsLoad,
  settingsSave,
  subscribeEvents,
} from "./native";
import { PitLaneScene } from "./scene/PitLaneScene";
import { DEMO_DURATION, demoEvent, demoSequence } from "./scene/demo";
import { playCue, unlockSound } from "./scene/sound";
import { Icon } from "./components/Icon";
import { Dialog } from "./components/Dialog";
import { IntegrationsScreen } from "./components/IntegrationsScreen";
import { Diagnostics } from "./components/Diagnostics";
type Panel = "connect" | "settings" | "diagnostics" | null;
export default function App() {
  const [settings, setSettings] = useState<Settings>(defaults),
    [state, setState] = useState<EventState>(emptyState),
    [selected, setSelected] = useState("claude:demo"),
    [demo, setDemo] = useState(true),
    [paused, setPaused] = useState(false),
    [panel, setPanel] = useState<Panel>(null),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [time, setTime] = useState(0),
    [systemReduced, setSystemReduced] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<PitLaneScene | null>(null),
    stateRef = useRef(state),
    selectedRef = useRef(selected),
    mode = useRef(demo),
    settingsRef = useRef(settings),
    pausedRef = useRef(paused),
    elapsed = useRef(0),
    index = useRef(0),
    loop = useRef(0),
    epoch = useRef(Date.now()),
    liveState = useRef<EventState>(emptyState());
  stateRef.current = state;
  selectedRef.current = selected;
  mode.current = demo;
  settingsRef.current = settings;
  pausedRef.current = paused;
  const session = state.sessions.get(selected),
    status = demo
      ? paused
        ? "Paused"
        : sessionStatus(session) === "Disconnected"
          ? "Waiting"
          : sessionStatus(session)
      : sessionStatus(session),
    last = session?.last,
    running = [...(session?.tools.values() ?? [])].filter(
      (t) => t.state === "running",
    ),
    reduced =
      settings.motion === "reduced" ||
      (settings.motion === "system" && systemReduced);
  function ingest(e: PitStopEvent) {
    const next = reduceEvent(stateRef.current, e, Date.now());
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    if (!next.sessions.has(selectedRef.current)) {
      selectedRef.current = sessionId(e);
      setSelected(sessionId(e));
      scene.current?.reset();
    }
    if (sessionId(e) === selectedRef.current) {
      scene.current?.event(e);
      if (
        settingsRef.current.sound &&
        (e.kind === "tool.finish" || e.kind === "turn.complete")
      )
        playCue(e.outcome === "failure", settingsRef.current.volume);
    }
  }
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReduced(query.matches);
    const update = () => setSystemReduced(query.matches);
    query.addEventListener("change", update);
    settingsLoad()
      .then(setSettings)
      .catch(() =>
        setError("Preferences could not be loaded. Using defaults."),
      );
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const s = new PitLaneScene();
    scene.current = s;
    s.init(host.current!)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "The scene could not initialize. Check WebGL support or restart the desktop app.",
          );
      });
    return () => {
      cancelled = true;
      s.destroy();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.update({
      reduced,
      paused,
      fps: settings.fps,
      theme: settings.theme,
    });
  }, [reduced, paused, settings.fps, settings.theme, ready]);
  useEffect(() => {
    if (scene.current)
      scene.current.runningOperations = new Set(
        running.map((t) => t.event.operation),
      );
  }, [state, selected]);
  useEffect(() => {
    let cleanup: (() => void) | undefined,
      disposed = false;
    subscribeEvents((e) => {
      liveState.current = reduceEvent(liveState.current, e, Date.now());
      if (!mode.current) ingest(e);
    })
      .then((fn) => {
        if (disposed) fn();
        else cleanup = fn;
      })
      .catch(() =>
        setError(
          "Could not subscribe to local events. Restart the app to reconnect.",
        ),
      );
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        delta = Math.min(100, now - previous);
      previous = now;
      if (!pausedRef.current && !document.hidden && mode.current) {
        elapsed.current += delta;
        while (
          index.current < demoSequence.length &&
          demoSequence[index.current].at <= elapsed.current
        ) {
          ingest(demoEvent(index.current, loop.current, epoch.current));
          index.current++;
        }
        if (elapsed.current >= DEMO_DURATION) {
          elapsed.current = 0;
          index.current = 0;
          loop.current++;
          epoch.current = Date.now();
          scene.current?.reset();
        }
        setTime(Math.floor(elapsed.current / 1000) * 1000);
      } else if (!mode.current) {
        setState((current) => {
          const next = expireTools(current, Date.now());
          stateRef.current = next;
          return next;
        });
        setTime(Math.floor(Date.now() / 1000) * 1000);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [ready]);
  async function updateSettings(patch: Partial<Settings>) {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    settingsRef.current = next;
    try {
      if (patch.sound) await unlockSound();
      if (native && patch.preset)
        await command("set_window_preset", { preset: patch.preset });
      if (native && patch.always_on_top !== undefined)
        await command("set_always_on_top", { enabled: patch.always_on_top });
      await settingsSave(next);
    } catch (e) {
      setError(String(e));
    }
  }
  function resetDemo() {
    scene.current?.reset();
    stateRef.current = emptyState();
    setState(stateRef.current);
    selectedRef.current = "claude:demo";
    setSelected("claude:demo");
    mode.current = true;
    setDemo(true);
    elapsed.current = 0;
    index.current = 0;
    loop.current = 0;
    epoch.current = Date.now();
    setTime(0);
    setPaused(false);
  }
  function showLive() {
    scene.current?.reset();
    mode.current = false;
    setDemo(false);
    stateRef.current = liveState.current;
    setState(liveState.current);
    const id = [...liveState.current.sessions.keys()].at(-1) ?? "";
    selectedRef.current = id;
    setSelected(id);
    scene.current!.carVisible = Boolean(
      liveState.current.sessions.get(id) &&
        !liveState.current.sessions.get(id)?.finished,
    );
    setPaused(false);
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement).closest("input,select,textarea,button") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        panel
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setPaused((x) => !x);
      }
      if (e.key.toLowerCase() === "m")
        void updateSettings({ sound: !settingsRef.current.sound });
      if (e.key.toLowerCase() === "d") resetDemo();
      if (e.key.toLowerCase() === "c")
        void updateSettings({
          preset:
            settingsRef.current.preset === "capture" ? "expanded" : "capture",
        });
      if (e.key.toLowerCase() === "r" && e.shiftKey && native)
        command("reset_window_position").catch((e) => setError(String(e)));
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [panel]);
  const elapsedSeconds = demo
    ? Math.floor(time / 1000)
    : session
      ? Math.max(
          0,
          Math.floor(
            ((session.finished ? session.lastAt : Date.now()) -
              session.startedAt) /
              1000,
          ),
        )
      : 0;
  function selectSession(id: string) {
    selectedRef.current = id;
    setSelected(id);
    scene.current?.reset();
    const s = state.sessions.get(id);
    if (scene.current)
      scene.current.carVisible = Boolean(s && !s.ended && !s.finished);
  }
  return (
    <main
      className={`app theme-${settings.theme} preset-${settings.preset} ${native ? "native" : "browser"}`}
    >
      <div className="browser-heading">
        <a className="wordmark" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-symbol">
            ▰<br />▰
          </span>
          pit stop<span className="version">/ 01</span>
        </a>
        <span className="heading-caption">
          A LITTLE CREW FOR YOUR BIG IDEAS
        </span>
        <span className="local-label">
          <i /> All local. Always.
        </span>
      </div>
      <section className="desktop-shell" aria-label="Pit Stop animated overlay">
        <header className="topbar" data-tauri-drag-region>
          <div className="app-brand" data-tauri-drag-region>
            <span className="mini-mark">▰▰</span>
            <strong>PIT STOP</strong>
            <span className="divider" />
            <span className="bay-label">BAY 07</span>
          </div>
          <div className="top-actions">
            <button
              title="Connect coding agents"
              className="connect-top"
              onClick={() => setPanel("connect")}
            >
              <Icon name="link" size={14} />
              <span>Connect agent</span>
            </button>
            <button
              className={`icon-button ${settings.always_on_top ? "active" : ""}`}
              disabled={!native}
              title={
                native
                  ? "Always on top"
                  : "Always on top is available in the desktop app"
              }
              aria-label="Always on top"
              aria-pressed={settings.always_on_top}
              onClick={() =>
                updateSettings({ always_on_top: !settings.always_on_top })
              }
            >
              <Icon name="pin" size={15} />
            </button>
            <button
              className="icon-button"
              title="Settings"
              aria-label="Settings"
              onClick={() => setPanel("settings")}
            >
              <Icon name="settings" size={17} />
            </button>
          </div>
        </header>
        <div className="scene-wrap">
          <div
            ref={host}
            className="pixi-host"
            role="img"
            aria-label={`Original racing pit crew. ${demo ? "Offline demonstration. " : ""}${last ? eventLabel(last) : "Waiting for agent activity."}`}
          />
          <div className="scene-top">
            <span className={`mode-chip ${demo ? "demo" : ""}`}>
              <i />
              {demo
                ? "DEMO REPLAY"
                : status === "Disconnected"
                  ? "DISCONNECTED"
                  : "LOCAL SIGNAL"}
            </span>
            <span className="scene-coordinate">
              LOCAL MOTOR WORKS <b>07</b>
            </span>
          </div>
          <div className="scene-bottom">
            <div className="scene-note">
              <span className="signal-dot" />{" "}
              {demo
                ? "Simulated activity · 19s loop"
                : last?.source === "codex"
                  ? "Codex · turn completion only"
                  : "Your work. A little more alive."}
            </div>
            <span className="scene-fps">
              {reduced ? "REDUCED MOTION" : `${settings.fps} FPS MAX`}
            </span>
          </div>
          {!ready && !error && (
            <div className="loading">Preparing the crew…</div>
          )}
        </div>
        <div className="telemetry">
          <div className="activity">
            <span className={`status-light ${status.toLowerCase()}`} />
            <div>
              <div className="eyebrow">
                {demo ? "DEMO" : status} <span>/</span>{" "}
                {session
                  ? `SESSION ${String(session.number).padStart(2, "0")}`
                  : "NO AGENT CONNECTED"}
              </div>
              <div
                className="activity-title"
                aria-live="polite"
                aria-atomic="true"
              >
                {paused
                  ? "Taking a breather"
                  : last
                    ? eventLabel(last)
                    : "Your crew is standing by"}
              </div>
            </div>
          </div>
          <div className="metric">
            <span className="eyebrow">ACTIVITY TIME</span>
            <span className="timer">
              {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}
              <em>:</em>
              {String(elapsedSeconds % 60).padStart(2, "0")}
            </span>
          </div>
          <div className="metric event-metric">
            <span className="eyebrow">SIGNALS</span>
            <span className="timer">
              {String(
                state.events.filter((e) => sessionId(e) === selected).length,
              ).padStart(2, "0")}
            </span>
          </div>
        </div>
        <footer className="controlbar">
          <div className="playback">
            <button
              className="play-button"
              aria-label={paused ? "Resume animation" : "Pause animation"}
              title="Pause / resume (Space)"
              aria-pressed={paused}
              onClick={() => setPaused((x) => !x)}
            >
              <Icon name={paused ? "play" : "pause"} size={16} />
            </button>
            <button
              className="icon-button"
              title="Restart demo (D)"
              aria-label="Restart demo"
              onClick={resetDemo}
            >
              <Icon name="reset" size={16} />
            </button>
            <button
              className="icon-button"
              title="Toggle sound (M)"
              aria-label={settings.sound ? "Mute sound" : "Enable sound"}
              aria-pressed={settings.sound}
              onClick={() => updateSettings({ sound: !settings.sound })}
            >
              <Icon name={settings.sound ? "sound" : "mute"} size={16} />
            </button>
            <span className="control-divider" />
            <select
              className="session-select"
              aria-label="Select session"
              value={demo ? "demo" : selected}
              onChange={(e) =>
                e.target.value === "demo"
                  ? resetDemo()
                  : e.target.value === "live"
                    ? showLive()
                    : selectSession(e.target.value)
              }
            >
              {demo ? (
                <>
                  <option value="demo">Demo session</option>
                  <option value="live">Live activity</option>
                </>
              ) : (
                <>
                  <option value="" disabled>
                    Waiting for a session
                  </option>
                  <option value="demo">Play demo</option>
                  {[...state.sessions.values()].map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.source} · Session {s.number}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
          <div className="view-controls">
            <button
              className="text-button live-switch"
              onClick={demo ? showLive : resetDemo}
            >
              {demo ? "Go live" : "Play demo"} <Icon name="arrow" size={13} />
            </button>
            <select
              aria-label="Window preset"
              value={settings.preset}
              onChange={(e) =>
                updateSettings({ preset: e.target.value as Settings["preset"] })
              }
            >
              <option value="compact">Compact</option>
              <option value="expanded">Expanded</option>
              <option value="capture">Capture</option>
            </select>
            <button
              className="icon-button"
              title="Toggle capture layout (C)"
              aria-label="Toggle capture layout"
              onClick={() =>
                updateSettings({
                  preset:
                    settings.preset === "capture" ? "expanded" : "capture",
                })
              }
            >
              <Icon name="expand" size={16} />
            </button>
          </div>
        </footer>
      </section>
      <div className="below-scene">
        <p>
          <span className="tiny-cross">✳</span> Keep building. We'll handle the
          pit stop.
        </p>
        <button className="text-button" onClick={() => setPanel("diagnostics")}>
          Local diagnostics <Icon name="arrow" size={13} />
        </button>
      </div>
      <div className="honesty-note">
        {demo
          ? "This is a scripted demo. Connect a local agent for real activity."
          : "A finished turn means the turn ended. It does not mean tests passed or code shipped."}
      </div>
      {error && (
        <div className="toast" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {panel && (
        <Dialog
          title={
            panel === "connect"
              ? "Meet your pit crew"
              : panel === "settings"
                ? "Make it your pit stop"
                : "Local diagnostics"
          }
          onClose={() => setPanel(null)}
        >
          {panel === "connect" ? (
            <IntegrationsScreen />
          ) : panel === "diagnostics" ? (
            <Diagnostics
              onDemo={() => {
                resetDemo();
                setPanel(null);
              }}
            />
          ) : (
            <div className="panel-body settings">
              <p className="intro-copy">Small window. Your rules.</p>
              <label>
                Colorway
                <select
                  value={settings.theme}
                  onChange={(e) =>
                    updateSettings({
                      theme: e.target.value as Settings["theme"],
                    })
                  }
                >
                  <option value="midnight">Midnight / lime</option>
                  <option value="paper">Paddock / paper</option>
                  <option value="ember">Ember / copper</option>
                </select>
              </label>
              <label>
                Motion
                <select
                  value={settings.motion}
                  onChange={(e) =>
                    updateSettings({
                      motion: e.target.value as Settings["motion"],
                    })
                  }
                >
                  <option value="system">Follow system preference</option>
                  <option value="reduced">Reduced · static poses</option>
                  <option value="full">Full animation</option>
                </select>
              </label>
              <label>
                Infer tests and builds
                <input
                  type="checkbox"
                  checked={settings.infer_commands}
                  onChange={(e) =>
                    updateSettings({ infer_commands: e.target.checked })
                  }
                />
              </label>
              <label>
                Frame limit
                <select
                  value={settings.fps}
                  onChange={(e) =>
                    updateSettings({ fps: Number(e.target.value) as 30 | 60 })
                  }
                >
                  <option value="60">60 fps</option>
                  <option value="30">30 fps · lower power</option>
                </select>
              </label>
              <label>
                Sound cues
                <input
                  type="checkbox"
                  checked={settings.sound}
                  onChange={(e) => updateSettings({ sound: e.target.checked })}
                />
              </label>
              <label>
                Sound volume
                <input
                  aria-label="Sound volume"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={settings.volume}
                  onChange={(e) =>
                    updateSettings({ volume: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Window layout
                <select
                  value={settings.preset}
                  onChange={(e) =>
                    updateSettings({
                      preset: e.target.value as Settings["preset"],
                    })
                  }
                >
                  <option value="compact">Compact · 420 × 240</option>
                  <option value="expanded">Expanded · 720 × 405</option>
                  <option value="capture">Capture · 1280 × 720</option>
                </select>
              </label>
              <button
                disabled={!native}
                onClick={() =>
                  command("reset_window_position").catch((e) =>
                    setError(String(e)),
                  )
                }
              >
                Reset window position
              </button>
              <p className="fine-print">
                Space: pause · M: sound · D: restart demo · C: capture
                <br />
                Shift+R: reset window position · Escape: close panel
              </p>
              <p className="fine-print">
                Capture adjusts the layout for your recorder. It does not record
                or upload. Sound is synthesized locally and starts only when you
                enable it.
              </p>
              <button
                className="text-button"
                onClick={() => setPanel("diagnostics")}
              >
                View local diagnostics <Icon name="arrow" size={14} />
              </button>
            </div>
          )}
        </Dialog>
      )}
    </main>
  );
}
