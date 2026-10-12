use crate::{
    receiver::{self, ReceiverState},
    sessions::Sessions,
    settings::Settings,
};
use pit_stop_core::security::{self, RuntimeDescriptor};
use std::{
    fs::{File, OpenOptions},
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

pub struct AppState {
    // Keep the same lock inode open for the full runtime; never truncate or unlink it.
    pub _runtime_lock: File,
    pub dir: PathBuf,
    pub settings: Mutex<Settings>,
    pub sessions: Arc<Mutex<Sessions>>,
    pub receiver: ReceiverState,
    pub runtime: Mutex<RuntimeDescriptor>,
    pub shutdown: Mutex<Option<oneshot::Sender<()>>>,
    pub listening: Arc<AtomicBool>,
}

fn acquire_runtime_lock(dir: &Path) -> io::Result<Option<File>> {
    let path = dir.join("runtime.lock");
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Runtime lock must be a regular file",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)?;
    let metadata = std::fs::symlink_metadata(&path)?;
    if !file.metadata()?.is_file() || !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Runtime lock must be a regular file",
        ));
    }
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(error)) => Err(error),
    }
}
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn run() {
    let app = tauri::Builder::default()
        // Register first: secondary launches must exit before receiver/runtime setup.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("local-navigation")
                .on_navigation(|_, url| {
                    crate::navigation::is_local_page(url, cfg!(debug_assertions))
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            crate::commands::get_settings,
            crate::commands::save_settings,
            crate::commands::get_diagnostics,
            crate::commands::preview_integration,
            crate::commands::install_integration,
            crate::commands::uninstall_integration,
            crate::commands::set_window_preset,
            crate::commands::set_always_on_top,
            crate::commands::reset_window_position
        ])
        .setup(|app| {
            let dir = security::data_dir()?;
            std::fs::create_dir_all(&dir)?;
            // The Windows plugin can miss a first instance still creating its hidden window.
            // Hold a separate per-user OS file lock before binding or publishing anything.
            let Some(runtime_lock) = acquire_runtime_lock(&dir).map_err(|error| {
                io::Error::new(
                    error.kind(),
                    format!("Cannot acquire Pit Stop runtime lock: {error}"),
                )
            })?
            else {
                std::process::exit(0);
            };
            let settings = Settings::load(&dir);
            let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
            listener.set_nonblocking(true)?;
            let port = listener.local_addr()?.port();
            let mut bytes = [0u8; 32];
            getrandom::fill(&mut bytes)
                .map_err(|_| std::io::Error::other("Cannot generate local authentication"))?;
            let token = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
            let runtime = RuntimeDescriptor {
                port,
                pid: std::process::id(),
                startup_id: uuid::Uuid::new_v4().to_string(),
                token: token.clone(),
                infer_commands: settings.infer_commands,
            };
            security::write_runtime(&security::runtime_path()?, &runtime)?;
            let (tx, mut rx) = mpsc::channel(512);
            let receiver = ReceiverState::new(token, tx);
            let sessions = Arc::new(Mutex::new(Sessions::default()));
            let (stop_tx, stop_rx) = oneshot::channel();
            let server = receiver::router(receiver.clone());
            let listening = Arc::new(AtomicBool::new(false));
            let listener_state = listening.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(listener) = tokio::net::TcpListener::from_std(listener) {
                    listener_state.store(true, Ordering::Relaxed);
                    let _ = axum::serve(listener, server)
                        .with_graceful_shutdown(async {
                            let _ = stop_rx.await;
                        })
                        .await;
                }
                listener_state.store(false, Ordering::Relaxed);
            });
            let stale_sessions = sessions.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    if let Ok(mut s) = stale_sessions.lock() {
                        s.expire(now_ms());
                    }
                }
            });
            let handle = app.handle().clone();
            let event_sessions = sessions.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    let accepted = event_sessions.lock().ok().and_then(|mut s| s.accept(event));
                    if let Some(event) = accepted {
                        let _ = handle.emit("pit-stop:event", event);
                    }
                }
            });
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(settings.always_on_top);
                if let Some((w, h)) = settings.size {
                    let _ = window.set_size(tauri::PhysicalSize::new(
                        w.clamp(420, 3840),
                        h.clamp(240, 2160),
                    ));
                }
                if let Some((x, y)) = settings.position {
                    let monitors = window.available_monitors().unwrap_or_default();
                    let monitor = monitors
                        .iter()
                        .find(|m| {
                            let p = m.position();
                            let s = m.size();
                            x >= p.x
                                && y >= p.y
                                && x < p.x + s.width as i32
                                && y < p.y + s.height as i32
                        })
                        .or_else(|| monitors.first());
                    if let Some(m) = monitor {
                        let p = m.position();
                        let bounds = m.size();
                        let size = window.outer_size()?;
                        let width = size.width.min(bounds.width);
                        let height = size.height.min(bounds.height);
                        if width != size.width || height != size.height {
                            let _ = window.set_size(tauri::PhysicalSize::new(width, height));
                        }
                        let nx = x.clamp(p.x, p.x + (bounds.width - width) as i32);
                        let ny = y.clamp(p.y, p.y + (bounds.height - height) as i32);
                        let _ = window.set_position(tauri::PhysicalPosition::new(nx, ny));
                    } else {
                        let _ = window.center();
                    }
                }
            }
            app.manage(AppState {
                _runtime_lock: runtime_lock,
                dir,
                settings: Mutex::new(settings),
                sessions,
                receiver,
                runtime: Mutex::new(runtime),
                shutdown: Mutex::new(Some(stop_tx)),
                listening,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            let Some(state) = window.try_state::<AppState>() else {
                return;
            };
            if let Ok(mut settings) = state.settings.lock() {
                match event {
                    tauri::WindowEvent::Moved(position) => {
                        settings.position = Some((position.x, position.y));
                    }
                    tauri::WindowEvent::Resized(size) if size.width > 0 && size.height > 0 => {
                        settings.size = Some((size.width, size.height));
                    }
                    _ => {}
                }
            };
        })
        .build(tauri::generate_context!())
        .expect("Pit Stop could not initialize its local desktop runtime");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = handle.state::<AppState>();
            if let Ok(settings) = state.settings.lock() {
                let _ = settings.save(&state.dir);
            }
            if let Ok(mut stop) = state.shutdown.lock() {
                if let Some(tx) = stop.take() {
                    let _ = tx.send(());
                }
            }
            if let Ok(runtime) = state.runtime.lock() {
                if let Ok(path) = security::runtime_path() {
                    let _ = security::remove_runtime(&path, &runtime.startup_id);
                }
            };
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_lock_contends_without_truncation_and_reacquires_after_drop() {
        let dir = std::env::temp_dir().join(format!("pit-stop-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("runtime.lock");
        std::fs::write(&path, b"must remain unchanged").unwrap();
        let first = acquire_runtime_lock(&dir).unwrap().unwrap();
        assert!(acquire_runtime_lock(&dir).unwrap().is_none());
        drop(first);
        let third = acquire_runtime_lock(&dir).unwrap().unwrap();
        drop(third);
        assert_eq!(std::fs::read(&path).unwrap(), b"must remain unchanged");
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn runtime_lock_rejects_nonregular_path() {
        let dir = std::env::temp_dir().join(format!("pit-stop-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("runtime.lock");
        std::fs::create_dir(&path).unwrap();
        assert_eq!(
            acquire_runtime_lock(&dir).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
        std::fs::remove_dir(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
