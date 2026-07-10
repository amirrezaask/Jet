#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let args: Vec<String> = argv
                .into_iter()
                .filter(|a| !a.starts_with('-'))
                .collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let config = host::launch::resolve_launch_target(&args, &cwd);
            shell::deliver_launch(app, config);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));

    #[cfg(feature = "e2e")]
    {
        builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    }

    builder
        .setup(|app| {
            apply_login_shell_path();

            let home = dirs::home_dir()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| "/".to_string());
            app.manage(host::HostState::new(home));
            app.manage(shell::ShellState::default());

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
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
            Ok(())
        })
        .on_menu_event(|app, event| shell::on_menu_event(app, event))
        .invoke_handler(tauri::generate_handler![
            shell::jet_show_open_folder_dialog,
            shell::jet_show_save_file_dialog,
            shell::jet_sync_native_chrome,
            shell::jet_get_launch_config,
            shell::jet_host_invoke,
        ])
        .run(tauri::generate_context!())
        .expect("error while running jet-tauri");
}

#[cfg(not(target_os = "windows"))]
fn apply_login_shell_path() {
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
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                std::env::set_var("PATH", path);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn apply_login_shell_path() {}

mod host;
mod shell;
