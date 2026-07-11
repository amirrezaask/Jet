use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tungstenite::{accept, Error as WebSocketError, Message};

use super::events::emit_host;
use super::launch::uri_to_path;

struct LspSession {
    child: Arc<Mutex<Option<Child>>>,
    shutdown: Arc<AtomicBool>,
    explicit_stop: Arc<AtomicBool>,
}

pub struct LspHost {
    sessions: Arc<Mutex<HashMap<String, LspSession>>>,
}

impl LspHost {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
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

        // Bind first so a socket error cannot leave an orphaned language server.
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();

        let mut child = match Command::new(cmd)
            .args(&args)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                // Match Electron: notify renderer so it can retry on focus.
                emit_host(app, "lsp:crashed", vec![Value::String(id.clone())]);
                return Err(err.to_string());
            }
        };

        let stdin = child.stdin.take().ok_or("failed to open lsp stdin")?;
        let stdout = child.stdout.take().ok_or("failed to open lsp stdout")?;

        let child_slot = Arc::new(Mutex::new(Some(child)));
        let shutdown = Arc::new(AtomicBool::new(false));
        let explicit_stop = Arc::new(AtomicBool::new(false));
        let shutdown_bridge = shutdown.clone();

        thread::spawn(move || {
            bridge_stdio_to_websocket(listener, stdin, stdout, shutdown_bridge);
        });

        let app_exit = app.clone();
        let id_exit = id.clone();
        let child_wait = child_slot.clone();
        let shutdown_wait = shutdown.clone();
        let explicit_stop_wait = explicit_stop.clone();
        let sessions_wait = self.sessions.clone();
        thread::spawn(move || {
            let mut exit_code = None;
            loop {
                if shutdown_wait.load(Ordering::Acquire) {
                    if let Ok(mut guard) = child_wait.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                    break;
                }
                let exited = child_wait.lock().ok().and_then(|mut guard| {
                    let status = guard.as_mut()?.try_wait().ok().flatten()?;
                    guard.take();
                    Some(status.code())
                });
                if let Some(code) = exited {
                    exit_code = code;
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
            if let Ok(mut sessions) = sessions_wait.lock() {
                sessions.remove(&id_exit);
            }
            if should_emit_crash(explicit_stop_wait.load(Ordering::Acquire), exit_code) {
                emit_host(&app_exit, "lsp:crashed", vec![Value::String(id_exit)]);
            }
        });

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(
                id.clone(),
                LspSession {
                    child: child_slot,
                    shutdown: shutdown.clone(),
                    explicit_stop,
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
                session.explicit_stop.store(true, Ordering::Release);
                session.shutdown.store(true, Ordering::Release);
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

    pub fn stop_all(&self) {
        let ids: Vec<String> = self
            .sessions
            .lock()
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            let _ = self.stop(&id);
        }
    }
}

fn should_emit_crash(explicit_stop: bool, _exit_code: Option<i32>) -> bool {
    !explicit_stop
}

fn bridge_stdio_to_websocket(
    listener: TcpListener,
    mut stdin: impl Write + Send + 'static,
    stdout: impl Read + Send + 'static,
    shutdown: Arc<AtomicBool>,
) {
    if listener.set_nonblocking(true).is_err() {
        shutdown.store(true, Ordering::Release);
        return;
    }
    let tcp = loop {
        if shutdown.load(Ordering::Acquire) {
            return;
        }
        match listener.accept() {
            Ok((tcp, _)) => break tcp,
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(2));
            }
            Err(_) => {
                shutdown.store(true, Ordering::Release);
                return;
            }
        }
    };

    let Ok(mut ws) = accept(tcp) else {
        shutdown.store(true, Ordering::Release);
        return;
    };
    if ws.get_mut().set_nonblocking(true).is_err() {
        shutdown.store(true, Ordering::Release);
        return;
    }

    // One thread owns the WebSocket. The stdout reader only decodes frames and
    // feeds a bounded channel, avoiding the old read-lock/write-lock deadlock.
    let (server_tx, server_rx) = mpsc::sync_channel::<String>(256);
    let shutdown_stdout = shutdown.clone();
    thread::spawn(move || {
        let mut stdout = stdout;
        let mut decoder = LspDecoder::new();
        let mut buf = [0u8; 8192];
        while !shutdown_stdout.load(Ordering::Acquire) {
            match stdout.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for message in decoder.feed(&buf[..n]) {
                        if server_tx.send(message).is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });

    let mut pending_server_messages = VecDeque::new();
    while !shutdown.load(Ordering::Acquire) {
        let mut did_work = false;
        loop {
            match server_rx.try_recv() {
                Ok(json) => {
                    did_work = true;
                    pending_server_messages.push_back(Message::Text(json.into()));
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => break,
            }
        }

        while let Some(message) = pending_server_messages.pop_front() {
            match ws.write(message) {
                Ok(()) => did_work = true,
                Err(WebSocketError::WriteBufferFull(message)) => {
                    pending_server_messages.push_front(message);
                    break;
                }
                // Tungstenite retains the frame when the socket temporarily
                // cannot accept more bytes. A later flush completes it.
                Err(WebSocketError::Io(err)) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    break;
                }
                Err(_) => {
                    shutdown.store(true, Ordering::Release);
                    break;
                }
            }
        }
        match ws.flush() {
            Ok(()) => {}
            Err(WebSocketError::Io(err)) if err.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => shutdown.store(true, Ordering::Release),
        }

        match ws.read() {
            Ok(Message::Text(json)) => {
                did_work = true;
                if stdin
                    .write_all(encode_lsp_message(&json).as_bytes())
                    .and_then(|_| stdin.flush())
                    .is_err()
                {
                    shutdown.store(true, Ordering::Release);
                }
            }
            Ok(Message::Close(_)) => shutdown.store(true, Ordering::Release),
            Ok(_) => did_work = true,
            Err(WebSocketError::Io(err)) if err.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => shutdown.store(true, Ordering::Release),
        }

        if !did_work {
            thread::sleep(Duration::from_millis(1));
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
            let Some(len_str) = header.lines().find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("Content-Length")
                    .then(|| value.trim())
            }) else {
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
            let body =
                String::from_utf8_lossy(&self.buffer[body_start..body_start + length]).into_owned();
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
            let root_uri = args
                .first()
                .and_then(|v| v.as_str())
                .ok_or("missing rootUri")?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_uses_utf8_bytes_and_decodes_chunked_messages() {
        let json = r#"{"jsonrpc":"2.0","id":1,"result":"سلام"}"#;
        let framed = encode_lsp_message(json);
        assert!(framed.starts_with(&format!("Content-Length: {}\r\n", json.len())));

        let bytes = framed.as_bytes();
        let mut decoder = LspDecoder::new();
        assert!(decoder.feed(&bytes[..11]).is_empty());
        assert_eq!(decoder.feed(&bytes[11..]), vec![json.to_string()]);
    }

    #[test]
    fn framing_header_is_case_insensitive() {
        let mut decoder = LspDecoder::new();
        assert_eq!(
            decoder.feed(b"content-length: 2\r\n\r\n{}"),
            vec!["{}".to_string()]
        );
    }

    #[test]
    fn unexpected_transport_loss_is_reported_as_a_crash() {
        assert!(should_emit_crash(false, None));
        assert!(should_emit_crash(false, Some(0)));
        assert!(!should_emit_crash(true, None));
    }
}
