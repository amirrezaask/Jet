use serde_json::Value;
use std::process::Command;

pub fn spawn_task(req: &Value) -> Result<Value, String> {
    let command = req.get("command").and_then(|v| v.as_str()).ok_or("missing command")?;
    let args: Vec<String> = req
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let cwd = req.get("cwd").and_then(|v| v.as_str()).ok_or("missing cwd")?;

    let output = if cfg!(windows) {
        Command::new("cmd")
            .args(["/C", command])
            .args(&args)
            .current_dir(cwd)
            .output()
    } else {
        Command::new(command).args(&args).current_dir(cwd).output()
    }
    .map_err(|e| e.to_string())?;

    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(serde_json::json!({
        "exitCode": output.status.code().unwrap_or(1),
        "output": text,
    }))
}

pub fn handle(channel: &str, args: &[Value]) -> Result<Value, String> {
    match channel {
        "tasks:spawn" => {
            let req = args.first().ok_or("missing task request")?;
            spawn_task(req)
        }
        _ => Err(format!("unknown tasks channel: {channel}")),
    }
}
