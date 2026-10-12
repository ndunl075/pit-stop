use crate::{
    app::{now_ms, AppState},
    settings::Settings,
};
use pit_stop_integrations::{self as integrations, Preview};
use std::{path::PathBuf, sync::atomic::Ordering};
use tauri::{Manager, State};

fn config(source: &str) -> Result<PathBuf, String> {
    if source == "codex" {
        if let Some(home) = std::env::var_os("CODEX_HOME") {
            return Ok(PathBuf::from(home).join("config.toml"));
        }
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .ok_or("Cannot find user home")?;
    let relative = match source {
        "claude" => ".claude/settings.json",
        "cursor" => ".cursor/hooks.json",
        "codex" => ".codex/config.toml",
        _ => return Err("Unsupported integration".into()),
    };
    Ok(PathBuf::from(home).join(relative))
}
fn stable_helper(state: &AppState) -> PathBuf {
    state.dir.join("bin").join(if cfg!(windows) {
        "pit-stop-hook.exe"
    } else {
        "pit-stop-hook"
    })
}
fn ensure_helper(app: &tauri::AppHandle, state: &AppState) -> Result<PathBuf, String> {
    let target = stable_helper(state);
    let name = if cfg!(windows) {
        "pit-stop-hook.exe"
    } else {
        "pit-stop-hook"
    };
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|_| "Cannot locate app resources")?
        .join("binaries")
        .join(name);
    let developer = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/debug")
        .join(name);
    let release = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/release")
        .join(name);
    let source = [bundled, release, developer]
        .into_iter()
        .find(|p| p.is_file())
        .ok_or("Hook executable is missing. Build and package pit-stop-hook first.")?;
    std::fs::create_dir_all(target.parent().unwrap())
        .map_err(|_| "Cannot create helper directory")?;
    if std::fs::read(&source).ok() != std::fs::read(&target).ok() {
        let temp = target.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        std::fs::copy(source, &temp).map_err(|_| "Cannot stage helper executable")?;
        std::fs::rename(temp, &target)
            .map_err(|_| "Cannot update helper; retry after active hooks finish")?;
    }
    Ok(target)
}
#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    state
        .settings
        .lock()
        .map(|s| s.clone())
        .map_err(|_| "Preferences unavailable".into())
}
#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    settings.validate()?;
    let mut current = state
        .settings
        .lock()
        .map_err(|_| "Preferences unavailable")?;
    let mut next = settings;
    next.position = current.position;
    next.size = current.size;
    next.save(&state.dir)?;
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.infer_commands = next.infer_commands;
        if let Ok(path) = pit_stop_core::security::runtime_path() {
            pit_stop_core::security::write_runtime(&path, &runtime)
                .map_err(|_| "Cannot update inference preference")?;
        }
    }
    *current = next;
    Ok(())
}
#[tauri::command]
pub fn get_diagnostics(state: State<AppState>) -> Result<serde_json::Value, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Diagnostics unavailable")?;
    sessions.expire(now_ms());
    let integrations = ["claude", "cursor", "codex"]
        .into_iter()
        .map(|source| {
            config(source)
                .and_then(|path| {
                    integrations::diagnose(source, &path, &stable_helper(&state))
                        .map_err(|_| "Configuration could not be inspected".into())
                })
                .ok()
        })
        .collect::<Vec<_>>();
    let rejections = state
        .receiver
        .rejections
        .lock()
        .map(|counts| counts.clone())
        .unwrap_or_default();
    Ok(
        serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"listener_health":if state.listening.load(Ordering::Relaxed){"Listening on local loopback"}else{"Listener unavailable"},"summary":sessions.summary(),"rejected":state.receiver.rejected.load(Ordering::Relaxed),"rejections":rejections,"helper_path":stable_helper(&state),"helper_installed":stable_helper(&state).is_file(),"support":{"claude":"Tool hooks · unverified with real agent","cursor":"Tool hooks · unverified with real agent","codex":"Turn completion only"},"integrations":integrations,"logging":false}),
    )
}
#[tauri::command]
pub fn preview_integration(
    state: State<AppState>,
    source: String,
    disconnect: Option<bool>,
) -> Result<Preview, String> {
    integrations::preview(
        &source,
        &config(&source)?,
        &stable_helper(&state),
        disconnect.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}
fn change(
    app: &tauri::AppHandle,
    state: &AppState,
    source: &str,
    expected: Option<&str>,
    disconnect: bool,
) -> Result<serde_json::Value, String> {
    let helper = if disconnect {
        stable_helper(state)
    } else {
        ensure_helper(app, state)?
    };
    let plan = integrations::preview(source, &config(source)?, &helper, disconnect)
        .map_err(|e| e.to_string())?;
    let result = integrations::apply(&plan, expected, &state.dir.join("backups"))
        .map_err(|e| e.to_string())?;
    let mut response =
        serde_json::to_value(result).map_err(|_| "Cannot encode installation result")?;
    if !disconnect {
        response["transportTest"] = serde_json::json!(test_helper(&helper, state, source));
    }
    Ok(response)
}
fn test_helper(helper: &std::path::Path, state: &AppState, source: &str) -> &'static str {
    use std::{
        io::Write,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let id = uuid::Uuid::new_v4().to_string();
    let (provider, name, payload) = match source {
        "codex" => (
            pit_stop_core::Source::Codex,
            None,
            serde_json::json!({"type":"agent-turn-complete","thread-id":id,"turn-id":id}),
        ),
        "cursor" => (
            pit_stop_core::Source::Cursor,
            Some("sessionStart"),
            serde_json::json!({"conversation_id":id}),
        ),
        _ => (
            pit_stop_core::Source::Claude,
            Some("SessionStart"),
            serde_json::json!({"session_id":id}),
        ),
    };
    let expected = state.runtime.lock().ok().and_then(|runtime| {
        pit_stop_core::normalize(provider, name, &payload, runtime.token.as_bytes())
    });
    let Some(expected) = expected else {
        return "not-received";
    };
    let mut command = Command::new(helper);
    command.stdout(Stdio::null()).stderr(Stdio::null());
    if source == "codex" {
        command.args(["notify", "--source", "codex", &payload.to_string()]);
    } else {
        command
            .args([
                "hook",
                "--source",
                source,
                "--event",
                if source == "cursor" {
                    "sessionStart"
                } else {
                    "SessionStart"
                },
            ])
            .stdin(Stdio::piped());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let Ok(mut child) = command.spawn() else {
        return "helper-unavailable";
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(payload.to_string().as_bytes());
    }
    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        if state
            .sessions
            .lock()
            .map(|s| s.has_session(expected.source, &expected.session_key))
            .unwrap_or(false)
        {
            let _ = child.try_wait();
            return "received";
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return "not-received";
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[tauri::command]
pub fn install_integration(
    app: tauri::AppHandle,
    state: State<AppState>,
    source: String,
    expected_content: Option<String>,
) -> Result<serde_json::Value, String> {
    change(&app, &state, &source, expected_content.as_deref(), false)
}
#[tauri::command]
pub fn uninstall_integration(
    app: tauri::AppHandle,
    state: State<AppState>,
    source: String,
    expected_content: Option<String>,
) -> Result<serde_json::Value, String> {
    change(&app, &state, &source, expected_content.as_deref(), true)
}
#[tauri::command]
pub fn set_window_preset(window: tauri::WebviewWindow, preset: String) -> Result<(), String> {
    let (w, h) = match preset.as_str() {
        "compact" => (420, 240),
        "expanded" => (720, 405),
        "capture" => (1280, 720),
        _ => return Err("Unknown window preset".into()),
    };
    window
        .set_size(tauri::LogicalSize::new(w, h))
        .map_err(|_| "Cannot resize window".into())
}
#[tauri::command]
pub fn set_always_on_top(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|_| "Cannot pin window".into())
}
#[tauri::command]
pub fn reset_window_position(window: tauri::WebviewWindow) -> Result<(), String> {
    window.center().map_err(|_| "Cannot center window".into())
}
