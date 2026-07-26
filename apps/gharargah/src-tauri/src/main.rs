use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct ServerSidecar(Mutex<Option<CommandChild>>);

/// GUI apps inherit PATH=/usr/bin:/bin:/usr/sbin:/sbin. Resolve the user's
/// login-shell PATH so the jet sidecar can find agent CLIs (codex, claude, …).
fn login_shell_path() -> Option<String> {
    let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/zsh".into());
    for args in [["-ilc", "printenv PATH"], ["-lc", "printenv PATH"]] {
        let output = Command::new(&shell)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        if !output.status.success() {
            continue;
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Some(path);
        }
    }
    None
}

fn is_gui_stripped_path(path: &str) -> bool {
    let dirs: Vec<&str> = path.split(':').filter(|d| !d.is_empty()).collect();
    if dirs.is_empty() {
        return true;
    }
    const SYSTEM: &[&str] = &["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
    dirs.iter().all(|dir| SYSTEM.contains(dir))
}

fn sidecar_path_env() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let login = login_shell_path();
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf| {
        if p.as_os_str().is_empty() {
            return;
        }
        if !dirs.iter().any(|d| d == &p) {
            dirs.push(p);
        }
    };

    if let Some(ref login) = login {
        for dir in std::env::split_paths(login) {
            push(dir);
        }
    }
    // Fallback bins when login shell fails (common on some DMG / quarantine launches).
    if let Some(home) = dirs::home_dir() {
        for rel in [".local/bin", ".cargo/bin", "bin", ".opencode/bin"] {
            let candidate = home.join(rel);
            if candidate.is_dir() {
                push(candidate);
            }
        }
    }
    for system in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
    ] {
        let candidate = PathBuf::from(system);
        if candidate.is_dir() {
            push(candidate);
        }
    }
    for dir in std::env::split_paths(&current) {
        push(dir);
    }
    if dirs.is_empty() {
        return if current.is_empty() {
            "/usr/bin:/bin:/usr/sbin:/sbin".into()
        } else {
            current
        };
    }
    std::env::join_paths(&dirs)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(current)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerSidecar(Mutex::new(None)))
        .setup(|app| {
            let listener = TcpListener::bind(("127.0.0.1", 0))?;
            let port = listener.local_addr()?.port();
            drop(listener);

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let launch_cwd = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let sidecar_args = vec![
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--data-dir".to_string(),
                data_dir.to_string_lossy().into_owned(),
                launch_cwd.to_string_lossy().into_owned(),
            ];

            // Inject login-shell PATH into the sidecar. Do this in the desktop
            // host — jet's own lazy load can still run, but GUI-spawned
            // children often never see Homebrew / ~/.local/bin otherwise.
            let path_env = sidecar_path_env();
            let mut command = app.shell().sidecar("jet")?.args(sidecar_args);
            command = command.current_dir(&launch_cwd).env("PATH", &path_env);
            if let Some(home) = dirs::home_dir() {
                command = command.env("HOME", home);
            }
            if let Ok(shell) = std::env::var("SHELL") {
                command = command.env("SHELL", shell);
            } else if Path::new("/bin/zsh").exists() {
                command = command.env("SHELL", "/bin/zsh");
            }
            if let Ok(user) = std::env::var("USER") {
                command = command.env("USER", user);
            }
            // If we still only have a stripped PATH, force jet's lazy loader.
            if is_gui_stripped_path(&path_env) {
                command = command.env("JET_SHELL_ENV_FORCE", "1");
            }

            let (mut events, child) = command.spawn()?;
            *app.state::<ServerSidecar>().0.lock().unwrap() = Some(child);

            tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let address = format!("127.0.0.1:{port}");
                let deadline = Instant::now() + Duration::from_secs(30);
                while Instant::now() < deadline {
                    if TcpStream::connect(&address).is_ok() {
                        let url = format!("http://{address}").parse().unwrap();
                        let _ = WebviewWindowBuilder::new(
                            &app_handle,
                            "main",
                            WebviewUrl::External(url),
                        )
                        .title("Gharargah")
                        .inner_size(1400.0, 900.0)
                        .min_inner_size(720.0, 480.0)
                        .build();
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                app_handle.exit(1);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Gharargah desktop shell")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                if let Some(child) = app.state::<ServerSidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
