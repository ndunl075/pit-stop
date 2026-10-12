use super::*;

fn setup(source: &str, content: Option<&str>) -> (tempfile::TempDir, PathBuf, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join(if source == "codex" {
        "config.toml"
    } else {
        "settings.json"
    });
    if let Some(content) = content {
        fs::write(&path, content).unwrap();
    }
    let helper = directory
        .path()
        .join("Équipe O'Brien tools")
        .join("pit-stop-hook.exe");
    (directory, path, helper)
}

#[test]
fn providers_install_idempotently_disconnect_preserving_third_party_and_security() {
    for source in ["claude", "cursor", "codex"] {
        let initial = if source == "codex" {
            "# keep this comment\nmodel = 'my-model'\n[permissions]\nmode = 'safe'\n"
        } else if source == "cursor" {
            r#"{"version":1,"hooks":{"preToolUse":[{"command":"third-party","failClosed":true}]},"security":{"mode":"safe"}}"#
        } else {
            r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"third-party"}]}]},"permissions":{"deny":["secret"]}}"#
        };
        let (directory, path, helper) = setup(source, Some(initial));
        let install = preview(source, &path, &helper, false).unwrap();
        assert!(install.changed);
        let result = apply(
            &install,
            install.before.as_deref(),
            &directory.path().join("backups"),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(result.backup_path.unwrap()).unwrap(),
            initial
        );
        assert!(!preview(source, &path, &helper, false).unwrap().changed);
        assert!(diagnose(source, &path, &helper).unwrap().configured);
        let remove = preview(source, &path, &helper, true).unwrap();
        apply(
            &remove,
            remove.before.as_deref(),
            &directory.path().join("backups"),
        )
        .unwrap();
        let final_text = fs::read_to_string(&path).unwrap();
        if source == "codex" {
            assert_eq!(final_text, initial);
        } else {
            let final_json: Value = serde_json::from_str(&final_text).unwrap();
            let initial_json: Value = serde_json::from_str(initial).unwrap();
            let event = if source == "claude" {
                "PreToolUse"
            } else {
                "preToolUse"
            };
            assert_eq!(final_json["hooks"][event], initial_json["hooks"][event]);
            assert_eq!(final_json["permissions"], initial_json["permissions"]);
            assert_eq!(final_json["security"], initial_json["security"]);
        }
        assert!(!preview(source, &path, &helper, true).unwrap().changed);
        assert!(!diagnose(source, &path, &helper).unwrap().configured);
    }
}

#[test]
fn malformed_configs_are_never_replaced() {
    for (source, contents) in [
        ("claude", "{"),
        ("cursor", "[]"),
        ("cursor", r#"{"version":99}"#),
        ("claude", r#"{"hooks":{"PreToolUse":{}}}"#),
        ("codex", "[broken"),
    ] {
        let (_directory, path, helper) = setup(source, Some(contents));
        assert!(preview(source, &path, &helper, false).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), contents);
    }
}

#[test]
fn rejects_stale_and_wrong_expected_content_without_writes() {
    let (directory, path, helper) = setup("claude", Some("{}"));
    let change = preview("claude", &path, &helper, false).unwrap();
    assert!(matches!(
        apply(&change, None, directory.path()),
        Err(Error::Stale)
    ));
    fs::write(&path, "{\"new\":true}").unwrap();
    assert!(matches!(
        apply(&change, Some("{}"), directory.path()),
        Err(Error::Stale)
    ));
    assert_eq!(fs::read_to_string(path).unwrap(), "{\"new\":true}");
}

#[test]
fn existing_codex_notifier_never_overwritten_or_removed() {
    let (_directory, path, helper) = setup("codex", Some("notify = ['another-notifier']\n"));
    assert!(matches!(
        preview("codex", &path, &helper, false),
        Err(Error::ExistingNotifier)
    ));
    assert!(!preview("codex", &path, &helper, true).unwrap().changed);
}

#[test]
fn codex_invokes_notify_subcommand_with_literal_argument_vector() {
    let (_directory, path, helper) = setup("codex", None);
    let install = preview("codex", &path, &helper, false).unwrap();
    let document = install.after.parse::<toml_edit::DocumentMut>().unwrap();
    let arguments: Vec<&str> = document["notify"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap())
        .collect();
    assert_eq!(
        arguments,
        vec![helper.to_str().unwrap(), "notify", "--source", "codex"]
    );
}

#[test]
fn absent_config_dry_run_writes_nothing_and_creates_no_backup() {
    for source in ["claude", "cursor", "codex"] {
        let (directory, path, helper) = setup(source, None);
        assert!(!preview(source, &path, &helper, true).unwrap().changed);
        let change = preview(source, &path, &helper, false).unwrap();
        assert!(!path.exists());
        let result = apply(&change, None, &directory.path().join("backups")).unwrap();
        assert!(result.changed);
        assert!(result.backup_path.is_none());
    }
}

#[test]
fn claude_exec_form_and_cursor_quotes_unicode_spaces_apostrophes() {
    let (_directory, path, helper) = setup("claude", None);
    let change = preview("claude", &path, &helper, false).unwrap();
    let config: Value = serde_json::from_str(&change.after).unwrap();
    let command = &config["hooks"]["PreToolUse"][0]["hooks"][0];
    assert_eq!(command["command"], helper.to_str().unwrap());
    assert_eq!(command["args"], json!(["hook", "--source", "claude"]));
    assert!(command.get("shell").is_none());
    let change = preview("cursor", &path, &helper, false).unwrap();
    let config: Value = serde_json::from_str(&change.after).unwrap();
    let command = &config["hooks"]["preToolUse"][0];
    assert!(command.get("failClosed").is_none());
    let command = command["command"].as_str().unwrap();
    assert!(command.contains("--event preToolUse"));
    assert!(command.contains("Équipe"));
    #[cfg(windows)]
    assert!(command.contains("O'Brien"));
}

#[test]
fn installer_lock_preserves_current_config() {
    let (directory, path, helper) = setup("claude", Some("{}"));
    let change = preview("claude", &path, &helper, false).unwrap();
    fs::write(directory.path().join("settings.json.pit-stop.lock"), "").unwrap();
    assert!(matches!(
        apply(&change, Some("{}"), directory.path()),
        Err(Error::Busy)
    ));
    assert_eq!(fs::read_to_string(path).unwrap(), "{}");
}

#[test]
fn helpers_must_be_absolute_and_sources_known() {
    let (_directory, path, helper) = setup("claude", None);
    assert!(preview("claude", &path, Path::new("relative.exe"), false).is_err());
    assert!(preview("unknown", &path, &helper, false).is_err());
}

#[test]
fn removes_only_own_handler_from_user_extended_claude_group() {
    let (_directory, path, helper) = setup("claude", None);
    let install = preview("claude", &path, &helper, false).unwrap();
    let mut config: Value = serde_json::from_str(&install.after).unwrap();
    config["hooks"]["PreToolUse"][0]["hooks"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"command","command":"third-party"}));
    fs::write(&path, serde_json::to_string(&config).unwrap()).unwrap();
    let disconnect = preview("claude", &path, &helper, true).unwrap();
    let config: Value = serde_json::from_str(&disconnect.after).unwrap();
    assert_eq!(
        config["hooks"]["PreToolUse"][0]["hooks"],
        json!([{"type":"command","command":"third-party"}])
    );
}

#[test]
fn failed_backup_does_not_replace_config_or_leave_installer_lock() {
    let (directory, path, helper) = setup("claude", Some("{}"));
    let change = preview("claude", &path, &helper, false).unwrap();
    let backup_dir = directory.path().join("not-a-directory");
    fs::write(&backup_dir, "occupied").unwrap();
    assert!(apply(&change, Some("{}"), &backup_dir).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "{}");
    assert!(!directory
        .path()
        .join("settings.json.pit-stop.lock")
        .exists());
}

#[cfg(windows)]
#[test]
fn cursor_upgrades_and_disconnects_exact_legacy_launcher_preserving_order() {
    let (_directory, path, helper) = setup("cursor", None);
    let legacy = json!({"command":format!("powershell.exe -NoProfile -NonInteractive -Command \"& '{}' hook --source cursor --event preToolUse\"",helper.to_str().unwrap().replace('\'',"''")),"timeout":1});
    let original = json!({"version":1,"hooks":{"preToolUse":[{"command":"before"},legacy,{"command":"after"}]}});
    fs::write(&path, serde_json::to_string(&original).unwrap()).unwrap();
    let upgraded: Value =
        serde_json::from_str(&preview("cursor", &path, &helper, false).unwrap().after).unwrap();
    assert_eq!(
        upgraded["hooks"]["preToolUse"][0],
        json!({"command":"before"})
    );
    assert_eq!(
        upgraded["hooks"]["preToolUse"][1],
        owned_entry("cursor", helper.to_str().unwrap(), "preToolUse").unwrap()
    );
    assert_eq!(
        upgraded["hooks"]["preToolUse"][2],
        json!({"command":"after"})
    );
    assert_eq!(upgraded["hooks"]["preToolUse"].as_array().unwrap().len(), 3);
    let removed: Value =
        serde_json::from_str(&preview("cursor", &path, &helper, true).unwrap().after).unwrap();
    assert_eq!(
        removed["hooks"]["preToolUse"],
        json!([{"command":"before"},{"command":"after"}])
    );
}

#[cfg(windows)]
#[test]
#[ignore = "set PIT_STOP_TEST_HELPER to a built pit-stop-hook.exe and run --ignored --nocapture"]
fn generated_cursor_launcher_executes_real_helper_with_unicode_spaces_and_apostrophe() {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        time::Instant,
    };
    let source =
        std::env::var_os("PIT_STOP_TEST_HELPER").expect("PIT_STOP_TEST_HELPER is required");
    let (_directory, path, helper) = setup("cursor", None);
    fs::create_dir_all(helper.parent().unwrap()).unwrap();
    fs::copy(source, &helper).unwrap();
    let plan = preview("cursor", &path, &helper, false).unwrap();
    let config: Value = serde_json::from_str(&plan.after).unwrap();
    let command = config["hooks"]["preToolUse"][0]["command"]
        .as_str()
        .unwrap();
    assert!(!command.contains("powershell"));
    let cmd = PathBuf::from(std::env::var_os("SystemRoot").unwrap())
        .join("System32")
        .join("cmd.exe");
    let mut samples = Vec::new();
    for _ in 0..10 {
        let start = Instant::now();
        let mut child = Command::new(&cmd)
            .args(["/d", "/s", "/c"])
            .raw_arg(format!("\"{command}\""))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(b"{malformed")
            .unwrap();
        let result = child.wait_with_output().unwrap();
        samples.push(start.elapsed().as_millis());
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&result.stdout).unwrap(),
            json!({"permission":"allow"})
        );
        assert!(result.stderr.is_empty());
    }
    samples.sort_unstable();
    eprintln!(
        "Generated Cursor command elapsed milliseconds: {samples:?}; p95={}ms",
        samples[9]
    );
}

#[cfg(windows)]
#[test]
fn cursor_rejects_shell_expansion_in_executable_paths() {
    let (_directory, path, helper) = setup("cursor", None);
    for character in ['"', '%', '!', '$', '`'] {
        let hostile = helper
            .parent()
            .unwrap()
            .join(format!("hook{character}evil.exe"));
        assert!(preview("cursor", &path, &hostile, false).is_err());
    }
}
