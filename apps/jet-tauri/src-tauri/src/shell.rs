use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::host::events::emit_host;
use crate::host::launch::LaunchConfig;

const DEFAULT_ZOOM: f64 = 1.0;
const ZOOM_STEP: f64 = 0.1;
const MIN_ZOOM: f64 = 0.5;
const MAX_ZOOM: f64 = 3.0;

#[derive(Default)]
pub struct ShellState {
    launch_config: Mutex<Option<LaunchConfig>>,
    zoom: Mutex<Option<f64>>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct NativeChromeColors {
    pub background: String,
    pub foreground: String,
}

#[tauri::command]
pub async fn jet_show_open_folder_dialog(window: WebviewWindow) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = window.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn jet_show_save_file_dialog(
    window: WebviewWindow,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = window.dialog().file();
    if let Some(path) = default_path {
        builder = builder.set_file_name(&path);
    }
    Ok(builder.blocking_save_file().map(|p| p.to_string()))
}

#[tauri::command]
pub async fn jet_sync_native_chrome(
    window: WebviewWindow,
    colors: NativeChromeColors,
) -> Result<(), String> {
    write_chrome_cache(&colors);
    apply_chrome_colors(&window, &colors)
}

#[tauri::command]
pub fn jet_get_launch_config(state: tauri::State<ShellState>) -> Option<LaunchConfig> {
    // Consume-once — matches Electron. Sticky config would force argv workspace
    // on every webview reload and ignore the project catalog's last active path.
    state.launch_config.lock().ok()?.take()
}

#[tauri::command]
pub async fn jet_host_invoke(
    app: AppHandle,
    window: WebviewWindow,
    shell: tauri::State<'_, ShellState>,
    channel: String,
    args: Vec<Value>,
    client_id: Option<String>,
) -> Result<Value, String> {
    if channel == "jet:getLaunchConfig" {
        return Ok(shell
            .launch_config
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .map(|c| serde_json::to_value(c).unwrap_or(Value::Null))
            .unwrap_or(Value::Null));
    }
    if channel == "ui:syncNativeChrome" {
        if let Some(colors) = args.first() {
            if let Ok(parsed) = serde_json::from_value::<NativeChromeColors>(colors.clone()) {
                jet_sync_native_chrome(window, parsed).await?;
            }
        }
        return Ok(Value::Null);
    }
    if channel == "fs:showOpenFolderDialog" {
        return Ok(serde_json::to_value(jet_show_open_folder_dialog(window).await?).unwrap());
    }
    if channel == "fs:showSaveFileDialog" {
        let default_path = args.first().and_then(|v| v.as_str()).map(str::to_string);
        return Ok(
            serde_json::to_value(jet_show_save_file_dialog(window, default_path).await?).unwrap(),
        );
    }
    let client = client_id.unwrap_or_else(|| window.label().to_string());
    let host_app = app.clone();
    tokio::task::spawn_blocking(move || {
        let host = host_app.state::<crate::host::HostState>();
        host.invoke(&host_app, &channel, args, &client)
    })
    .await
    .map_err(|err| format!("host task failed: {err}"))?
}

pub fn deliver_launch(app: &AppHandle, config: LaunchConfig) {
    if let Some(shell) = app.try_state::<ShellState>() {
        if let Ok(mut guard) = shell.launch_config.lock() {
            *guard = Some(config.clone());
        }
    }
    emit_host(
        app,
        "jet:launch",
        vec![serde_json::to_value(config).unwrap_or(Value::Null)],
    );
}

pub fn apply_cached_chrome(window: &WebviewWindow) {
    if let Some(colors) = read_chrome_cache() {
        let _ = apply_chrome_colors(window, &colors);
    } else {
        apply_traffic_light_position(window);
    }
}

pub fn install_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let close_tab = MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let file_sep = PredefinedMenuItem::separator(app)?;
    let close_window = PredefinedMenuItem::close_window(app, None)?;
    let file_submenu =
        Submenu::with_items(app, "File", true, &[&close_tab, &file_sep, &close_window])?;

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let edit_sep1 = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit_submenu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo as &dyn IsMenuItem<tauri::Wry>,
            &redo,
            &edit_sep1,
            &cut,
            &copy,
            &paste,
            &select_all,
        ],
    )?;

    // Electron role:"viewMenu" parity — reload / zoom / fullscreen / devtools.
    let reload = MenuItem::with_id(app, "view-reload", "Reload", true, Some("CmdOrCtrl+R"))?;
    let force_reload = MenuItem::with_id(
        app,
        "view-force-reload",
        "Force Reload",
        true,
        Some("CmdOrCtrl+Shift+R"),
    )?;
    let view_sep1 = PredefinedMenuItem::separator(app)?;
    let toggle_devtools = MenuItem::with_id(
        app,
        "view-devtools",
        "Toggle Developer Tools",
        true,
        Some("Alt+CmdOrCtrl+I"),
    )?;
    let view_sep2 = PredefinedMenuItem::separator(app)?;
    let zoom_reset = MenuItem::with_id(
        app,
        "view-zoom-reset",
        "Actual Size",
        true,
        Some("CmdOrCtrl+0"),
    )?;
    let zoom_in = MenuItem::with_id(app, "view-zoom-in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?;
    let zoom_out = MenuItem::with_id(app, "view-zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let view_sep3 = PredefinedMenuItem::separator(app)?;
    let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
    let view_submenu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &reload as &dyn IsMenuItem<tauri::Wry>,
            &force_reload,
            &view_sep1,
            &toggle_devtools,
            &view_sep2,
            &zoom_reset,
            &zoom_in,
            &zoom_out,
            &view_sep3,
            &fullscreen,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let app_submenu = {
        let about = PredefinedMenuItem::about(app, Some("About Jet"), None)?;
        let app_sep1 = PredefinedMenuItem::separator(app)?;
        let services = PredefinedMenuItem::services(app, None)?;
        let app_sep2 = PredefinedMenuItem::separator(app)?;
        let hide = PredefinedMenuItem::hide(app, None)?;
        let hide_others = PredefinedMenuItem::hide_others(app, None)?;
        let show_all = PredefinedMenuItem::show_all(app, None)?;
        let app_sep3 = PredefinedMenuItem::separator(app)?;
        let quit = PredefinedMenuItem::quit(app, None)?;
        Submenu::with_items(
            app,
            "Jet",
            true,
            &[
                &about as &dyn IsMenuItem<tauri::Wry>,
                &app_sep1,
                &services,
                &app_sep2,
                &hide,
                &hide_others,
                &show_all,
                &app_sep3,
                &quit,
            ],
        )?
    };

    #[cfg(target_os = "macos")]
    let window_submenu = {
        let minimize = PredefinedMenuItem::minimize(app, None)?;
        let maximize = PredefinedMenuItem::maximize(app, None)?;
        let window_sep = PredefinedMenuItem::separator(app)?;
        let bring_all = PredefinedMenuItem::bring_all_to_front(app, None)?;
        Submenu::with_items(
            app,
            "Window",
            true,
            &[&minimize, &maximize, &window_sep, &bring_all],
        )?
    };

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        app,
        &[
            &app_submenu as &dyn IsMenuItem<tauri::Wry>,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file_submenu, &edit_submenu, &view_submenu])?;

    app.set_menu(menu)?;
    Ok(())
}

pub fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "close-tab" => emit_host(app, "jet:close-tab", vec![]),
        "view-reload" | "view-force-reload" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.reload();
            }
        }
        "view-devtools" => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        "view-zoom-reset" => set_zoom(app, DEFAULT_ZOOM),
        "view-zoom-in" => adjust_zoom(app, ZOOM_STEP),
        "view-zoom-out" => adjust_zoom(app, -ZOOM_STEP),
        _ => {}
    }
}

fn adjust_zoom(app: &AppHandle, delta: f64) {
    let Some(shell) = app.try_state::<ShellState>() else {
        return;
    };
    let next = {
        let Ok(mut zoom) = shell.zoom.lock() else {
            return;
        };
        let current = zoom.unwrap_or(DEFAULT_ZOOM);
        let next = (current + delta).clamp(MIN_ZOOM, MAX_ZOOM);
        *zoom = Some(next);
        next
    };
    set_zoom(app, next);
}

fn set_zoom(app: &AppHandle, factor: f64) {
    let clamped = factor.clamp(MIN_ZOOM, MAX_ZOOM);
    if let Some(shell) = app.try_state::<ShellState>() {
        if let Ok(mut zoom) = shell.zoom.lock() {
            *zoom = Some(clamped);
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_zoom(clamped);
    }
}

fn chrome_cache_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".jet").join("native-chrome.json"))
}

fn read_chrome_cache() -> Option<NativeChromeColors> {
    let path = chrome_cache_path()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_chrome_cache(colors: &NativeChromeColors) {
    let Some(path) = chrome_cache_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string(colors) {
        let _ = fs::write(path, raw);
    }
}

fn apply_chrome_colors(window: &WebviewWindow, colors: &NativeChromeColors) -> Result<(), String> {
    let _ = window.set_background_color(Some(parse_color(&colors.background)?));
    #[cfg(target_os = "windows")]
    apply_windows_title_bar_overlay(window, colors)?;
    #[cfg(target_os = "macos")]
    apply_traffic_light_position(window);
    Ok(())
}

/// Electron `trafficLightPosition: { x: 14, y: 11 }` — keep in sync with
/// `apps/jet-desktop/src/main/main.ts` and `tauri.conf.json`.
#[cfg(target_os = "macos")]
pub const TRAFFIC_LIGHT_X: f64 = 14.0;
#[cfg(target_os = "macos")]
pub const TRAFFIC_LIGHT_Y: f64 = 11.0;

/// Pin macOS traffic lights to Electron-compatible coordinates.
///
/// wry's `trafficLightPosition` sets button **x** and resizes the titlebar
/// container using **y**, but leaves each button's AppKit `origin.y` untouched.
/// On newer macOS the buttons stay top-glued inside that container, so y never
/// looks like Electron. Force `origin.y = 0` (bottom of the titlebar container)
/// so button tops land at `TRAFFIC_LIGHT_Y` from the window top.
///
/// AppKit also resets positions after menu install / layout — call this again
/// from those sites.
#[cfg(target_os = "macos")]
pub fn apply_traffic_light_position(window: &WebviewWindow) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    if ptr.is_null() {
        return;
    }
    unsafe {
        use objc2_app_kit::{NSView, NSWindow, NSWindowButton};

        let ns_window = &*(ptr as *const NSWindow);
        let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
            return;
        };
        let Some(miniaturize) =
            ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)
        else {
            return;
        };
        let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);

        let Some(close_superview) = close.superview() else {
            return;
        };
        let Some(title_bar_container) = close_superview.superview() else {
            return;
        };

        let close_rect = NSView::frame(&close);
        let title_bar_frame_height = close_rect.size.height + TRAFFIC_LIGHT_Y;
        let mut title_bar_rect = NSView::frame(&title_bar_container);
        title_bar_rect.size.height = title_bar_frame_height;
        title_bar_rect.origin.y = ns_window.frame().size.height - title_bar_frame_height;
        title_bar_container.setFrame(title_bar_rect);

        let space_between = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
        let mut buttons = vec![close, miniaturize];
        if let Some(zoom) = zoom {
            buttons.push(zoom);
        }
        for (i, button) in buttons.into_iter().enumerate() {
            let mut rect = NSView::frame(&button);
            // Electron semantics: (x, y) is the close-button top-left. With the
            // titlebar container height = buttonHeight + y and AppKit's
            // bottom-left origin, origin.y = 0 puts the button top at y.
            rect.origin.x = TRAFFIC_LIGHT_X + (i as f64 * space_between);
            rect.origin.y = 0.0;
            button.setFrameOrigin(rect.origin);
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn apply_traffic_light_position(_window: &WebviewWindow) {}

fn parse_color(hex: &str) -> Result<tauri::window::Color, String> {
    let raw = hex.trim().trim_start_matches('#');
    if raw.len() != 6 {
        return Err(format!("invalid color hex: {hex}"));
    }
    let r = u8::from_str_radix(&raw[0..2], 16).map_err(|e| e.to_string())?;
    let g = u8::from_str_radix(&raw[2..4], 16).map_err(|e| e.to_string())?;
    let b = u8::from_str_radix(&raw[4..6], 16).map_err(|e| e.to_string())?;
    Ok(tauri::window::Color(r, g, b, 255))
}

#[cfg(target_os = "windows")]
fn hex_to_colorref(hex: &str) -> Result<u32, String> {
    let raw = hex.trim().trim_start_matches('#');
    if raw.len() != 6 {
        return Err(format!("invalid color hex: {hex}"));
    }
    let r = u8::from_str_radix(&raw[0..2], 16).map_err(|e| e.to_string())?;
    let g = u8::from_str_radix(&raw[2..4], 16).map_err(|e| e.to_string())?;
    let b = u8::from_str_radix(&raw[4..6], 16).map_err(|e| e.to_string())?;
    Ok(u32::from(b) << 16 | u32::from(g) << 8 | u32::from(r))
}

#[cfg(target_os = "windows")]
fn apply_windows_title_bar_overlay(
    window: &WebviewWindow,
    colors: &NativeChromeColors,
) -> Result<(), String> {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };

    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let caption = hex_to_colorref(&colors.background)?;
    let text = hex_to_colorref(&colors.foreground)?;
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            &caption as *const _ as *const _,
            std::mem::size_of::<u32>() as u32,
        )
        .map_err(|e| e.to_string())?;
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            &text as *const _ as *const _,
            std::mem::size_of::<u32>() as u32,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
