#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Manager, RunEvent, WindowEvent};
    let process_started = std::time::Instant::now();
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init());

    #[cfg(not(feature = "e2e"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let args: Vec<String> = argv.into_iter().filter(|a| !a.starts_with('-')).collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let config = host::launch::resolve_launch_target(&args, &cwd);
            shell::deliver_launch(app, config);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }
    // Finder/Explorer launches start with a minimal PATH. Seed the standard
    // developer-tool locations synchronously, then let the login-shell probe
    // refine it without delaying first paint.
    seed_common_executable_paths();

    #[cfg(feature = "e2e")]
    {
        builder = builder
            .append_invoke_initialization_script(
                r#"if (window.name !== "__jet_e2e_initialized__") {
                    localStorage.clear();
                    sessionStorage.clear();
                    window.name = "__jet_e2e_initialized__";
                }"#,
            )
            .plugin(tauri_plugin_wdio_webdriver::init());
    }

    let app = builder
        .setup(move |app| {
            // Don't block first paint on login-shell PATH probe — refresh in background.
            std::thread::spawn(|| apply_login_shell_path());

            let home = dirs::home_dir()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| "/".to_string());
            app.manage(host::HostState::new(home, process_started));
            app.manage(shell::ShellState::default());

            let e2e = std::env::var("JET_E2E").ok().as_deref() == Some("1");
            let headed = std::env::var("JET_HEADED").ok().as_deref() == Some("1")
                || std::env::var("PWDEBUG").ok().as_deref() == Some("1");
            if let Some(window) = app.get_webview_window("main") {
                shell::apply_cached_chrome(&window);
                if e2e && headed {
                    let _ = window.show();
                } else if e2e && !headed {
                    // Fully hidden WKWebViews throttle timers/rAF hard enough to break
                    // Radix dialogs, caret motion, and scroll sampling. Park off-screen
                    // so the desktop stays clear without freezing the webview.
                    let _ = window.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition::new(-40_000, -40_000),
                    ));
                    let _ = window.show();
                }
            }

            let args: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let mut config = host::launch::resolve_launch_target(&args, &cwd);
            if !args.is_empty() {
                config.source = Some("explicit".to_string());
            }
            shell::deliver_launch(app.handle(), config);

            shell::install_menu(app.handle())?;
            // Menu install + first webview layout reset traffic lights (wry/AppKit).
            // Re-pin now and again after a couple short delays so first paint sticks.
            if let Some(window) = app.get_webview_window("main") {
                shell::apply_traffic_light_position(&window);
                #[cfg(target_os = "macos")]
                {
                    for delay_ms in [80_u64, 250, 600] {
                        let win = window.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                            let win2 = win.clone();
                            let _ = win.run_on_main_thread(move || {
                                shell::apply_traffic_light_position(&win2);
                            });
                        });
                    }
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| shell::on_menu_event(app, event))
        .on_window_event(|window, event| {
            match event {
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                    if let Some(webview) =
                        window.app_handle().get_webview_window(window.label())
                    {
                        shell::apply_traffic_light_position(&webview);
                    }
                }
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                    if let Some(host) = window.try_state::<host::HostState>() {
                        host.terminal.dispose_for_client(window.label());
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            shell::jet_show_open_folder_dialog,
            shell::jet_show_save_file_dialog,
            shell::jet_sync_native_chrome,
            shell::jet_get_launch_config,
            shell::jet_host_invoke,
        ])
        .build(tauri::generate_context!())
        .expect("error while building jet-tauri");

    app.run(|app_handle, event| match event {
        RunEvent::Exit => {
            if let Some(host) = app_handle.try_state::<host::HostState>() {
                host.shutdown();
            }
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().into_owned();
                    let cwd = std::env::current_dir().unwrap_or_default();
                    let mut config = host::launch::resolve_launch_target(&[path_str], &cwd);
                    config.source = Some("explicit".to_string());
                    shell::deliver_launch(app_handle, config);
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.set_focus();
                    }
                }
            }
        }
        _ => {}
    });
}

#[cfg(not(target_os = "windows"))]
fn seed_common_executable_paths() {
    use std::path::PathBuf;

    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = Vec::<PathBuf>::new();
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".local/bin"));
        paths.push(home.join(".cargo/bin"));
        paths.push(home.join("Library/pnpm"));
    }
    paths.push(PathBuf::from("/opt/homebrew/bin"));
    paths.push(PathBuf::from("/usr/local/bin"));
    paths.extend(std::env::split_paths(&current));

    let mut seen = std::collections::HashSet::new();
    paths.retain(|path| seen.insert(path.clone()));
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var("PATH", joined);
    }
}

#[cfg(target_os = "windows")]
fn seed_common_executable_paths() {}

#[cfg(not(target_os = "windows"))]
fn apply_login_shell_path() {
    use std::path::PathBuf;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let shell_base = std::path::Path::new(&shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("bash");
    let cmd = if shell_base == "fish" {
        format!("{shell} -l -c 'printf \"%s\" $PATH'")
    } else {
        format!("{shell} -l -ilc 'printf \"%s\" \"$PATH\"'")
    };
    if let Ok(output) = std::process::Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    {
        if output.status.success() {
            let login = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if login.is_empty() {
                return;
            }
            // Merge login-shell PATH with current (seeded) PATH — never replace
            // wholesale so /opt/homebrew/bin and ~/.cargo/bin stay available.
            let current = std::env::var_os("PATH").unwrap_or_default();
            let mut paths = Vec::<PathBuf>::new();
            paths.extend(std::env::split_paths(std::ffi::OsStr::new(&login)));
            paths.extend(std::env::split_paths(&current));
            let mut seen = std::collections::HashSet::new();
            paths.retain(|path| seen.insert(path.clone()));
            if let Ok(joined) = std::env::join_paths(paths) {
                std::env::set_var("PATH", joined);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn apply_login_shell_path() {}

mod host;
mod shell;
