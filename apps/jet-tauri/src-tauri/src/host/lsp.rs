use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tungstenite::{accept, Error as WebSocketError, Message, WebSocket};

use super::events::emit_host;
use super::launch::uri_to_path;

const MAX_PENDING_SERVER_MESSAGES: usize = 256;

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
        let cmd_name = command.unwrap_or("typescript-language-server");
        let cmd_path = resolve_command_path(cmd_name)?;
        // None → default --stdio (typescript-language-server). Some([]) stays
        // empty — rust-analyzer rejects --stdio ("unexpected flag") and exits.
        let args: Vec<String> = resolve_lsp_args(cmd_args);
        let id = format!(
            "lsp-{}-{}",
            cmd_name,
            chrono::Utc::now().timestamp_millis()
        );
        let cwd = uri_to_path(root_uri);

        // Bind first so a socket error cannot leave an orphaned language server.
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();

        let mut child = Command::new(&cmd_path)
            .args(&args)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("failed to spawn {cmd_name}: {err}"))?;

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
            let mut killed_by_host = false;
            let mut process_exited = false;
            loop {
                if shutdown_wait.load(Ordering::Acquire) {
                    if let Ok(mut guard) = child_wait.lock() {
                        if let Some(mut child) = guard.take() {
                            // Bridge may set shutdown after stdout EOF (process
                            // already dead). Detect that so we still emit crash.
                            match child.try_wait() {
                                Ok(Some(_)) => process_exited = true,
                                _ => {
                                    let _ = child.kill();
                                    let _ = child.wait();
                                    killed_by_host = true;
                                }
                            }
                        }
                    }
                    break;
                }
                let exited = child_wait.lock().ok().and_then(|mut guard| {
                    let status = guard.as_mut()?.try_wait().ok().flatten()?;
                    guard.take();
                    Some(status.code())
                });
                if exited.is_some() {
                    process_exited = true;
                    // Stop the bridge so it stops accepting clients.
                    shutdown_wait.store(true, Ordering::Release);
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
            if let Ok(mut sessions) = sessions_wait.lock() {
                sessions.remove(&id_exit);
            }
            if should_emit_crash(
                explicit_stop_wait.load(Ordering::Acquire),
                killed_by_host,
                process_exited,
            ) {
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

/// Crash toast only for unexpected process death — not host stop, not WS disconnect.
fn should_emit_crash(explicit_stop: bool, killed_by_host: bool, process_exited: bool) -> bool {
    process_exited && !explicit_stop && !killed_by_host
}

/// `None` → default `--stdio` for the builtin tsserver path.
/// `Some([])` stays empty so servers like rust-analyzer (stdio by default, no
/// `--stdio` flag) are not killed by an unexpected CLI flag.
fn resolve_lsp_args(cmd_args: Option<&[String]>) -> Vec<String> {
    match cmd_args {
        Some(args) => args.to_vec(),
        None => vec!["--stdio".to_string()],
    }
}

fn resolve_command_path(cmd: &str) -> Result<PathBuf, String> {
    let as_path = Path::new(cmd);
    if as_path.is_absolute() || cmd.contains('/') || cmd.contains('\\') {
        if as_path.is_file() {
            return Ok(as_path.to_path_buf());
        }
        return Err(format!("{cmd} not found"));
    }

    let path_env = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_env) {
        let candidate = dir.join(cmd);
        if is_executable_candidate(&candidate) {
            return Ok(candidate);
        }
        #[cfg(target_os = "windows")]
        {
            for ext in ["exe", "cmd", "bat", "com"] {
                let with_ext = dir.join(format!("{cmd}.{ext}"));
                if is_executable_candidate(&with_ext) {
                    return Ok(with_ext);
                }
            }
        }
    }
    Err(format!("{cmd} not found on PATH"))
}

fn is_executable_candidate(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

const LSP_IDLE_TIMEOUT: Duration = Duration::from_millis(50);

fn accept_client(listener: &TcpListener, shutdown: &AtomicBool) -> Option<TcpStream> {
    loop {
        if shutdown.load(Ordering::Acquire) {
            return None;
        }
        match listener.accept() {
            Ok((tcp, _)) => return Some(tcp),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                // Listener stays nonblocking so shutdown can be observed; wake sparsely.
                thread::sleep(LSP_IDLE_TIMEOUT);
            }
            Err(_) => {
                shutdown.store(true, Ordering::Release);
                return None;
            }
        }
    }
}

fn configure_client_stream(tcp: &TcpStream) -> std::io::Result<()> {
    // Blocking + short timeouts: idle bridge sleeps in the kernel instead of spin-polling.
    tcp.set_nonblocking(false)?;
    tcp.set_read_timeout(Some(LSP_IDLE_TIMEOUT))?;
    tcp.set_write_timeout(Some(LSP_IDLE_TIMEOUT))?;
    Ok(())
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

    // Stdout reader lives for the process lifetime. WS clients reconnect
    // without tearing down the language server.
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
        let Some(tcp) = accept_client(&listener, &shutdown) else {
            return;
        };
        if configure_client_stream(&tcp).is_err() {
            continue;
        }
        let Ok(mut ws) = accept(tcp) else {
            // Bad handshake — keep listening for the next client.
            continue;
        };

        if !serve_websocket_client(
            &mut ws,
            &mut stdin,
            &server_rx,
            &mut pending_server_messages,
            &shutdown,
        ) {
            return;
        }
        // Client disconnected: drop socket and accept again. Do not kill the LS.
    }
}

/// Returns false when the whole bridge should stop (shutdown / dead process).
/// Returns true when only this WS client went away and we should accept again.
fn serve_websocket_client(
    ws: &mut WebSocket<TcpStream>,
    stdin: &mut impl Write,
    server_rx: &mpsc::Receiver<String>,
    pending_server_messages: &mut VecDeque<Message>,
    shutdown: &AtomicBool,
) -> bool {
    while !shutdown.load(Ordering::Acquire) {
        while pending_server_messages.len() < MAX_PENDING_SERVER_MESSAGES {
            match server_rx.try_recv() {
                Ok(json) => {
                    pending_server_messages.push_back(Message::Text(json));
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    // Language server stdout closed — process is gone.
                    shutdown.store(true, Ordering::Release);
                    return false;
                }
            }
        }

        while let Some(message) = pending_server_messages.pop_front() {
            match ws.write(message) {
                Ok(()) => {}
                Err(WebSocketError::WriteBufferFull(message)) => {
                    pending_server_messages.push_front(message);
                    break;
                }
                Err(WebSocketError::Io(err))
                    if matches!(
                        err.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    break;
                }
                Err(_) => {
                    // Transport lost — keep pending messages for the next client.
                    return true;
                }
            }
        }
        match ws.flush() {
            Ok(()) => {}
            Err(WebSocketError::Io(err))
                if matches!(
                    err.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => return true,
        }

        match ws.read() {
            Ok(Message::Text(json)) => {
                if stdin
                    .write_all(encode_lsp_message(&json).as_bytes())
                    .and_then(|_| stdin.flush())
                    .is_err()
                {
                    shutdown.store(true, Ordering::Release);
                    return false;
                }
            }
            Ok(Message::Close(_)) => return true,
            Ok(_) => {}
            Err(WebSocketError::Io(err))
                if matches!(
                    err.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                // Idle: kernel waited up to LSP_IDLE_TIMEOUT; loop to drain stdout / check shutdown.
            }
            Err(_) => return true,
        }
    }
    false
}

struct LspDecoder {
    buffer: Vec<u8>,
    offset: usize,
}

impl LspDecoder {
    fn new() -> Self {
        Self {
            buffer: Vec::new(),
            offset: 0,
        }
    }

    fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();
        loop {
            let unread = &self.buffer[self.offset..];
            let header_end = unread.windows(4).position(|w| w == b"\r\n\r\n");
            let Some(header_end) = header_end else {
                break;
            };
            let header_start = self.offset;
            let header_end = header_start + header_end;
            let header = String::from_utf8_lossy(&self.buffer[header_start..header_end]);
            let Some(len_str) = header.lines().find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("Content-Length")
                    .then(|| value.trim())
            }) else {
                self.offset = header_end + 4;
                continue;
            };
            let Ok(length) = len_str.parse::<usize>() else {
                self.offset = header_end + 4;
                continue;
            };
            let body_start = header_end + 4;
            if self.buffer.len() < body_start + length {
                break;
            }
            let body =
                String::from_utf8_lossy(&self.buffer[body_start..body_start + length]).into_owned();
            messages.push(body);
            self.offset = body_start + length;
        }
        if self.offset > 64 * 1024 || self.offset * 2 > self.buffer.len() {
            self.buffer.drain(..self.offset);
            self.offset = 0;
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
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

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
    fn crash_only_for_unexpected_process_death() {
        // Unexpected exit → crash toast.
        assert!(should_emit_crash(false, false, true));
        // Explicit stop → no crash.
        assert!(!should_emit_crash(true, false, true));
        assert!(!should_emit_crash(true, true, false));
        // Host killed after WS/bridge teardown → no crash.
        assert!(!should_emit_crash(false, true, false));
        // Transport loss alone (no process exit) → no crash.
        assert!(!should_emit_crash(false, false, false));
    }

    #[test]
    fn resolve_lsp_args_preserves_empty_for_rust_analyzer() {
        assert_eq!(resolve_lsp_args(None), vec!["--stdio".to_string()]);
        assert!(resolve_lsp_args(Some(&[])).is_empty());
        assert_eq!(
            resolve_lsp_args(Some(&[String::from("serve")])),
            vec!["serve".to_string()]
        );
    }

    #[test]
    fn resolve_command_path_finds_executable_on_path() {
        let dir = std::env::temp_dir().join(format!(
            "jet-lsp-resolve-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("jet-fake-lsp");
        fs::write(&bin, b"#!/bin/sh\nexit 0\n").unwrap();
        let mut perms = fs::metadata(&bin).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bin, perms).unwrap();

        let prev = std::env::var_os("PATH");
        let mut paths = vec![dir.clone()];
        if let Some(ref p) = prev {
            paths.extend(std::env::split_paths(p));
        }
        std::env::set_var("PATH", std::env::join_paths(&paths).unwrap());

        let resolved = resolve_command_path("jet-fake-lsp").unwrap();
        assert_eq!(resolved, bin);

        if let Some(p) = prev {
            std::env::set_var("PATH", p);
        } else {
            std::env::remove_var("PATH");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_command_path_missing_errors() {
        let err = resolve_command_path("jet-definitely-missing-lsp-bin-xyz").unwrap_err();
        assert!(err.contains("not found on PATH"));
    }

    #[test]
    fn websocket_reconnect_keeps_child_alive() {
        use tungstenite::client::IntoClientRequest;
        use tungstenite::connect;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_bridge = shutdown.clone();

        // Child echoes stdin→stdout (stand-in for an LS).
        let mut child = Command::new("cat")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn cat");
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();

        let bridge = thread::spawn(move || {
            bridge_stdio_to_websocket(listener, stdin, stdout, shutdown_bridge);
        });

        let url = format!("ws://127.0.0.1:{port}");
        let (mut ws1, _) = connect(url.clone().into_client_request().unwrap()).unwrap();
        let framed = encode_lsp_message(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#);
        ws1.send(Message::Text(framed.into())).unwrap();
        thread::sleep(Duration::from_millis(50));
        let _ = ws1.close(None);
        drop(ws1);
        thread::sleep(Duration::from_millis(50));

        // Child must still be alive after first WS disconnect.
        assert!(child.try_wait().unwrap().is_none());

        let (mut ws2, _) = connect(url.into_client_request().unwrap()).unwrap();
        let framed2 = encode_lsp_message(r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#);
        ws2.send(Message::Text(framed2.into())).unwrap();
        let _ = ws2.read();
        let _ = ws2.close(None);

        assert!(child.try_wait().unwrap().is_none());

        shutdown.store(true, Ordering::Release);
        let _ = child.kill();
        let _ = child.wait();
        let _ = bridge.join();
    }
}
