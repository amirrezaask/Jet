use serde::Serialize;
use serde_json::Value;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use super::fff_service;
use super::launch::uri_to_path;

const IGNORE_GLOBS: &[&str] = &[
    "!.git/**",
    "!node_modules/**",
    "!dist/**",
    "!dist-electron/**",
    "!.turbo/**",
];

#[derive(Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
}

static FILE_CACHE: std::sync::OnceLock<Mutex<std::collections::HashMap<String, Vec<String>>>> =
    std::sync::OnceLock::new();

fn file_cache() -> &'static Mutex<std::collections::HashMap<String, Vec<String>>> {
    FILE_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

pub fn is_git_workspace(root_uri: &str) -> bool {
    super::git::git_is_repo(root_uri)
}

pub fn warm_search_index(root_uri: &str) -> bool {
    if is_git_workspace(root_uri) {
        if fff_service::warm_fff_index(root_uri) {
            return true;
        }
    }
    list_project_files(root_uri).is_ok()
}

pub fn is_search_scan_ready(root_uri: &str) -> bool {
    if !is_git_workspace(root_uri) {
        return true;
    }
    if fff_service::is_fff_scan_ready(root_uri) {
        return true;
    }
    file_cache().lock().unwrap().contains_key(root_uri)
}

pub fn list_project_files(root_uri: &str) -> Result<Vec<String>, String> {
    if !is_git_workspace(root_uri) {
        return Ok(Vec::new());
    }

    if let Some(files) = fff_service::fff_list_files(root_uri, 50_000) {
        file_cache()
            .lock()
            .unwrap()
            .insert(root_uri.to_string(), files.clone());
        return Ok(files);
    }

    if let Some(cached) = file_cache().lock().unwrap().get(root_uri) {
        return Ok(cached.clone());
    }

    let files = rg_list_project_files(root_uri, 50_000)?;
    file_cache()
        .lock()
        .unwrap()
        .insert(root_uri.to_string(), files.clone());
    Ok(files)
}

fn rg_list_project_files(root_uri: &str, max_files: usize) -> Result<Vec<String>, String> {
    let cwd = uri_to_path(root_uri);
    let mut args = vec!["--files"];
    for glob in IGNORE_GLOBS {
        args.push("--glob");
        args.push(glob);
    }
    args.push(".");

    let output = Command::new("rg")
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "ripgrep (rg) is not installed or not on PATH".to_string()
            } else {
                e.to_string()
            }
        })?;

    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }

    let mut paths: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim_start_matches("./").to_string())
        .filter(|line| !line.is_empty())
        .take(max_files)
        .collect();
    paths.sort();
    Ok(paths)
}

pub fn project_search(
    root_uri: &str,
    query: &str,
    opts: Option<&Value>,
) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    if !is_git_workspace(root_uri) {
        return Ok(Vec::new());
    }

    let case_sensitive = opts
        .and_then(|o| o.get("caseSensitive"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let regex = opts
        .and_then(|o| o.get("regex"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let fuzzy = opts
        .and_then(|o| o.get("fuzzy"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if let Some(results) = fff_service::fff_grep(root_uri, query, case_sensitive, regex, fuzzy) {
        return Ok(results);
    }

    rg_project_search(root_uri, query, case_sensitive, regex)
}

fn rg_project_search(
    root_uri: &str,
    query: &str,
    case_sensitive: bool,
    regex: bool,
) -> Result<Vec<SearchResult>, String> {
    let cwd = uri_to_path(root_uri);
    let mut args = vec!["--json", "--max-count", "1"];
    if !case_sensitive {
        args.push("-i");
    }
    if regex {
        args.push("--regexp");
    } else {
        args.push("--fixed-strings");
    }
    for glob in IGNORE_GLOBS {
        args.push("--glob");
        args.push(glob);
    }
    args.push(query);
    args.push(".");

    let output = Command::new("rg")
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if results.len() >= 200 {
            break;
        }
        let Ok(parsed) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if parsed.get("type").and_then(|v| v.as_str()) != Some("match") {
            continue;
        }
        let data = parsed.get("data").unwrap_or(&parsed);
        let path = data
            .get("path")
            .and_then(|p| p.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim_start_matches("./")
            .to_string();
        let line_number = data.get("line_number").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
        let preview = data
            .get("lines")
            .and_then(|v| v.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let column = data
            .get("submatches")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|m| m.get("start"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32
            + 1;
        results.push(SearchResult {
            path,
            line: line_number,
            column,
            preview,
        });
    }
    Ok(results)
}

pub fn file_search(root_uri: &str, query: &str, opts: Option<&Value>) -> Result<Vec<String>, String> {
    if !is_git_workspace(root_uri) {
        return Ok(Vec::new());
    }

    let limit = opts
        .and_then(|o| o.get("pageSize"))
        .and_then(|v| v.as_u64())
        .unwrap_or(100) as usize;
    let current_file = opts
        .and_then(|o| o.get("currentFile"))
        .and_then(|v| v.as_str());

    if let Some(results) = fff_service::fff_file_search(root_uri, query, limit, current_file) {
        return Ok(results);
    }

    let files = list_project_files(root_uri)?;
    fuzzy_match_files_fallback(query, &files, limit)
}

fn fuzzy_match_files_fallback(query: &str, files: &[String], limit: usize) -> Result<Vec<String>, String> {
    let trimmed = query.trim().to_lowercase();
    if trimmed.is_empty() {
        return Ok(files.iter().take(limit).cloned().collect());
    }
    let terms: Vec<&str> = trimmed.split_whitespace().collect();
    let mut scored: Vec<(i32, String)> = Vec::new();
    for path in files {
        let lower = path.to_lowercase();
        let base = path.rsplit('/').next().unwrap_or(path).to_lowercase();
        let mut score = 0i32;
        let mut matched = true;
        for term in &terms {
            if let Some(idx) = lower.find(term) {
                score += idx as i32;
                if base.starts_with(term) {
                    score -= 100;
                }
            } else {
                matched = false;
                break;
            }
        }
        if matched {
            scored.push((score, path.clone()));
        }
    }
    scored.sort_by_key(|(score, _)| *score);
    Ok(scored.into_iter().take(limit).map(|(_, p)| p).collect())
}

pub fn handle(channel: &str, args: &[Value], app: Option<&tauri::AppHandle>) -> Result<Value, String> {
    let root_uri = args.first().and_then(|v| v.as_str()).ok_or("missing rootUri")?;
    match channel {
        "search:listFiles" => {
            let files = list_project_files(root_uri)?;
            if let Some(app) = app {
                super::events::emit_host(
                    app,
                    "workspace:fileIndex",
                    vec![serde_json::json!({ "rootUri": root_uri, "files": files })],
                );
            }
            Ok(serde_json::to_value(files).map_err(|e| e.to_string())?)
        }
        "search:project" => {
            let query = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let opts = args.get(2);
            Ok(serde_json::to_value(project_search(root_uri, query, opts)?).map_err(|e| e.to_string())?)
        }
        "search:fileSearch" => {
            let query = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let opts = args.get(2);
            Ok(serde_json::to_value(file_search(root_uri, query, opts)?).map_err(|e| e.to_string())?)
        }
        "search:trackFileAccess" => {
            let query = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let selected = args.get(2).and_then(|v| v.as_str()).unwrap_or("");
            if !query.is_empty() && !selected.is_empty() {
                fff_service::fff_track_access(root_uri, query, selected);
            }
            Ok(Value::Null)
        }
        "search:isScanReady" => Ok(Value::Bool(is_search_scan_ready(root_uri))),
        "search:isSupported" => Ok(Value::Bool(is_git_workspace(root_uri))),
        _ => Err(format!("unknown search channel: {channel}")),
    }
}

pub fn dispose_search_index(root_uri: &str) {
    fff_service::dispose_fff_index(root_uri);
    if let Ok(mut cache) = file_cache().lock() {
        cache.remove(root_uri);
    }
}
