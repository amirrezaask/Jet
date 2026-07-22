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
        let conflict = code.contains('U') || matches!(code.as_str(), "AA" | "DD");
        let status = if conflict {
            "conflict"
        } else if code == "??" {
            "untracked"
        } else if work == 'A' || (work == ' ' && index == 'A') {
            "added"
        } else if work == 'D' || (work == ' ' && index == 'D') {
            "deleted"
        } else if work == 'R' || (work == ' ' && index == 'R') {
            "renamed"
        } else {
            "modified"
        };
        let staged = index != ' ' && index != '?';
        let unstaged = work != ' ' || code == "??";
        let mut entry = serde_json::json!({
            "path": rest,
            "status": status,
            "staged": staged,
            "unstaged": unstaged,
        });
        if staged {
            entry["indexStatus"] = Value::String(status_for_char(index).to_string());
        }
        if unstaged {
            entry["worktreeStatus"] = Value::String(status_for_char(work).to_string());
        }
        if let Some(op) = original_path {
            entry["originalPath"] = Value::String(op);
        }
        entries.push(entry);
    }
    Ok(entries)
}

fn status_for_char(code: char) -> &'static str {
    match code {
        '?' => "untracked",
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'U' => "conflict",
        _ => "modified",
    }
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

pub fn git_summary(root_uri: &str) -> Value {
    let cwd = file_uri_to_path(root_uri);
    let branch = git_branch(root_uri);
    let upstream = run_git(
        &cwd,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
    let (behind, ahead) = if upstream.is_some() {
        run_git(
            &cwd,
            &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
        )
        .ok()
        .and_then(|counts| {
            let mut parts = counts.split_whitespace();
            Some((
                parts.next()?.parse::<u64>().ok()?,
                parts.next()?.parse::<u64>().ok()?,
            ))
        })
        .unwrap_or((0, 0))
    } else {
        (0, 0)
    };
    serde_json::json!({
        "branch": branch,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
    })
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
    if message.trim().is_empty() {
        return Err("commit summary is required".to_string());
    }
    let cwd = file_uri_to_path(root_uri);
    run_git(&cwd, &["commit", "-m", message]).map(|_| ())
}

pub fn git_commit_with_body(
    root_uri: &str,
    summary: &str,
    body: Option<&str>,
) -> Result<(), String> {
    if summary.trim().is_empty() {
        return Err("commit summary is required".to_string());
    }
    let cwd = file_uri_to_path(root_uri);
    match body.map(str::trim).filter(|body| !body.is_empty()) {
        Some(body) => run_git(&cwd, &["commit", "-m", summary.trim(), "-m", body]).map(|_| ()),
        None => git_commit(root_uri, summary.trim()),
    }
}

pub fn git_checkout(root_uri: &str, branch: &str) -> Result<(), String> {
    if branch.trim().is_empty() {
        return Err("branch is required".to_string());
    }
    let cwd = file_uri_to_path(root_uri);
    run_git(&cwd, &["checkout", branch]).map(|_| ())
}

pub fn git_discard(root_uri: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let cwd = file_uri_to_path(root_uri);
    let mut args = vec!["restore", "--worktree", "--"];
    for path in paths {
        args.push(path.as_str());
    }
    run_git(&cwd, &args).map(|_| ())
}

fn git_remote_action(root_uri: &str, action: &str) -> Result<(), String> {
    let cwd = file_uri_to_path(root_uri);
    run_git(&cwd, &[action]).map(|_| ())
}

pub fn git_history(root_uri: &str, limit: usize) -> Result<Vec<Value>, String> {
    let cwd = file_uri_to_path(root_uri);
    let capped = limit.clamp(1, 200);
    let limit_arg = format!("-n{capped}");
    let out = run_git(
        &cwd,
        &[
            "log",
            limit_arg.as_str(),
            "--format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e",
        ],
    )?;
    let mut commits = Vec::new();
    for record in out.split('\u{1e}') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        let mut fields = record.split('\u{1f}');
        let Some(hash) = fields.next() else { continue };
        let Some(short_hash) = fields.next() else {
            continue;
        };
        let Some(author) = fields.next() else {
            continue;
        };
        let authored_at = fields
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0)
            .saturating_mul(1000);
        let subject = fields.next().unwrap_or_default();
        commits.push(serde_json::json!({
            "hash": hash,
            "shortHash": short_hash,
            "author": author,
            "authoredAt": authored_at,
            "subject": subject,
        }));
    }
    Ok(commits)
}

pub fn handle(channel: &str, args: &[Value]) -> Result<Value, String> {
    let root_uri = args
        .first()
        .and_then(|v| v.as_str())
        .ok_or("missing rootUri")?;
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
        "git:summary" => Ok(git_summary(root_uri)),
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
        "git:discard" => {
            let paths: Vec<String> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            git_discard(root_uri, &paths)?;
            Ok(Value::Null)
        }
        "git:commit" => {
            let summary = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let body = args.get(2).and_then(|v| v.as_str());
            git_commit_with_body(root_uri, summary, body)?;
            Ok(Value::Null)
        }
        "git:checkout" => {
            let branch = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            git_checkout(root_uri, branch)?;
            Ok(Value::Null)
        }
        "git:fetch" | "git:pull" | "git:push" => {
            let action = channel.strip_prefix("git:").unwrap_or_default();
            git_remote_action(root_uri, action)?;
            Ok(Value::Null)
        }
        "git:history" => {
            let limit = args.get(1).and_then(|v| v.as_u64()).unwrap_or(50) as usize;
            Ok(Value::Array(git_history(root_uri, limit)?))
        }
        _ => Err(format!("unknown git channel: {channel}")),
    }
}
