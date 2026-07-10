use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub fn emit_host(app: &AppHandle, channel: &str, args: Vec<Value>) {
    let _ = app.emit(channel, args);
}

pub fn emit_host_str(app: &AppHandle, channel: &str, arg: impl Into<Value>) {
    emit_host(app, channel, vec![arg.into()]);
}
