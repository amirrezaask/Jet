use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

const MAX_STARTUP_LOG_BYTES: u64 = 5 * 1024 * 1024;

pub struct PerfHost {
    process_started: Instant,
    log_path: PathBuf,
}

impl PerfHost {
    pub fn new(home_dir: &str, process_started: Instant) -> Self {
        let base = std::env::var_os("GHARARGAH_E2E_USER_DATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(home_dir).join(".gharargah"));
        Self {
            process_started,
            log_path: base.join("perf").join("startup.jsonl"),
        }
    }

    pub fn record_startup(&self, payload: &Value) -> Result<Value, String> {
        if let Some(parent) = self.log_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if fs::metadata(&self.log_path)
            .map(|meta| meta.len() >= MAX_STARTUP_LOG_BYTES)
            .unwrap_or(false)
        {
            let rotated = self.log_path.with_extension("previous.jsonl");
            let _ = fs::remove_file(&rotated);
            fs::rename(&self.log_path, rotated).map_err(|e| e.to_string())?;
        }

        let mut record = payload.clone();
        let object = record
            .as_object_mut()
            .ok_or("startup record must be an object")?;
        object.insert(
            "hostProcessElapsedMs".into(),
            serde_json::json!(self.process_started.elapsed().as_secs_f64() * 1000.0),
        );
        object.insert(
            "recordedAt".into(),
            Value::String(chrono::Utc::now().to_rfc3339()),
        );
        object.insert(
            "buildMode".into(),
            Value::String(
                if cfg!(debug_assertions) {
                    "debug"
                } else {
                    "release"
                }
                .into(),
            ),
        );
        for (field, env_name) in [
            ("runId", "GHARARGAH_STARTUP_RUN_ID"),
            ("runKind", "GHARARGAH_STARTUP_RUN_KIND"),
            ("commit", "GHARARGAH_BUILD_COMMIT"),
            ("sample", "GHARARGAH_STARTUP_SAMPLE"),
        ] {
            if let Ok(value) = std::env::var(env_name) {
                object.insert(field.into(), Value::String(value));
            }
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, &record).map_err(|e| e.to_string())?;
        file.write_all(b"\n").map_err(|e| e.to_string())?;
        Ok(Value::String(self.log_path.to_string_lossy().into_owned()))
    }

    pub fn log_path(&self) -> Value {
        Value::String(self.log_path.to_string_lossy().into_owned())
    }
}

pub fn handle(host: &PerfHost, channel: &str, args: &[Value]) -> Result<Value, String> {
    match channel {
        "perf:recordStartup" => host.record_startup(args.first().unwrap_or(&Value::Null)),
        "perf:getStartupLogPath" => Ok(host.log_path()),
        _ => Err(format!("unknown perf channel: {channel}")),
    }
}
