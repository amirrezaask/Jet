use serde_json::Value;
use std::process::Command;

use super::uri::file_uri_to_path;

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(if stderr.is_empty() {
            format!("git exit {:?}", output.status.code())
        } else {
            stderr.to_string()
        })
    }
}

pub fn git_is_repo(root_uri: &str) -> bool {
    let cwd = file_uri_to_path(root_uri);
    run_git(&cwd, &["rev-parse", "--is-inside-work-tree"]).is_ok()
}

pub fn git_status(root_uri: &str) -> Result<Vec<Value>, String> {
    let cwd = file_uri_to_path(root_uri);
    let out = run_git(&cwd, &["status", "--porcelain", "-u"])?;
    let mut entries = Vec::new();
    for line in out.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let index = line.chars().next().unwrap_or(' ');
        let work = line.chars().nth(1).unwrap_or(' ');
        let mut rest = line.get(3..).unwrap_or("").trim().to_string();
        let mut original_path: Option<String> = None;
        if let Some((from, to)) = rest.split_once(" -> ") {
            original_path = Some(from.to_string());
            rest = to.to_string();
        }
        let code = format!("{index}{work}");
        let status = if code == "??" {
            "untracked"
        } else if code.contains('A') {
            "added"
        } else if code.contains('D') {
            "deleted"
        } else if code.contains('R') {
            "renamed"
        } else if code.contains('U') {
            "conflict"
        } else {
            "modified"
        };
        let mut entry = serde_json::json!({ "path": rest, "status": status });
        if let Some(op) = original_path {
            entry["originalPath"] = Value::String(op);
        }
        entries.push(entry);
    }
    Ok(entries)
}

pub fn git_diff(root_uri: &str, opts: Option<&Value>) -> Result<String, String> {
    let cwd = file_uri_to_path(root_uri);
    let mut args = vec!["diff"];
    if let Some(opts) = opts {
        if opts.get("staged").and_then(|v| v.as_bool()) == Some(true) {
            args.push("--cached");
        }
        if let Some(path) = opts.get("path").and_then(|v| v.as_str()) {
            args.push("--");
            args.push(path);
        }
    }
    run_git(&cwd, &args)
}

pub fn git_branch(root_uri: &str) -> Option<String> {
    let cwd = file_uri_to_path(root_uri);
    run_git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn git_branches(root_uri: &str) -> Result<Vec<String>, String> {
    let cwd = file_uri_to_path(root_uri);
    let out = run_git(&cwd, &["branch", "--format=%(refname:short)"])?;
    Ok(out
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect())
}

pub fn git_stage(root_uri: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let cwd = file_uri_to_path(root_uri);
    let mut args = vec!["add", "--"];
    for p in paths {
        args.push(p.as_str());
    }
    run_git(&cwd, &args).map(|_| ())
}

pub fn git_unstage(root_uri: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let cwd = file_uri_to_path(root_uri);
    let mut args = vec!["restore", "--staged", "--"];
    for p in paths {
        args.push(p.as_str());
    }
    run_git(&cwd, &args).map(|_| ())
}

pub fn git_commit(root_uri: &str, message: &str) -> Result<(), String> {
    let cwd = file_uri_to_path(root_uri);
    run_git(&cwd, &["commit", "-m", message]).map(|_| ())
}

pub fn handle(channel: &str, args: &[Value]) -> Result<Value, String> {
    let root_uri = args.first().and_then(|v| v.as_str()).ok_or("missing rootUri")?;
    match channel {
        "git:isRepo" => Ok(Value::Bool(git_is_repo(root_uri))),
        "git:status" => Ok(Value::Array(git_status(root_uri)?)),
        "git:diff" => {
            let opts = args.get(1);
            Ok(Value::String(git_diff(root_uri, opts)?))
        }
        "git:branch" => Ok(match git_branch(root_uri) {
            Some(b) => Value::String(b),
            None => Value::Null,
        }),
        "git:branches" => Ok(Value::Array(
            git_branches(root_uri)?
                .into_iter()
                .map(Value::String)
                .collect(),
        )),
        "git:stage" => {
            let paths: Vec<String> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            git_stage(root_uri, &paths)?;
            Ok(Value::Null)
        }
        "git:unstage" => {
            let paths: Vec<String> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            git_unstage(root_uri, &paths)?;
            Ok(Value::Null)
        }
        "git:commit" => {
            let message = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            git_commit(root_uri, message)?;
            Ok(Value::Null)
        }
        _ => Err(format!("unknown git channel: {channel}")),
    }
}
