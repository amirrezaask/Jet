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
            try_cmds(&[
                &["code", "-n", &path],
                &["code.cmd", "-n", &path],
            ])
            .or_else(|_| open_macos_app("Visual Studio Code", &path))
        }
        "sublime" => {
            try_cmds(&[&["subl", &path], &["subl.exe", &path]])
                .or_else(|_| open_macos_app("Sublime Text", &path))
        }
        "cursor" => {
            try_cmds(&[&["cursor", &path], &["cursor.cmd", &path]])
                .or_else(|_| open_macos_app("Cursor", &path))
        }
        "ghostty" => {
            let working = format!("--working-directory={path}");
            try_cmds(&[
                &["ghostty", working.as_str()],
                &["open", "-na", "Ghostty", "--args", working.as_str()],
            ])
            .or_else(|_| open_macos_app("Ghostty", &path))
        }
        "kitty" => {
            try_cmds(&[
                &["kitty", "--directory", &path],
                &["kitty", "--single-instance", "--directory", &path],
            ])
            .or_else(|_| open_macos_app("kitty", &path))
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
        if (*cmd == "code.cmd" || *cmd == "subl.exe" || *cmd == "cursor.cmd") && !cfg!(windows) {
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
