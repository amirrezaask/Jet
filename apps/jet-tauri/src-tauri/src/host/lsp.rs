use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::AppHandle;
use tungstenite::{accept, Message, WebSocket};

use super::events::emit_host;
use super::launch::uri_to_path;

struct LspSession {
    child: Arc<Mutex<Option<Child>>>,
    shutdown: Arc<Mutex<bool>>,
}

pub struct LspHost {
    sessions: Mutex<HashMap<String, LspSession>>,
}

impl LspHost {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(
        &self,
        app: &AppHandle,
        root_uri: &str,
        command: Option<&str>,
        cmd_args: Option<&[String]>,
    ) -> Result<Value, String> {
        let cmd = command.unwrap_or("typescript-language-server");
        let mut args: Vec<String> = cmd_args
            .map(|a| a.to_vec())
            .unwrap_or_else(|| vec!["--stdio".to_string()]);
        if args.is_empty() {
            args.push("--stdio".to_string());
        }
        let id = format!("lsp-{cmd}-{}", chrono::Utc::now().timestamp_millis());
        let cwd = uri_to_path(root_uri);

        let mut child = Command::new(cmd)
            .args(&args)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;

        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();

        let stdin = child.stdin.take().ok_or("failed to open lsp stdin")?;
        let stdout = child.stdout.take().ok_or("failed to open lsp stdout")?;

        let child_slot = Arc::new(Mutex::new(Some(child)));
        let shutdown = Arc::new(Mutex::new(false));
        let shutdown_bridge = shutdown.clone();

        thread::spawn(move || {
            bridge_stdio_to_websocket(listener, stdin, stdout, shutdown_bridge);
        });

        let app_exit = app.clone();
        let id_exit = id.clone();
        let child_wait = child_slot.clone();
        thread::spawn(move || {
            let exit_code = child_wait
                .lock()
                .ok()
                .and_then(|mut guard| guard.take())
                .and_then(|mut c| c.wait().ok())
                .map(|s| s.code())
                .flatten();
            if exit_code.is_some_and(|code| code != 0) {
                emit_host(&app_exit, "lsp:crashed", vec![Value::String(id_exit)]);
            }
        });

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(
                id.clone(),
                LspSession {
                    child: child_slot,
                    shutdown,
                },
            );
        }

        Ok(serde_json::json!({
            "id": id,
            "transportUrl": format!("ws://127.0.0.1:{port}")
        }))
    }

    pub fn stop(&self, id: &str) -> Result<(), String> {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.remove(id) {
                if let Ok(mut flag) = session.shutdown.lock() {
                    *flag = true;
                }
                if let Ok(mut guard) = session.child.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
        Ok(())
    }
}

fn bridge_stdio_to_websocket(
    listener: TcpListener,
    mut stdin: impl Write + Send + 'static,
    stdout: impl Read + Send + 'static,
    shutdown: Arc<Mutex<bool>>,
) {
    let Ok((tcp, _)) = listener.accept() else {
        return;
    };
    if *shutdown.lock().unwrap() {
        return;
    }

    let Ok(ws) = accept(tcp) else {
        return;
    };
    let ws = Arc::new(Mutex::new(ws));

    let ws_out = ws.clone();
    thread::spawn(move || pump_stdout_to_ws(stdout, ws_out, shutdown));

    pump_ws_to_stdin(&mut stdin, ws);
}

fn pump_stdout_to_ws<R: Read + Send>(
    mut stdout: R,
    ws: Arc<Mutex<WebSocket<std::net::TcpStream>>>,
    shutdown: Arc<Mutex<bool>>,
) {
    let mut decoder = LspDecoder::new();
    let mut buf = [0u8; 8192];
    loop {
        if *shutdown.lock().unwrap() {
            break;
        }
        match stdout.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                for msg in decoder.feed(&buf[..n]) {
                    let mut guard = match ws.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    if guard.send(Message::Text(msg.into())).is_err() {
                        return;
                    }
                }
            }
            Err(_) => break,
        }
    }
}

fn pump_ws_to_stdin(
    stdin: &mut impl Write,
    ws: Arc<Mutex<WebSocket<std::net::TcpStream>>>,
) {
    loop {
        let message = {
            let mut guard = match ws.lock() {
                Ok(g) => g,
                Err(_) => break,
            };
            match guard.read() {
                Ok(Message::Text(json)) => Some(json),
                Ok(Message::Close(_)) | Err(_) => None,
                Ok(_) => continue,
            }
        };
        let Some(json) = message else {
            break;
        };
        if stdin
            .write_all(encode_lsp_message(&json).as_bytes())
            .is_err()
        {
            break;
        }
    }
}

struct LspDecoder {
    buffer: Vec<u8>,
}

impl LspDecoder {
    fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();
        loop {
            let header_end = self.buffer.windows(4).position(|w| w == b"\r\n\r\n");
            let Some(header_end) = header_end else {
                break;
            };
            let header = String::from_utf8_lossy(&self.buffer[..header_end]);
            let Some(len_str) = header
                .lines()
                .find_map(|line| line.strip_prefix("Content-Length:").map(str::trim))
            else {
                self.buffer.drain(..header_end + 4);
                continue;
            };
            let Ok(length) = len_str.parse::<usize>() else {
                self.buffer.drain(..header_end + 4);
                continue;
            };
            let body_start = header_end + 4;
            if self.buffer.len() < body_start + length {
                break;
            }
            let body = String::from_utf8_lossy(&self.buffer[body_start..body_start + length])
                .into_owned();
            messages.push(body);
            self.buffer.drain(..body_start + length);
        }
        messages
    }
}

fn encode_lsp_message(json: &str) -> String {
    format!("Content-Length: {}\r\n\r\n{}", json.len(), json)
}

pub fn handle(
    host: &LspHost,
    app: &AppHandle,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
    match channel {
        "lsp:start" => {
            let root_uri = args.first().and_then(|v| v.as_str()).ok_or("missing rootUri")?;
            let command = args.get(2).and_then(|v| v.as_str());
            let cmd_args = args.get(3).and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            });
            host.start(app, root_uri, command, cmd_args.as_deref())
        }
        "lsp:stop" => {
            let id = args.first().and_then(|v| v.as_str()).ok_or("missing id")?;
            host.stop(id)?;
            Ok(Value::Null)
        }
        _ => Err(format!("unknown lsp channel: {channel}")),
    }
}
