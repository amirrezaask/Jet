use serde_json::Value;
use std::process::{Command, Stdio};

use super::uri::file_uri_to_path;

/// Detached launch of an external editor / terminal at a project folder.
pub fn open_in_app(app_id: &str, root_uri: &str) -> Result<(), String> {
    let path = file_uri_to_path(root_uri);
    if path.is_empty() {
        return Err("missing path".into());
    }
    if !std::path::Path::new(&path).exists() {
        return Err(format!("path does not exist: {path}"));
    }

    match app_id {
        "vscode" => {
            try_cmds(&[&["code", "-n", &path], &["code.cmd", "-n", &path]])
                .or_else(|_| open_macos_app("Visual Studio Code", &path))
        }
        "cursor" => {
            try_cmds(&[&["cursor", &path], &["cursor.cmd", &path]])
                .or_else(|_| open_macos_app("Cursor", &path))
        }
        "emacs" => {
            try_cmds(&[&["emacs", &path], &["emacsclient", "-n", "-a", "", &path]])
                .or_else(|_| open_macos_app("Emacs", &path))
        }
        "sublime" => {
            try_cmds(&[&["subl", &path], &["subl.exe", &path]])
                .or_else(|_| open_macos_app("Sublime Text", &path))
        }
        "zed" => {
            try_cmds(&[&["zed", &path], &["zed.exe", &path]])
                .or_else(|_| open_macos_app("Zed", &path))
        }
        "finder" => {
            // `open <dir>` reveals the folder in Finder on macOS.
            if cfg!(target_os = "macos") {
                spawn_detached("open", &[&path])
            } else if cfg!(target_os = "windows") {
                spawn_detached("explorer", &[&path])
            } else {
                try_cmds(&[
                    &["xdg-open", &path],
                    &["nautilus", &path],
                    &["dolphin", &path],
                ])
            }
        }
        "terminal" => {
            if cfg!(target_os = "macos") {
                open_macos_app("Terminal", &path)
            } else if cfg!(target_os = "windows") {
                spawn_detached("cmd", &["/c", "start", "cmd", "/k", "cd", "/d", &path])
            } else {
                try_cmds(&[
                    &["x-terminal-emulator", "--working-directory", &path],
                    &["gnome-terminal", "--working-directory", &path],
                    &["konsole", "--workdir", &path],
                ])
            }
        }
        "kitty" => {
            try_cmds(&[
                &["kitty", "--directory", &path],
                &["kitty", "--single-instance", "--directory", &path],
            ])
            .or_else(|_| open_macos_app("kitty", &path))
        }
        "ghostty" => {
            let working = format!("--working-directory={path}");
            try_cmds(&[
                &["ghostty", working.as_str()],
                &["open", "-na", "Ghostty", "--args", working.as_str()],
            ])
            .or_else(|_| open_macos_app("Ghostty", &path))
        }
        "xcode" => {
            try_cmds(&[&["xed", &path]])
                .or_else(|_| open_macos_app("Xcode", &path))
        }
        "intellij" => {
            try_cmds(&[
                &["idea", &path],
                &["idea64", &path],
                &["intellij-idea-ultimate", &path],
                &["intellij-idea-community", &path],
            ])
            .or_else(|_| open_macos_app("IntelliJ IDEA", &path))
            .or_else(|_| open_macos_app("IntelliJ IDEA CE", &path))
        }
        other => Err(format!("unknown app: {other}")),
    }
}

fn try_cmds(attempts: &[&[&str]]) -> Result<(), String> {
    let mut last_err = String::from("no command succeeded");
    for attempt in attempts {
        if attempt.is_empty() {
            continue;
        }
        let (cmd, args) = attempt.split_first().unwrap();
        if *cmd == "open" && !cfg!(target_os = "macos") {
            continue;
        }
        if (*cmd == "code.cmd" || *cmd == "subl.exe" || *cmd == "cursor.cmd" || *cmd == "zed.exe")
            && !cfg!(windows)
        {
            continue;
        }
        match spawn_detached(cmd, args) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

fn open_macos_app(app_name: &str, path: &str) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err(format!("{app_name} CLI not found"));
    }
    spawn_detached("open", &["-a", app_name, path])
}

fn spawn_detached(program: &str, args: &[&str]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to launch {program}: {e}"))
}

pub fn handle(channel: &str, args: &[Value]) -> Result<Value, String> {
    match channel {
        "shell:openInApp" => {
            let app_id = args
                .first()
                .and_then(|v| v.as_str())
                .ok_or("missing appId")?;
            let root_uri = args
                .get(1)
                .and_then(|v| v.as_str())
                .ok_or("missing rootUri")?;
            open_in_app(app_id, root_uri)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        _ => Err(format!("unknown shell channel: {channel}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_app() {
        let err = open_in_app("nope", "file:///tmp").unwrap_err();
        assert!(err.contains("unknown app"));
    }
}
