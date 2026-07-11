use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub fn emit_host(app: &AppHandle, channel: &str, args: Vec<Value>) {
    let _ = app.emit(channel, args);
}
