use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use super::uri::{file_uri_to_path, path_to_file_uri, resolve_path};

const WORKSPACE_MARKERS: &[&str] = &[
    ".git",
    "package.json",
    "tsconfig.json",
    "Cargo.toml",
    "go.mod",
    ".gharargah",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    pub workspace_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

fn marker_exists(dir: &Path, marker: &str) -> bool {
    let path = dir.join(marker);
    match fs::metadata(&path) {
        Ok(meta) => {
            if marker == ".git" {
                meta.is_dir()
            } else {
                meta.is_file()
            }
        }
        Err(_) => false,
    }
}

pub fn find_workspace_root(start_dir: &Path) -> PathBuf {
    let mut current = start_dir.to_path_buf();
    for _ in 0..20 {
        for marker in WORKSPACE_MARKERS {
            if marker_exists(&current, marker) {
                return current;
            }
        }
        let parent = current.parent();
        if parent.is_none() || parent == Some(current.as_path()) {
            break;
        }
        current = parent.unwrap().to_path_buf();
    }
    start_dir.to_path_buf()
}

pub fn resolve_launch_target(user_args: &[String], cwd: &Path) -> LaunchConfig {
    let resolved_cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    let positional: Vec<&String> = user_args.iter().filter(|a| !a.starts_with('-')).collect();

    let target_path = if positional.is_empty() {
        resolved_cwd.clone()
    } else {
        resolve_path(&resolved_cwd, positional[0])
    };

    match fs::metadata(&target_path) {
        Ok(meta) if meta.is_dir() => LaunchConfig {
            workspace_path: target_path.to_string_lossy().into_owned(),
            file_path: None,
            source: None,
        },
        Ok(_) => {
            let parent = target_path.parent().unwrap_or(&resolved_cwd);
            let workspace = find_workspace_root(parent);
            LaunchConfig {
                workspace_path: workspace.to_string_lossy().into_owned(),
                file_path: Some(target_path.to_string_lossy().into_owned()),
                source: None,
            }
        }
        Err(_) => LaunchConfig {
            workspace_path: resolved_cwd.to_string_lossy().into_owned(),
            file_path: None,
            source: None,
        },
    }
}

pub fn load_global_jetrc_scan_roots(home_dir: &str) -> Vec<String> {
    let jet_dir = Path::new(home_dir).join(".gharargah");
    let json_path = jet_dir.join("gharargahrc.json");
    let Ok(raw) = fs::read_to_string(json_path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    parsed
        .get("scanRoots")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

pub fn handle(channel: &str, _args: &[Value], home_dir: &str) -> Result<Value, String> {
    match channel {
        "gharargah:getHomeDir" => Ok(Value::String(home_dir.to_string())),
        "gharargah:loadGlobalGharargahrcScanRoots" => {
            Ok(serde_json::to_value(load_global_jetrc_scan_roots(home_dir))
                .map_err(|e| e.to_string())?)
        }
        _ => Err(format!("unknown launch channel: {channel}")),
    }
}

pub fn path_to_uri(path: &str) -> String {
    path_to_file_uri(path)
}

pub fn uri_to_path(uri: &str) -> String {
    file_uri_to_path(uri)
}
