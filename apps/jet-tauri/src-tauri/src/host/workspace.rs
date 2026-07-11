use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;

use super::events::emit_host;
use super::git::git_branch;
use super::launch::uri_to_path;
use super::search::{is_git_workspace, warm_search_index};

const WATCH_DEBOUNCE: Duration = Duration::from_millis(300);

const WATCH_IGNORE_SEGMENTS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "dist-electron",
    ".turbo",
    ".pnpm-store",
];

pub struct WorkspaceHost {
    roots: Mutex<HashMap<String, RootState>>,
}

struct RootState {
    gen: u64,
    _watch_stop: Option<Arc<Mutex<bool>>>,
}

impl WorkspaceHost {
    pub fn new() -> Self {
        Self {
            roots: Mutex::new(HashMap::new()),
        }
    }

    pub fn activate(&self, app: &AppHandle, root_uri: &str) -> Result<Value, String> {
        let mut roots = self.roots.lock().map_err(|e| e.to_string())?;
        let gen = if let Some(state) = roots.get_mut(root_uri) {
            state.gen += 1;
            state.gen
        } else {
            let state = RootState {
                gen: 1,
                _watch_stop: None,
            };
            roots.insert(root_uri.to_string(), state);
            1
        };
        drop(roots);

        let app_clone = app.clone();
        let root_uri_owned = root_uri.to_string();
        thread::spawn(move || schedule_background(app_clone, root_uri_owned, gen));
        Ok(serde_json::json!({ "ok": true }))
    }

    pub fn deactivate(&self, root_uri: &str) -> Result<Value, String> {
        let mut roots = self.roots.lock().map_err(|e| e.to_string())?;
        if let Some(mut state) = roots.remove(root_uri) {
            if let Some(stop) = state._watch_stop.take() {
                if let Ok(mut flag) = stop.lock() {
                    *flag = true;
                }
            }
        }
        super::search::dispose_search_index(root_uri);
        Ok(serde_json::json!({ "ok": true }))
    }

    pub fn stop_all(&self) {
        let uris: Vec<String> = self
            .roots
            .lock()
            .map(|r| r.keys().cloned().collect())
            .unwrap_or_default();
        for uri in uris {
            let _ = self.deactivate(&uri);
        }
    }

    pub fn start_watch(&self, app: &AppHandle, root_uri: &str, gen: u64) {
        let root_path = uri_to_path(root_uri);
        let stop = Arc::new(Mutex::new(false));
        {
            let mut roots = self.roots.lock().unwrap();
            if let Some(state) = roots.get_mut(root_uri) {
                if state.gen != gen {
                    return;
                }
                state._watch_stop = Some(stop.clone());
            } else {
                return;
            }
        }

        let app_handle = app.clone();
        thread::spawn(move || {
            // Defer watch start so cold open stays snappy (matches Electron delay).
            thread::sleep(Duration::from_secs(10));
            if *stop.lock().unwrap() {
                return;
            }
            let (tx, rx) = std::sync::mpsc::channel();
            let mut watcher = match RecommendedWatcher::new(
                move |res| {
                    let _ = tx.send(res);
                },
                Config::default(),
            ) {
                Ok(w) => w,
                Err(_) => return,
            };
            if watcher
                .watch(PathBuf::from(&root_path).as_path(), RecursiveMode::Recursive)
                .is_err()
            {
                return;
            }

            let mut pending: HashMap<String, Instant> = HashMap::new();
            loop {
                if *stop.lock().unwrap() {
                    break;
                }
                match rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(Ok(event)) => {
                        for path in event.paths {
                            if should_ignore_path(&path) {
                                continue;
                            }
                            let uri = super::launch::path_to_uri(&path.to_string_lossy());
                            pending.insert(uri, Instant::now());
                        }
                    }
                    Ok(Err(_)) => continue,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }

                let now = Instant::now();
                let ready: Vec<String> = pending
                    .iter()
                    .filter(|(_, at)| now.duration_since(**at) >= WATCH_DEBOUNCE)
                    .map(|(uri, _)| uri.clone())
                    .collect();
                for uri in ready {
                    pending.remove(&uri);
                    emit_host(&app_handle, "fs:changed", vec![Value::String(uri)]);
                }
            }
        });
    }
}

fn should_ignore_path(path: &Path) -> bool {
    path.components().any(|c| {
        c.as_os_str()
            .to_str()
            .map(|s| WATCH_IGNORE_SEGMENTS.iter().any(|seg| *seg == s))
            .unwrap_or(false)
    })
}

fn schedule_background(app: AppHandle, root_uri: String, _gen: u64) {
    thread::sleep(Duration::from_millis(50));
    let branch = if is_git_workspace(&root_uri) {
        git_branch(&root_uri)
    } else {
        None
    };
    // Always emit (including null) so status bar clears on non-git roots — Electron parity.
    emit_host(
        &app,
        "workspace:gitBranch",
        vec![serde_json::json!({ "rootUri": root_uri, "branch": branch })],
    );

    thread::spawn({
        let app = app.clone();
        let root_uri = root_uri.clone();
        move || {
            if warm_search_index(&root_uri) {
                emit_host(
                    &app,
                    "workspace:searchReady",
                    vec![serde_json::json!({ "rootUri": root_uri })],
                );
            }
        }
    });
}

pub fn handle(
    host: &WorkspaceHost,
    app: &AppHandle,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
    match channel {
        "workspace:activate" => {
            let root_uri = args.first().and_then(|v| v.as_str()).ok_or("missing rootUri")?;
            let result = host.activate(app, root_uri)?;
            let gen = host
                .roots
                .lock()
                .map_err(|e| e.to_string())?
                .get(root_uri)
                .map(|s| s.gen)
                .unwrap_or(1);
            host.start_watch(app, root_uri, gen);
            Ok(result)
        }
        "workspace:deactivate" => {
            let root_uri = args.first().and_then(|v| v.as_str()).ok_or("missing rootUri")?;
            host.deactivate(root_uri)
        }
        _ => Err(format!("unknown workspace channel: {channel}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_node_modules_and_git() {
        assert!(should_ignore_path(Path::new("/proj/node_modules/pkg/index.js")));
        assert!(should_ignore_path(Path::new("/proj/.git/HEAD")));
        assert!(should_ignore_path(Path::new("/proj/dist/bundle.js")));
        assert!(!should_ignore_path(Path::new("/proj/src/index.ts")));
    }
}
