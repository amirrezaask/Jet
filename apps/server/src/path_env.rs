//! Lazy login-shell environment for GUI / Tauri launches.
//!
//! macOS apps from Finder / Dock / DMG inherit
//! `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Agent CLIs live on the user's
//! login-shell PATH. Resolve that env asynchronously — never block boot —
//! and expose [`shell_env_status`] so the UI can show a loading switcher
//! until discovery is safe.
//!
//! Test hooks (process env):
//! - `JET_SHELL_ENV_FORCE=1` — always run lazy load (even if PATH looks rich)
//! - `JET_SHELL_ENV_DELAY_MS=<n>` — sleep before applying resolved PATH
//! - `JET_SHELL_ENV_MOCK_PATH=<path>` — use instead of spawning a login shell

use serde_json::json;
use std::env;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::Duration;

use crate::host::events::{emit_host, EventHub};

const STATUS_PENDING: u8 = 0;
const STATUS_LOADING: u8 = 1;
const STATUS_READY: u8 = 2;

static STATUS: AtomicU8 = AtomicU8::new(STATUS_PENDING);
static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellEnvStatus {
    Loading,
    Ready,
}

impl ShellEnvStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Loading => "loading",
            Self::Ready => "ready",
        }
    }
}

pub fn shell_env_status() -> ShellEnvStatus {
    match STATUS.load(Ordering::Acquire) {
        STATUS_LOADING => ShellEnvStatus::Loading,
        // PENDING (never started — unit tests) and READY both expose the catalog.
        _ => ShellEnvStatus::Ready,
    }
}

pub fn shell_env_ready() -> bool {
    shell_env_status() == ShellEnvStatus::Ready
}

/// Kick off login-shell PATH resolution once. Idempotent. Emits
/// `agents:shellEnvReady` when finished (success or fallback).
pub fn begin_shell_env_load(events: EventHub) {
    if STARTED.swap(true, Ordering::AcqRel) {
        return;
    }

    let current = env::var_os("PATH").unwrap_or_default();
    if !needs_login_shell_path(&current) {
        STATUS.store(STATUS_READY, Ordering::Release);
        emit_ready(&events);
        return;
    }

    STATUS.store(STATUS_LOADING, Ordering::Release);
    std::thread::Builder::new()
        .name("jet-shell-env".into())
        .spawn(move || {
            maybe_delay_for_tests();
            if let Some(login_path) = resolve_login_path() {
                apply_path(&merge_login_path(&current, &login_path));
            }
            // Ready even on failure — UI must not spin forever.
            STATUS.store(STATUS_READY, Ordering::Release);
            emit_ready(&events);
        })
        .expect("spawn jet-shell-env thread");
}

/// Reset global shell-env state between tests.
pub fn reset_shell_env_for_tests() {
    STARTED.store(false, Ordering::Release);
    STATUS.store(STATUS_PENDING, Ordering::Release);
}

fn emit_ready(events: &EventHub) {
    emit_host(
        events,
        "agents:shellEnvReady",
        vec![json!({ "status": "ready" })],
    );
}

fn needs_login_shell_path(path: &OsStr) -> bool {
    if cfg!(windows) {
        return false;
    }
    if env::var_os("JET_SHELL_ENV_FORCE").is_some_and(|v| v == "1") {
        return true;
    }
    is_gui_stripped_path(path)
}

fn is_gui_stripped_path(path: &OsStr) -> bool {
    let dirs: Vec<PathBuf> = env::split_paths(path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .collect();
    if dirs.is_empty() {
        return true;
    }
    const SYSTEM: &[&str] = &["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
    dirs.iter().all(|dir| {
        SYSTEM
            .iter()
            .any(|system| dir == Path::new(system) || dir == Path::new(&format!("{system}/")))
    })
}

/// Login-shell PATH first, then any process dirs not already present.
pub fn merge_login_path(current: &OsStr, login: &OsStr) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut push_unique = |path: PathBuf| {
        if path.as_os_str().is_empty() {
            return;
        }
        if !dirs.iter().any(|existing| existing == &path) {
            dirs.push(path);
        }
    };
    for dir in env::split_paths(login) {
        push_unique(dir);
    }
    for dir in env::split_paths(current) {
        push_unique(dir);
    }
    dirs
}

fn apply_path(dirs: &[PathBuf]) {
    if let Ok(joined) = env::join_paths(dirs) {
        #[allow(deprecated)]
        env::set_var("PATH", joined);
    }
}

fn maybe_delay_for_tests() {
    let Ok(raw) = env::var("JET_SHELL_ENV_DELAY_MS") else {
        return;
    };
    let Ok(ms) = raw.parse::<u64>() else {
        return;
    };
    if ms > 0 {
        std::thread::sleep(Duration::from_millis(ms));
    }
}

fn resolve_login_path() -> Option<OsString> {
    if let Ok(mock) = env::var("JET_SHELL_ENV_MOCK_PATH") {
        let trimmed = mock.trim();
        if trimmed.is_empty() {
            return None;
        }
        return Some(OsString::from(trimmed));
    }
    load_login_shell_path()
}

fn load_login_shell_path() -> Option<OsString> {
    let shell = env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/zsh"));
    // Try interactive+login first (loads .zprofile/.zshrc PATH hooks on macOS),
    // then plain login if that fails (some environments hang or reject -i).
    for args in [["-ilc", "printenv PATH"], ["-lc", "printenv PATH"]] {
        if let Some(path) = run_shell_printenv(&shell, &args) {
            return Some(path);
        }
    }
    None
}

fn run_shell_printenv(shell: &OsStr, args: &[&str; 2]) -> Option<OsString> {
    let mut child = Command::new(shell)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                let mut stdout = String::new();
                if let Some(mut out) = child.stdout.take() {
                    use std::io::Read;
                    let _ = out.read_to_string(&mut stdout);
                }
                let trimmed = stdout.trim();
                if trimmed.is_empty() {
                    return None;
                }
                return Some(OsString::from(trimmed));
            }
            Ok(Some(_)) => return None,
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn merge_puts_login_shell_dirs_first() {
        let current = OsString::from("/usr/bin:/bin:/usr/sbin:/sbin");
        let login = OsString::from("/opt/homebrew/bin:/Users/me/.local/bin:/usr/bin:/bin");
        let merged = merge_login_path(&current, &login);
        assert_eq!(merged[0], PathBuf::from("/opt/homebrew/bin"));
        assert_eq!(merged[1], PathBuf::from("/Users/me/.local/bin"));
        assert_eq!(
            merged.iter().filter(|p| *p == Path::new("/usr/bin")).count(),
            1
        );
    }

    #[test]
    fn detects_gui_stripped_path() {
        assert!(is_gui_stripped_path(OsStr::new(
            "/usr/bin:/bin:/usr/sbin:/sbin"
        )));
        assert!(!is_gui_stripped_path(OsStr::new(
            "/opt/homebrew/bin:/usr/bin:/bin"
        )));
        assert!(is_gui_stripped_path(OsStr::new("")));
    }

    #[test]
    fn rich_path_skips_login_shell_unless_forced() {
        let _guard = TEST_LOCK.lock().unwrap();
        let previous_force = env::var_os("JET_SHELL_ENV_FORCE");
        #[allow(deprecated)]
        env::remove_var("JET_SHELL_ENV_FORCE");
        assert!(!needs_login_shell_path(OsStr::new(
            "/opt/homebrew/bin:/usr/bin:/bin"
        )));
        #[allow(deprecated)]
        match previous_force {
            Some(v) => env::set_var("JET_SHELL_ENV_FORCE", v),
            None => env::remove_var("JET_SHELL_ENV_FORCE"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn shell_env_emits_ready_after_mock_path_applied() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_shell_env_for_tests();

        let bin_dir = tempfile::tempdir().expect("bin dir");
        for name in ["codex", "claude", "opencode", "cursor-agent", "grok"] {
            let path = bin_dir.path().join(name);
            std::fs::write(&path, "#!/bin/sh\nexit 0\n").expect("write stub");
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&path).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms).unwrap();
        }

        let mock_path = format!(
            "{}:/usr/bin:/bin:/usr/sbin:/sbin",
            bin_dir.path().display()
        );
        let previous_path = env::var_os("PATH");
        let previous_force = env::var_os("JET_SHELL_ENV_FORCE");
        let previous_delay = env::var_os("JET_SHELL_ENV_DELAY_MS");
        let previous_mock = env::var_os("JET_SHELL_ENV_MOCK_PATH");

        #[allow(deprecated)]
        {
            env::set_var("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
            env::set_var("JET_SHELL_ENV_FORCE", "1");
            env::set_var("JET_SHELL_ENV_DELAY_MS", "250");
            env::set_var("JET_SHELL_ENV_MOCK_PATH", &mock_path);
        }

        let events = EventHub::new(32);
        let mut rx = events.subscribe();
        crate::path_env::begin_shell_env_load(events.clone());

        let deadline = Instant::now() + Duration::from_secs(3);
        let mut saw_ready_event = false;
        while Instant::now() < deadline {
            if let Ok(event) = rx.try_recv() {
                if event.channel == "agents:shellEnvReady" {
                    saw_ready_event = true;
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(saw_ready_event, "must emit agents:shellEnvReady");
        assert_eq!(shell_env_status(), ShellEnvStatus::Ready);

        #[allow(deprecated)]
        {
            match previous_path {
                Some(v) => env::set_var("PATH", v),
                None => env::remove_var("PATH"),
            }
            match previous_force {
                Some(v) => env::set_var("JET_SHELL_ENV_FORCE", v),
                None => env::remove_var("JET_SHELL_ENV_FORCE"),
            }
            match previous_delay {
                Some(v) => env::set_var("JET_SHELL_ENV_DELAY_MS", v),
                None => env::remove_var("JET_SHELL_ENV_DELAY_MS"),
            }
            match previous_mock {
                Some(v) => env::set_var("JET_SHELL_ENV_MOCK_PATH", v),
                None => env::remove_var("JET_SHELL_ENV_MOCK_PATH"),
            }
        }
        reset_shell_env_for_tests();
    }
}
