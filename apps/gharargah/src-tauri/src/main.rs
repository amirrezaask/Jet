use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct ServerSidecar(Mutex<Option<CommandChild>>);

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
            let sidecar_args = vec![
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--data-dir".to_string(),
                data_dir.to_string_lossy().into_owned(),
            ];
            let (mut events, child) = app.shell().sidecar("jet")?.args(sidecar_args).spawn()?;
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
