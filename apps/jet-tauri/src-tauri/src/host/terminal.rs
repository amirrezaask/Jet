use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::AppHandle;

use super::events::emit_host;
use super::launch::uri_to_path;

const MAX_TERMINAL_REPLAY: usize = 4 * 1024 * 1024;

struct TerminalEntry {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Box<dyn Write + Send>,
    client_id: String,
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
        let cwd = uri_to_path(cwd_uri);
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell = if let Some(launch) = launch {
            let command = launch
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or("missing command")?;
            let mut cmd = CommandBuilder::new(command);
            if let Some(args) = launch.get("args").and_then(|v| v.as_array()) {
                for arg in args {
                    if let Some(s) = arg.as_str() {
                        cmd.arg(s);
                    }
                }
            }
            cmd.cwd(&cwd);
            cmd
        } else {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
            let mut cmd = CommandBuilder::new(&shell);
            cmd.cwd(&cwd);
            cmd
        };

        let mut child = pair.slave.spawn_command(shell).map_err(|e| e.to_string())?;
        let master = pair.master;
        let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = master.take_writer().map_err(|e| e.to_string())?;
        let master = Arc::new(Mutex::new(master));

        let id = format!(
            "term-{}-{}",
            chrono::Utc::now().timestamp_millis(),
            self.seq.fetch_add(1, Ordering::Relaxed)
        );
        let entry = Arc::new(Mutex::new(TerminalEntry {
            master,
            writer,
            client_id: client_id.to_string(),
            title: None,
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
                        let (seq, should_emit) = {
                            let mut e = entry_reader.lock().unwrap();
                            e.sequence += 1;
                            e.output.push_str(&data);
                            if e.output.len() > MAX_TERMINAL_REPLAY {
                                e.output = e.output[e.output.len() - MAX_TERMINAL_REPLAY..].to_string();
                            }
                            (e.sequence, true)
                        };
                        if should_emit {
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
                    }
                    Err(_) => break,
                }
            }
        });

        let app_exit = app.clone();
        let id_exit = id.clone();
        let entry_exit = entry.clone();
        thread::spawn(move || {
            let exit_code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(1);
            {
                let mut e = entry_exit.lock().unwrap();
                e.status = "exited".to_string();
                e.exit_code = Some(exit_code);
            }
            emit_host(
                &app_exit,
                "terminal:exit",
                vec![Value::String(id_exit.clone()), Value::Number(exit_code.into())],
            );
        });

        self.terminals.lock().unwrap().insert(id.clone(), entry);
        Ok(serde_json::json!({ "id": id }))
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        if let Some(entry) = self.terminals.lock().unwrap().get(id) {
            let mut e = entry.lock().map_err(|e| e.to_string())?;
            e.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
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
        self.terminals.lock().unwrap().remove(id);
        Ok(())
    }
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
            let id = args.first().and_then(|v| v.as_str()).ok_or("missing id")?;
            let data = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            host.write(id, data)?;
            Ok(Value::Null)
        }
        "terminal:resize" => {
            let id = args.first().and_then(|v| v.as_str()).ok_or("missing id")?;
            let cols = args.get(1).and_then(|v| v.as_u64()).unwrap_or(80) as u16;
            let rows = args.get(2).and_then(|v| v.as_u64()).unwrap_or(24) as u16;
            host.resize(id, cols, rows)?;
            Ok(Value::Null)
        }
        "terminal:attach" => {
            let id = args.first().and_then(|v| v.as_str()).ok_or("missing id")?;
            Ok(host.attach(client_id, id)?.unwrap_or(Value::Null))
        }
        "terminal:dispose" => {
            let id = args.first().and_then(|v| v.as_str()).ok_or("missing id")?;
            host.dispose(id)?;
            Ok(Value::Null)
        }
        _ => Err(format!("unknown terminal channel: {channel}")),
    }
}
