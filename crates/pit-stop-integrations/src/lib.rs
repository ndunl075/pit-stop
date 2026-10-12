//! Reversible, preview-first user-level agent configuration installation.
//! This crate never executes hooks or reads provider transcripts.
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, io::{self, Write}, path::{Path, PathBuf}};
use tempfile::NamedTempFile;
use thiserror::Error;

#[cfg(test)]
mod tests;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("Configuration I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("Invalid configuration: {0}. No changes were made.")]
    Invalid(String),
    #[error("Configuration changed since preview. Refresh the preview before applying.")]
    Stale,
    #[error("Another installer is editing this configuration. Try again after it finishes.")]
    Busy,
    #[error("Codex already has a different notify program. Pit Stop will not replace it. Keep your notifier, or manually remove the top-level notify entry and reconnect. Codex supports only one notify command; automatic chaining is unsupported.")]
    ExistingNotifier,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub source: String,
    pub path: PathBuf,
    pub before: Option<String>,
    pub after: String,
    pub changed: bool,
    pub warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub changed: bool,
    pub backup_path: Option<PathBuf>,
    pub restart_required: bool,
}

pub const CLAUDE_EVENTS: &[&str] = &["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SessionEnd", "SubagentStart", "SubagentStop"];
pub const CURSOR_EVENTS: &[&str] = &["sessionStart", "preToolUse", "postToolUse", "postToolUseFailure", "stop", "sessionEnd", "subagentStart", "subagentStop"];

fn read(path: &Path) -> Result<Option<String>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => return Err(Error::Invalid("configuration must be a regular file, not a link".into())),
        Ok(metadata) if metadata.len() > 4 * 1024 * 1024 => return Err(Error::Invalid("configuration exceeds the 4 MiB safety limit".into())),
        Ok(_) => {},
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    Ok(Some(fs::read_to_string(path)?))
}

fn validate_source(source: &str) -> Result<()> {
    if !matches!(source, "claude" | "cursor" | "codex") {
        return Err(Error::Invalid("unknown integration".into()));
    }
    Ok(())
}

/// Compute a reviewable change without writing anything. Provider versions are
/// deliberately not inferred from the existence of a settings directory.
pub fn preview(source: &str, config_path: &Path, helper_path: &Path, disconnect: bool) -> Result<Preview> {
    validate_source(source)?;
    if !helper_path.is_absolute() {
        return Err(Error::Invalid("helper path must be absolute".into()));
    }
    let helper = helper_path.to_str().ok_or_else(|| Error::Invalid("helper path is not Unicode".into()))?;
    if helper.chars().any(|c| c.is_control()) {
        return Err(Error::Invalid("helper path contains control characters".into()));
    }
    let before = read(config_path)?;
    let after = if source == "codex" {
        codex(before.as_deref().unwrap_or(""), helper, disconnect)?
    } else {
        merge_json(source, before.as_deref().unwrap_or("{}"), helper, disconnect)?
    };
    let changed = before.as_deref().map_or(!disconnect, |text| text != after);
    Ok(Preview {
        source: source.into(), path: config_path.into(), before, after, changed,
        warning: Some(if source == "codex" {
            "Turn completion only. Provider version and live hook compatibility unverified; restart Codex after applying."
        } else if source == "cursor" {
            "Local sessions only. Provider version and live hook compatibility unverified; restart Cursor after applying. Pit Stop never enables failClosed."
        } else {
            "Uses documented command/args exec-form hooks. Provider version and live hook compatibility unverified; restart Claude Code after applying."
        }.into()),
    })
}

/// Cursor only documents a command string. Explicit PowerShell invocation
/// handles Windows executable paths independently of spaces and apostrophes.
fn cursor_command(helper: &str, event: &str) -> Result<String> {
    #[cfg(windows)]
    {
        // Quotes and percent expansion cannot be represented safely through
        // every Windows command-shell layer. Refuse rather than interpolate.
        if helper.contains(['"', '%', '!', '$', '`']) {
            return Err(Error::Invalid("Cursor helper path contains unsupported shell characters; install Pit Stop in a simple per-user path".into()));
        }
        Ok(format!("powershell.exe -NoProfile -NonInteractive -Command \"& '{}' hook --source cursor --event {}\"", helper.replace('\'', "''"), event))
    }
    #[cfg(not(windows))]
    {
        Ok(format!("'{}' hook --source cursor --event {}", helper.replace('\'', "'\\''"), event))
    }
}

fn owned_entry(source: &str, helper: &str, event: &str) -> Result<Value> {
    if source == "claude" {
        // Exec form: paths are literal executable paths, never shell input.
        Ok(json!({"matcher":".*", "hooks":[{"type":"command", "command":helper, "args":["hook", "--source", "claude"], "timeout":1}]}))
    } else {
        Ok(json!({"command":cursor_command(helper, event)?, "timeout":1}))
    }
}

fn merge_json(source: &str, input: &str, helper: &str, disconnect: bool) -> Result<String> {
    let mut value: Value = serde_json::from_str(input).map_err(|_| Error::Invalid("malformed JSON".into()))?;
    let original = value.clone();
    let root = value.as_object_mut().ok_or_else(|| Error::Invalid("JSON root must be an object".into()))?;
    if source == "cursor" {
        if let Some(version) = root.get("version") {
            if version.as_u64() != Some(1) { return Err(Error::Invalid("unsupported Cursor hook schema version (expected 1)".into())); }
        } else if !disconnect { root.insert("version".into(), json!(1)); }
    }
    if disconnect && !root.contains_key("hooks") { return Ok(input.into()); }
    let hooks = root.entry("hooks").or_insert_with(|| json!({})).as_object_mut()
        .ok_or_else(|| Error::Invalid("hooks must be an object".into()))?;
    let events = if source == "claude" { CLAUDE_EVENTS } else { CURSOR_EVENTS };
    for event in events {
        if disconnect && !hooks.contains_key(*event) { continue; }
        let array = hooks.entry(*event).or_insert_with(|| json!([])).as_array_mut()
            .ok_or_else(|| Error::Invalid(format!("{event} hooks must be an array")))?;
        let entry = owned_entry(source, helper, event)?;
        if disconnect {
            array.retain(|existing| existing != &entry);
            // If a user added a third-party handler to one of our matcher
            // groups, remove our exact handler and keep their group intact.
            if source == "claude" {
                for group in array.iter_mut() {
                    if group.get("matcher").and_then(Value::as_str) == Some(".*") {
                        if let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                            handlers.retain(|handler| handler != &entry["hooks"][0]);
                        }
                    }
                }
            }
        }
        else if !array.contains(&entry) { array.push(entry); }
    }
    if value == original { return Ok(input.into()); }
    let mut output = serde_json::to_string_pretty(&value).map_err(|_| Error::Invalid("JSON serialization failed".into()))?;
    output.push('\n');
    Ok(output)
}

fn codex(input: &str, helper: &str, disconnect: bool) -> Result<String> {
    let mut document = input.parse::<toml_edit::DocumentMut>().map_err(|_| Error::Invalid("malformed TOML".into()))?;
    let expected = [helper, "notify", "--source", "codex"];
    let existing = document.get("notify");
    let owned = existing.and_then(|item| item.as_array()).is_some_and(|array| {
        array.len() == expected.len() && array.iter().zip(expected).all(|(value, expected)| value.as_str() == Some(expected))
    });
    if disconnect {
        if owned { document.remove("notify"); } else { return Ok(input.into()); }
    } else if owned { return Ok(input.into()); }
    else if existing.is_some() { return Err(Error::ExistingNotifier); }
    else {
        let mut array = toml_edit::Array::new();
        for argument in expected { array.push(argument); }
        document["notify"] = toml_edit::value(array);
    }
    Ok(document.to_string())
}

struct Lock(PathBuf);
impl Drop for Lock { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }

/// Apply only a backend-held preview after explicit user consent. Do not accept
/// arbitrary frontend-deserialized Preview values. expected_content must equal
/// the preview's before value, including None for a new configuration.
pub fn apply(preview: &Preview, expected_content: Option<&str>, backup_dir: &Path) -> Result<ApplyResult> {
    validate_source(&preview.source)?;
    if expected_content != preview.before.as_deref() { return Err(Error::Stale); }
    let parent = preview.path.parent().ok_or_else(|| Error::Invalid("configuration has no parent".into()))?;
    if read(&preview.path)? != preview.before { return Err(Error::Stale); }
    if !preview.changed { return Ok(ApplyResult { changed:false, backup_path:None, restart_required:false }); }
    fs::create_dir_all(parent)?;
    let lock_path = parent.join(format!("{}.pit-stop.lock", preview.path.file_name().unwrap_or_default().to_string_lossy()));
    let _lock = match fs::OpenOptions::new().write(true).create_new(true).open(&lock_path) {
        Ok(_) => Lock(lock_path),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Err(Error::Busy),
        Err(error) => return Err(error.into()),
    };
    if read(&preview.path)? != preview.before { return Err(Error::Stale); }
    let mut replacement = NamedTempFile::new_in(parent)?;
    replacement.write_all(preview.after.as_bytes())?;
    if preview.before.is_some() { fs::set_permissions(replacement.path(), fs::metadata(&preview.path)?.permissions())?; }
    replacement.as_file().sync_all()?;
    let backup_path = if let Some(before) = &preview.before {
        fs::create_dir_all(backup_dir)?;
        let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        let mut backup = tempfile::Builder::new().prefix(&format!("{}-{timestamp}-", preview.source)).suffix(".bak").tempfile_in(backup_dir)?;
        backup.write_all(before.as_bytes())?;
        backup.as_file().sync_all()?;
        Some(backup.keep().map_err(|error| error.error)?.1)
    } else { None };
    if read(&preview.path)? != preview.before { return Err(Error::Stale); }
    atomic_replace(replacement, &preview.path)?;
    Ok(ApplyResult { changed:true, backup_path, restart_required:true })
}

fn atomic_replace(file: NamedTempFile, target: &Path) -> Result<()> {
    #[cfg(not(windows))]
    { file.persist(target).map_err(|error| error.error)?; }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
        let source: Vec<u16> = file.path().as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        // Same-directory staging keeps replacement on the same filesystem.
        if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) } == 0 {
            return Err(io::Error::last_os_error().into());
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub source: String,
    pub config_path: PathBuf,
    pub config_exists: bool,
    pub helper_exists: bool,
    pub configured: bool,
    pub support: String,
    pub compatibility: String,
    pub restart_required: bool,
    pub remote_supported: bool,
}

pub fn diagnose(source: &str, config_path: &Path, helper_path: &Path) -> Result<Diagnostic> {
    let inspection = preview(source, config_path, helper_path, true)?;
    Ok(Diagnostic {
        source:source.into(), config_path:config_path.into(), config_exists:inspection.before.is_some(),
        helper_exists:helper_path.is_file(), configured:inspection.changed,
        support:if source == "codex" { "Turn completion only" } else { "Tool-level events (local sessions)" }.into(),
        compatibility:"Documented schema; installed provider version and real-session behavior unverified".into(),
        restart_required:inspection.changed, remote_supported:false,
    })
}
