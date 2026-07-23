//! Short-lived PTY terminals for ACP `terminal/*` client methods.

use super::path_security::canonicalize_under_roots;
use super::types::AcpError;
use agent_client_protocol::schema::v1::{
    CreateTerminalRequest, CreateTerminalResponse, KillTerminalRequest, KillTerminalResponse,
    ReleaseTerminalRequest, ReleaseTerminalResponse, TerminalExitStatus, TerminalId,
    TerminalOutputRequest, TerminalOutputResponse, WaitForTerminalExitRequest,
    WaitForTerminalExitResponse,
};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tokio::sync::Notify;

/// Default retained output when the agent omits `output_byte_limit`.
pub const DEFAULT_OUTPUT_BYTE_LIMIT: usize = 256 * 1024;

struct TerminalEntry {
    session_id: String,
    killer: Option<Box<dyn ChildKiller + Send + Sync>>,
    output: String,
    truncated: bool,
    output_byte_limit: usize,
    exit_status: Option<TerminalExitStatus>,
    exit_notify: Arc<Notify>,
}

#[derive(Clone, Default)]
pub struct TerminalHandler {
    workspace_root: Arc<Mutex<PathBuf>>,
    terminals: Arc<Mutex<HashMap<String, Arc<Mutex<TerminalEntry>>>>>,
    seq: Arc<AtomicU64>,
}

impl TerminalHandler {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: Arc::new(Mutex::new(workspace_root.into())),
            terminals: Arc::new(Mutex::new(HashMap::new())),
            seq: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn set_workspace_root(&self, root: impl Into<PathBuf>) {
        if let Ok(mut guard) = self.workspace_root.lock() {
            *guard = root.into();
        }
    }

    pub fn create(&self, request: CreateTerminalRequest) -> Result<CreateTerminalResponse, AcpError> {
        let root = self
            .workspace_root
            .lock()
            .map_err(|_| AcpError::Io {
                operation: "lock workspace root",
                message: "poisoned".to_string(),
            })?
            .clone();
        let cwd = match request.cwd {
            Some(path) => resolve_cwd(&path, &root)?,
            None => canonicalize_under_roots(&root, std::slice::from_ref(&root))?,
        };
        let limit = request
            .output_byte_limit
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_OUTPUT_BYTE_LIMIT)
            .max(1)
            .min(DEFAULT_OUTPUT_BYTE_LIMIT);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AcpError::Io {
                operation: "open pty",
                message: error.to_string(),
            })?;

        let mut cmd = CommandBuilder::new(&request.command);
        for arg in &request.args {
            cmd.arg(arg);
        }
        for env in &request.env {
            cmd.env(&env.name, &env.value);
        }
        cmd.cwd(&cwd);

        let mut child = pair.slave.spawn_command(cmd).map_err(|error| AcpError::Io {
            operation: "spawn terminal command",
            message: error.to_string(),
        })?;
        let killer = Some(child.clone_killer());
        let mut reader = pair.master.try_clone_reader().map_err(|error| AcpError::Io {
            operation: "clone pty reader",
            message: error.to_string(),
        })?;
        // Keep the master PTY open until the entry is released.
        let _master = Arc::new(Mutex::new(pair.master));

        let id = format!(
            "acp-term-{}-{}",
            self.seq.fetch_add(1, Ordering::Relaxed) + 1,
            uuid::Uuid::new_v4().simple()
        );
        let exit_notify = Arc::new(Notify::new());
        let entry = Arc::new(Mutex::new(TerminalEntry {
            session_id: request.session_id.0.to_string(),
            killer,
            output: String::new(),
            truncated: false,
            output_byte_limit: limit,
            exit_status: None,
            exit_notify: exit_notify.clone(),
        }));

        let reader_entry = entry.clone();
        let master_keepalive = _master.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]);
                        if let Ok(mut guard) = reader_entry.lock() {
                            let limit = guard.output_byte_limit;
                            let TerminalEntry {
                                output,
                                truncated,
                                ..
                            } = &mut *guard;
                            append_bounded(output, truncated, limit, &chunk);
                        }
                    }
                    Err(_) => break,
                }
            }
            drop(master_keepalive);
        });

        let wait_entry = entry.clone();
        thread::spawn(move || {
            let status = child.wait().ok();
            let exit_code = status.map(|s| s.exit_code());
            if let Ok(mut guard) = wait_entry.lock() {
                guard.exit_status = Some(
                    TerminalExitStatus::new().exit_code(exit_code.map(|code| code as u32)),
                );
                guard.killer = None;
                guard.exit_notify.notify_waiters();
            }
        });

        self.terminals
            .lock()
            .map_err(|_| AcpError::Io {
                operation: "lock terminals",
                message: "poisoned".to_string(),
            })?
            .insert(id.clone(), entry);

        Ok(CreateTerminalResponse::new(TerminalId::new(id)))
    }

    pub fn output(
        &self,
        request: TerminalOutputRequest,
    ) -> Result<TerminalOutputResponse, AcpError> {
        let entry = self.get_entry(request.terminal_id.0.as_ref(), request.session_id.0.as_ref())?;
        let guard = entry.lock().map_err(|_| AcpError::Io {
            operation: "lock terminal",
            message: "poisoned".to_string(),
        })?;
        Ok(TerminalOutputResponse::new(guard.output.clone(), guard.truncated)
            .exit_status(guard.exit_status.clone()))
    }

    pub async fn wait_for_exit(
        &self,
        request: WaitForTerminalExitRequest,
    ) -> Result<WaitForTerminalExitResponse, AcpError> {
        let entry = self.get_entry(request.terminal_id.0.as_ref(), request.session_id.0.as_ref())?;
        loop {
            let notify = {
                let guard = entry.lock().map_err(|_| AcpError::Io {
                    operation: "lock terminal",
                    message: "poisoned".to_string(),
                })?;
                if let Some(status) = guard.exit_status.clone() {
                    return Ok(WaitForTerminalExitResponse::new(status));
                }
                guard.exit_notify.clone()
            };
            notify.notified().await;
        }
    }

    pub fn kill(&self, request: KillTerminalRequest) -> Result<KillTerminalResponse, AcpError> {
        let entry = self.get_entry(request.terminal_id.0.as_ref(), request.session_id.0.as_ref())?;
        let mut guard = entry.lock().map_err(|_| AcpError::Io {
            operation: "lock terminal",
            message: "poisoned".to_string(),
        })?;
        if let Some(mut killer) = guard.killer.take() {
            let _ = killer.kill();
        }
        Ok(KillTerminalResponse::new())
    }

    pub fn release(
        &self,
        request: ReleaseTerminalRequest,
    ) -> Result<ReleaseTerminalResponse, AcpError> {
        // Validate session ownership before removing.
        let _ = self.get_entry(request.terminal_id.0.as_ref(), request.session_id.0.as_ref())?;
        let removed = self
            .terminals
            .lock()
            .map_err(|_| AcpError::Io {
                operation: "lock terminals",
                message: "poisoned".to_string(),
            })?
            .remove(request.terminal_id.0.as_ref());
        let Some(entry) = removed else {
            return Err(AcpError::Protocol {
                message: format!("unknown terminal {}", request.terminal_id.0),
            });
        };
        let mut guard = entry.lock().map_err(|_| AcpError::Io {
            operation: "lock terminal",
            message: "poisoned".to_string(),
        })?;
        if let Some(mut killer) = guard.killer.take() {
            let _ = killer.kill();
        }
        Ok(ReleaseTerminalResponse::new())
    }

    pub fn release_all(&self) {
        let ids: Vec<String> = self
            .terminals
            .lock()
            .ok()
            .map(|guard| guard.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            if let Ok(mut terminals) = self.terminals.lock() {
                if let Some(entry) = terminals.remove(&id) {
                    if let Ok(mut guard) = entry.lock() {
                        if let Some(mut killer) = guard.killer.take() {
                            let _ = killer.kill();
                        }
                    }
                }
            }
        }
    }

    fn get_entry(
        &self,
        terminal_id: &str,
        session_id: &str,
    ) -> Result<Arc<Mutex<TerminalEntry>>, AcpError> {
        let terminals = self.terminals.lock().map_err(|_| AcpError::Io {
            operation: "lock terminals",
            message: "poisoned".to_string(),
        })?;
        let entry = terminals
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| AcpError::Protocol {
                message: format!("unknown terminal {terminal_id}"),
            })?;
        let guard = entry.lock().map_err(|_| AcpError::Io {
            operation: "lock terminal",
            message: "poisoned".to_string(),
        })?;
        if guard.session_id != session_id {
            return Err(AcpError::Protocol {
                message: "terminal does not belong to session".to_string(),
            });
        }
        drop(guard);
        Ok(entry)
    }
}

fn resolve_cwd(path: &Path, root: &Path) -> Result<PathBuf, AcpError> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    canonicalize_under_roots(&absolute, std::slice::from_ref(&root.to_path_buf()))
}

fn append_bounded(output: &mut String, truncated: &mut bool, limit: usize, chunk: &str) {
    output.push_str(chunk);
    if output.len() <= limit {
        return;
    }
    *truncated = true;
    let overflow = output.len() - limit;
    let mut drain = overflow;
    while drain < output.len() && !output.is_char_boundary(drain) {
        drain += 1;
    }
    output.drain(..drain.min(output.len()));
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::SessionId;
    use std::time::Duration;
    use tempfile::tempdir;

    #[tokio::test]
    async fn create_wait_output_release_roundtrip() {
        let root = tempdir().expect("tempdir");
        let handler = TerminalHandler::new(root.path());
        let session = SessionId::new("session-1");
        let created = handler
            .create(
                CreateTerminalRequest::new(session.clone(), "/bin/echo")
                    .args(vec!["hi".to_string()])
                    .cwd(root.path().to_path_buf()),
            )
            .expect("create");

        let exit = handler
            .wait_for_exit(WaitForTerminalExitRequest::new(
                session.clone(),
                created.terminal_id.clone(),
            ))
            .await
            .expect("wait");
        assert_eq!(exit.exit_status.exit_code, Some(0));

        let output = handler
            .output(TerminalOutputRequest::new(
                session.clone(),
                created.terminal_id.clone(),
            ))
            .expect("output");
        assert!(
            output.output.contains("hi"),
            "expected hi in {:?}",
            output.output
        );

        handler
            .release(ReleaseTerminalRequest::new(
                session,
                created.terminal_id,
            ))
            .expect("release");
    }

    #[tokio::test]
    async fn kill_then_release() {
        let root = tempdir().expect("tempdir");
        let handler = TerminalHandler::new(root.path());
        let session = SessionId::new("session-2");
        let created = handler
            .create(
                CreateTerminalRequest::new(session.clone(), "/bin/sleep")
                    .args(vec!["30".to_string()])
                    .cwd(root.path().to_path_buf()),
            )
            .expect("create");

        handler
            .kill(KillTerminalRequest::new(
                session.clone(),
                created.terminal_id.clone(),
            ))
            .expect("kill");

        let exit = tokio::time::timeout(
            Duration::from_secs(5),
            handler.wait_for_exit(WaitForTerminalExitRequest::new(
                session.clone(),
                created.terminal_id.clone(),
            )),
        )
        .await
        .expect("wait timed out")
        .expect("wait");
        assert!(exit.exit_status.exit_code.is_some() || exit.exit_status.signal.is_some());

        handler
            .release(ReleaseTerminalRequest::new(session, created.terminal_id))
            .expect("release");
    }

    #[test]
    fn rejects_cwd_outside_workspace() {
        let root = tempdir().expect("root");
        let outside = tempdir().expect("outside");
        let handler = TerminalHandler::new(root.path());
        let error = handler
            .create(
                CreateTerminalRequest::new(SessionId::new("s"), "/bin/echo")
                    .args(vec!["x".to_string()])
                    .cwd(outside.path().to_path_buf()),
            )
            .expect_err("outside cwd");
        assert!(matches!(error, AcpError::PathOutsideAllowedRoots { .. }));
    }

    #[test]
    fn append_bounded_truncates_at_char_boundary() {
        let mut output = String::new();
        let mut truncated = false;
        append_bounded(&mut output, &mut truncated, 4, "abcdef");
        assert!(truncated);
        assert!(output.len() <= 4);
        assert!(output.is_char_boundary(0));
    }
}
