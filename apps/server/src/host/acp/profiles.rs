use super::bounds::MAX_RESTARTS;
use super::types::AcpError;
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RestartPolicy {
    Never,
    OnFailure { max_restarts: u32 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderProfile {
    pub id: &'static str,
    pub executable: &'static str,
    pub spawn_args: Vec<String>,
    pub initialize_timeout: Duration,
    pub turn_timeout: Duration,
    pub stop_timeout: Duration,
    pub restart_policy: RestartPolicy,
    pub quirks: Vec<&'static str>,
    pub is_mock: bool,
}

impl ProviderProfile {
    pub fn resolve_executable(&self) -> Result<PathBuf, AcpError> {
        if self.is_mock {
            if let Some(path) = env::var_os("GHARARGAH_MOCK_ACP_BIN") {
                return Ok(PathBuf::from(path));
            }
            let current = env::current_exe().map_err(|error| AcpError::Profile {
                provider_id: self.id.to_string(),
                message: format!("cannot resolve current executable: {error}"),
            })?;
            let sibling = current.with_file_name("gharargah-mock-acp");
            if sibling.is_file() {
                return Ok(sibling);
            }
            return Err(AcpError::Profile {
                provider_id: self.id.to_string(),
                message: format!(
                    "mock binary missing at {} (set GHARARGAH_MOCK_ACP_BIN)",
                    sibling.display()
                ),
            });
        }

        lookpath(self.executable).ok_or_else(|| AcpError::Profile {
            provider_id: self.id.to_string(),
            message: format!("{} not found on PATH", self.executable),
        })
    }
}

fn lookpath(cmd: &str) -> Option<PathBuf> {
    let as_path = Path::new(cmd);
    if as_path.is_absolute() || cmd.contains('/') || cmd.contains('\\') {
        return as_path.is_file().then(|| as_path.to_path_buf());
    }
    let path_env = env::var_os("PATH")?;
    for dir in env::split_paths(&path_env) {
        let candidate = dir.join(cmd);
        if is_executable_candidate(&candidate) {
            return Some(candidate);
        }
        #[cfg(target_os = "windows")]
        {
            for ext in ["exe", "cmd", "bat", "com"] {
                let with_ext = dir.join(format!("{cmd}.{ext}"));
                if is_executable_candidate(&with_ext) {
                    return Some(with_ext);
                }
            }
        }
    }
    None
}

fn is_executable_candidate(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn profile(
    id: &'static str,
    executable: &'static str,
    spawn_args: &[&str],
    quirks: &[&'static str],
    is_mock: bool,
) -> ProviderProfile {
    ProviderProfile {
        id,
        executable,
        spawn_args: spawn_args.iter().map(|arg| (*arg).to_string()).collect(),
        initialize_timeout: Duration::from_secs(120),
        turn_timeout: Duration::from_secs(15 * 60),
        stop_timeout: Duration::from_secs(15),
        restart_policy: RestartPolicy::OnFailure {
            max_restarts: MAX_RESTARTS,
        },
        quirks: quirks.to_vec(),
        is_mock,
    }
}

pub fn cursor_acp() -> ProviderProfile {
    profile(
        "cursor-acp",
        "cursor-agent",
        &["acp"],
        &["permission requests may arrive during a tool update"],
        false,
    )
}

pub fn codex_acp() -> ProviderProfile {
    profile(
        "codex-acp",
        "codex",
        &["acp"],
        &["tool updates can omit a title"],
        false,
    )
}

pub fn claude_acp() -> ProviderProfile {
    profile(
        "claude-acp",
        "claude",
        &["--acp"],
        &["authentication can require interactive completion"],
        false,
    )
}

pub fn opencode_acp() -> ProviderProfile {
    profile(
        "opencode-acp",
        "opencode",
        &["acp"],
        &["session configuration may be unavailable"],
        false,
    )
}

pub fn grok_acp() -> ProviderProfile {
    profile(
        "grok-acp",
        "grok",
        &["agent", "stdio"],
        &["uses grok agent stdio ACP transport"],
        false,
    )
}

pub fn mock_strict() -> ProviderProfile {
    profile(
        "mock-strict",
        "gharargah-mock-acp",
        &["--scenario", "echo", "--strict"],
        &["rejects malformed protocol messages"],
        true,
    )
}

pub fn mock_compat() -> ProviderProfile {
    profile(
        "mock-compat",
        "gharargah-mock-acp",
        &["--scenario", "echo"],
        &["emits compatibility-shaped updates"],
        true,
    )
}

pub fn mock_chaos() -> ProviderProfile {
    profile(
        "mock-chaos",
        "gharargah-mock-acp",
        &["--scenario", "chaos_malformed", "--strict"],
        &["reorders non-dependent updates and simulates disconnects"],
        true,
    )
}

pub fn all_profiles() -> Vec<ProviderProfile> {
    vec![
        cursor_acp(),
        codex_acp(),
        claude_acp(),
        opencode_acp(),
        grok_acp(),
        mock_strict(),
        mock_compat(),
        mock_chaos(),
    ]
}

/// Resolve the ACP launch profile for a catalog agent id.
/// `cursor-acp` and `cursor` both map to the Cursor ACP profile.
pub fn profile_for_agent(agent_id: &str) -> Option<ProviderProfile> {
    match agent_id {
        "cursor" | "cursor-acp" | "cursorAcp" => Some(cursor_acp()),
        "codex" | "codex-acp" => Some(codex_acp()),
        "claude" | "claude-acp" | "claudeAgent" => Some(claude_acp()),
        "opencode" | "opencode-acp" => Some(opencode_acp()),
        "grok" | "grok-acp" => Some(grok_acp()),
        _ => None,
    }
}

pub fn acp_profile_id_for_agent(agent_id: &str) -> Option<&'static str> {
    profile_for_agent(agent_id).map(|profile| profile.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn resolve_executable_finds_bare_name_on_path() {
        let dir = env::temp_dir().join(format!("gharargah-acp-lookpath-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("gharargah-fake-acp");
        fs::write(&bin, b"#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            let mut perms = fs::metadata(&bin).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&bin, perms).unwrap();
        }

        let prev = env::var_os("PATH");
        let mut paths = vec![dir.clone()];
        if let Some(ref p) = prev {
            paths.extend(env::split_paths(p));
        }
        env::set_var("PATH", env::join_paths(&paths).unwrap());

        let profile = profile("fake-acp", "gharargah-fake-acp", &[], &[], false);
        let resolved = profile.resolve_executable().unwrap();
        assert_eq!(resolved, bin);

        if let Some(p) = prev {
            env::set_var("PATH", p);
        } else {
            env::remove_var("PATH");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_executable_rejects_missing_bare_name() {
        let profile = profile(
            "missing-acp",
            "gharargah-definitely-missing-acp-bin-xyz",
            &[],
            &[],
            false,
        );
        let err = profile.resolve_executable().unwrap_err().to_string();
        assert!(err.contains("not found on PATH"), "unexpected: {err}");
    }

    #[test]
    fn profile_for_agent_maps_catalog_ids() {
        assert_eq!(profile_for_agent("cursor").unwrap().id, "cursor-acp");
        assert_eq!(profile_for_agent("cursor-acp").unwrap().id, "cursor-acp");
        assert_eq!(profile_for_agent("codex").unwrap().id, "codex-acp");
        assert_eq!(profile_for_agent("claude").unwrap().id, "claude-acp");
        assert_eq!(profile_for_agent("opencode").unwrap().id, "opencode-acp");
        assert!(profile_for_agent("unknown").is_none());
    }
}
