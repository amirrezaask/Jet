use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::AppHandle;

use super::events::emit_host;
use super::launch::uri_to_path;

const MAX_TERMINAL_REPLAY: usize = 4 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 1024 * 1024;

struct ShellSpec {
    file: String,
    args: Vec<String>,
}

struct TerminalEntry {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Box<dyn Write + Send>,
    killer: Option<Box<dyn ChildKiller + Send + Sync>>,
    client_id: String,
    cwd: String,
    shell_title_base: Option<String>,
    shell_title_index: Option<u32>,
    title: Option<String>,
    status: String,
    exit_code: Option<i32>,
    signal: Option<i32>,
    output: String,
    sequence: u64,
}

pub struct TerminalHost {
    terminals: Mutex<HashMap<String, Arc<Mutex<TerminalEntry>>>>,
    seq: AtomicU64,
}

impl TerminalHost {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            seq: AtomicU64::new(0),
        }
    }

    pub fn create(
        &self,
        app: &AppHandle,
        client_id: &str,
        cwd_uri: &str,
        launch: Option<&Value>,
    ) -> Result<Value, String> {
        if cwd_uri.len() > 32_768 {
            return Err("Invalid terminal working directory".into());
        }

        let launch_cmd = parse_launch(launch)?;
        let cwd = resolve_cwd(cwd_uri);
        let primary = if let Some(ref launch) = launch_cmd {
            ShellSpec {
                file: launch.0.clone(),
                args: launch.1.clone(),
            }
        } else {
            primary_shell()
        };

        let attempts: Vec<ShellSpec> = if launch_cmd.is_some() {
            vec![primary]
        } else {
            let mut list = vec![primary];
            list.extend(fallback_shells(&list[0]));
            list
        };

        let mut last_error = String::new();
        for attempt in &attempts {
            match self.spawn_one(app, client_id, &cwd, attempt, launch_cmd.is_none()) {
                Ok(value) => return Ok(value),
                Err(err) => {
                    last_error = format!("{}: {}", attempt.file, err);
                }
            }
        }
        Err(format!(
            "Failed to spawn shell in {cwd}. Attempts: {last_error}"
        ))
    }

    fn spawn_one(
        &self,
        app: &AppHandle,
        client_id: &str,
        cwd: &str,
        shell: &ShellSpec,
        assign_title: bool,
    ) -> Result<Value, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(&shell.file);
        for arg in &shell.args {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);
        apply_terminal_env(&mut cmd);

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let killer = Some(child.clone_killer());
        let master = pair.master;
        let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = master.take_writer().map_err(|e| e.to_string())?;
        let master = Arc::new(Mutex::new(master));

        let id = format!(
            "term-{}-{}",
            chrono::Utc::now().timestamp_millis(),
            self.seq.fetch_add(1, Ordering::Relaxed) + 1
        );

        let shell_title = if assign_title {
            Some(next_shell_title(&self.terminals, cwd, &shell.file))
        } else {
            None
        };

        let entry = Arc::new(Mutex::new(TerminalEntry {
            master,
            writer,
            killer,
            client_id: client_id.to_string(),
            cwd: cwd.to_string(),
            shell_title_base: shell_title.as_ref().map(|t| t.base.clone()),
            shell_title_index: shell_title.as_ref().map(|t| t.index),
            title: shell_title.as_ref().map(|t| t.title.clone()),
            status: "running".to_string(),
            exit_code: None,
            signal: None,
            output: String::new(),
            sequence: 0,
        }));

        let app_reader = app.clone();
        let id_reader = id.clone();
        let entry_reader = entry.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                        let seq = {
                            let mut e = entry_reader.lock().unwrap();
                            e.sequence += 1;
                            e.output.push_str(&data);
                            trim_terminal_replay(&mut e.output, MAX_TERMINAL_REPLAY);
                            e.sequence
                        };
                        emit_host(
                            &app_reader,
                            "terminal:data",
                            vec![
                                Value::String(id_reader.clone()),
                                Value::String(data),
                                Value::Number(seq.into()),
                            ],
                        );
                    }
                    Err(_) => break,
                }
            }
        });

        let app_exit = app.clone();
        let id_exit = id.clone();
        let entry_exit = entry.clone();
        thread::spawn(move || {
            let status = child.wait().ok();
            let exit_code = status
                .as_ref()
                .map(|s| s.exit_code() as i32)
                .unwrap_or(1);
            // portable-pty ExitStatus does not expose a numeric signal; leave None.
            let signal: Option<i32> = None;
            {
                let mut e = entry_exit.lock().unwrap();
                e.status = "exited".to_string();
                e.exit_code = Some(exit_code);
                e.signal = signal;
                e.killer = None;
            }
            let mut args = vec![
                Value::String(id_exit.clone()),
                Value::Number(exit_code.into()),
            ];
            if let Some(sig) = signal {
                args.push(Value::Number(sig.into()));
            }
            emit_host(&app_exit, "terminal:exit", args);
        });

        self.terminals.lock().unwrap().insert(id.clone(), entry);

        let title = shell_title.map(|t| t.title);
        Ok(serde_json::json!({
            "id": id,
            "title": title,
        }))
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        if id.len() > 256 || data.len() > MAX_WRITE_BYTES {
            return Ok(());
        }
        if let Some(entry) = self.terminals.lock().unwrap().get(id) {
            let mut e = entry.lock().map_err(|e| e.to_string())?;
            e.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
            let _ = e.writer.flush();
        }
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if id.len() > 256 {
            return Ok(());
        }
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        let cols = cols.min(1_000);
        let rows = rows.min(1_000);
        if let Some(entry) = self.terminals.lock().unwrap().get(id) {
            let e = entry.lock().map_err(|e| e.to_string())?;
            e.master
                .lock()
                .map_err(|e| e.to_string())?
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn attach(&self, client_id: &str, id: &str) -> Result<Option<Value>, String> {
        if id.len() > 256 {
            return Ok(None);
        }
        let terminals = self.terminals.lock().map_err(|e| e.to_string())?;
        let Some(entry) = terminals.get(id) else {
            return Ok(None);
        };
        let e = entry.lock().map_err(|e| e.to_string())?;
        if e.client_id != client_id {
            return Ok(None);
        }
        Ok(Some(serde_json::json!({
            "id": id,
            "title": e.title,
            "output": e.output,
            "lastSequence": e.sequence,
            "status": e.status,
            "exitCode": e.exit_code,
            "signal": e.signal,
        })))
    }

    pub fn dispose(&self, id: &str) -> Result<(), String> {
        if id.len() > 256 {
            return Ok(());
        }
        let entry = self.terminals.lock().unwrap().remove(id);
        if let Some(entry) = entry {
            if let Ok(mut e) = entry.lock() {
                if let Some(mut killer) = e.killer.take() {
                    let _ = killer.kill();
                }
            }
        }
        Ok(())
    }

    pub fn dispose_for_client(&self, client_id: &str) {
        let ids: Vec<String> = {
            let terminals = self.terminals.lock().unwrap();
            terminals
                .iter()
                .filter_map(|(id, entry)| {
                    entry
                        .lock()
                        .ok()
                        .filter(|e| e.client_id == client_id)
                        .map(|_| id.clone())
                })
                .collect()
        };
        for id in ids {
            let _ = self.dispose(&id);
        }
    }

    pub fn stop_all(&self) {
        let ids: Vec<String> = self.terminals.lock().unwrap().keys().cloned().collect();
        for id in ids {
            let _ = self.dispose(&id);
        }
    }
}

fn trim_terminal_replay(output: &mut String, max_bytes: usize) {
    if output.len() <= max_bytes {
        return;
    }
    let mut start = output.len() - max_bytes;
    while start < output.len() && !output.is_char_boundary(start) {
        start += 1;
    }
    output.drain(..start);
}

struct ShellTitle {
    base: String,
    index: u32,
    title: String,
}

fn next_shell_title(
    terminals: &Mutex<HashMap<String, Arc<Mutex<TerminalEntry>>>>,
    cwd: &str,
    shell_file: &str,
) -> ShellTitle {
    let base = Path::new(shell_file)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("shell")
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_string();
    let base = if base.is_empty() {
        "shell".to_string()
    } else {
        base
    };

    let mut used: HashSet<u32> = HashSet::new();
    if let Ok(map) = terminals.lock() {
        for entry in map.values() {
            if let Ok(e) = entry.lock() {
                if e.cwd != cwd {
                    continue;
                }
                if e.shell_title_base.as_deref() != Some(base.as_str()) {
                    continue;
                }
                if let Some(index) = e.shell_title_index {
                    used.insert(index);
                }
            }
        }
    }
    let mut index = 1u32;
    while used.contains(&index) {
        index += 1;
    }
    let title = if index == 1 {
        base.clone()
    } else {
        format!("{base} {index}")
    };
    ShellTitle { base, index, title }
}

fn primary_shell() -> ShellSpec {
    if cfg!(windows) {
        let file = std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into());
        return ShellSpec {
            file,
            args: vec![],
        };
    }
    let file = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let args = if file.ends_with("zsh") || file.ends_with("bash") {
        vec!["-il".into()]
    } else {
        vec![]
    };
    ShellSpec { file, args }
}

fn fallback_shells(primary: &ShellSpec) -> Vec<ShellSpec> {
    if cfg!(windows) {
        return vec![];
    }
    let mut alt = Vec::new();
    if primary.file != "/bin/zsh" {
        alt.push(ShellSpec {
            file: "/bin/zsh".into(),
            args: vec!["-il".into()],
        });
    }
    if primary.file != "/bin/bash" {
        alt.push(ShellSpec {
            file: "/bin/bash".into(),
            args: vec!["-il".into()],
        });
    }
    alt.push(ShellSpec {
        file: "/bin/sh".into(),
        args: vec![],
    });
    alt
}

fn apply_terminal_env(cmd: &mut CommandBuilder) {
    // Match Electron: spread full process.env, then override terminal colors.
    for (key, value) in std::env::vars() {
        cmd.env(key, value);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let home = std::env::var("HOME").unwrap_or_else(|_| {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "/".into())
    });
    cmd.env("HOME", home);
}

fn resolve_cwd(cwd_uri: &str) -> String {
    let path = uri_to_path(cwd_uri);
    if path.is_empty() {
        return home_dir();
    }
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_dir() => path,
        _ => home_dir(),
    }
}

fn home_dir() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/".into())
}

fn parse_launch(launch: Option<&Value>) -> Result<Option<(String, Vec<String>)>, String> {
    let Some(launch) = launch else {
        return Ok(None);
    };
    if launch.is_null() {
        return Ok(None);
    }
    let command = launch
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or("Invalid terminal launch command")?;
    if command.is_empty() || command.len() > 4_096 {
        return Err("Invalid terminal launch command".into());
    }
    let args = if let Some(arr) = launch.get("args") {
        let Some(arr) = arr.as_array() else {
            return Err("Invalid terminal launch command".into());
        };
        let mut out = Vec::with_capacity(arr.len());
        for arg in arr {
            let Some(s) = arg.as_str() else {
                return Err("Invalid terminal launch command".into());
            };
            if s.len() > 8_192 {
                return Err("Invalid terminal launch command".into());
            }
            out.push(s.to_string());
        }
        out
    } else {
        vec![]
    };
    Ok(Some((command.to_string(), args)))
}

pub fn handle(
    host: &TerminalHost,
    app: &AppHandle,
    client_id: &str,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
    match channel {
        "terminal:create" => {
            let cwd_uri = args.first().and_then(|v| v.as_str()).ok_or("missing cwd")?;
            let launch = args.get(1);
            host.create(app, client_id, cwd_uri, launch)
        }
        "terminal:write" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let data = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            host.write(id, data)?;
            Ok(Value::Null)
        }
        "terminal:resize" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let cols = args.get(1).and_then(|v| v.as_u64()).unwrap_or(80) as u16;
            let rows = args.get(2).and_then(|v| v.as_u64()).unwrap_or(24) as u16;
            host.resize(id, cols, rows)?;
            Ok(Value::Null)
        }
        "terminal:attach" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            Ok(host.attach(client_id, id)?.unwrap_or(Value::Null))
        }
        "terminal:dispose" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            host.dispose(id)?;
            Ok(Value::Null)
        }
        _ => Err(format!("unknown terminal channel: {channel}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_shell_uses_login_flags_for_zsh() {
        std::env::set_var("SHELL", "/bin/zsh");
        let shell = primary_shell();
        assert_eq!(shell.file, "/bin/zsh");
        assert_eq!(shell.args, vec!["-il".to_string()]);
    }

    #[test]
    fn next_title_starts_at_one() {
        let map: Mutex<HashMap<String, Arc<Mutex<TerminalEntry>>>> = Mutex::new(HashMap::new());
        let first = next_shell_title(&map, "/tmp", "/bin/zsh");
        assert_eq!(first.title, "zsh");
        assert_eq!(first.index, 1);
    }

    #[test]
    fn parse_launch_rejects_empty_command() {
        let v = serde_json::json!({ "command": "" });
        assert!(parse_launch(Some(&v)).is_err());
    }

    #[test]
    fn parse_launch_accepts_command_and_args() {
        let v = serde_json::json!({ "command": "/bin/sh", "args": ["-c", "echo hi"] });
        let parsed = parse_launch(Some(&v)).unwrap().unwrap();
        assert_eq!(parsed.0, "/bin/sh");
        assert_eq!(parsed.1, vec!["-c".to_string(), "echo hi".to_string()]);
    }

    #[test]
    fn replay_trim_preserves_utf8_boundaries_and_tail() {
        let mut output = format!("{}jet-unicode-tail", "سلام🙂".repeat(128));
        trim_terminal_replay(&mut output, 73);
        assert!(output.len() <= 73);
        assert!(output.ends_with("jet-unicode-tail"));
        assert!(std::str::from_utf8(output.as_bytes()).is_ok());
    }
}
