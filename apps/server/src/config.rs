use anyhow::{anyhow, Context};
use clap::Parser;
use serde::Deserialize;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};

#[derive(Debug, Parser)]
#[command(name = "jet", about = "Jet project and agent command center")]
pub struct Cli {
    #[arg(long, env = "JET_CONFIG")]
    pub config: Option<PathBuf>,
    #[arg(long, env = "JET_HOST")]
    pub host: Option<String>,
    #[arg(long, env = "JET_PORT")]
    pub port: Option<u16>,
    #[arg(long, env = "JET_DATA_DIR")]
    pub data_dir: Option<PathBuf>,
    #[arg(long, env = "JET_ALLOWED_ROOTS", value_delimiter = ',')]
    pub allowed_roots: Vec<PathBuf>,
    #[arg(long, env = "JET_OPEN_BROWSER", default_value_t = false)]
    pub open: bool,
    #[arg(long, env = "JET_LOG")]
    pub log: Option<String>,
    #[arg(value_name = "PATH")]
    pub path: Option<PathBuf>,
}

#[derive(Default, Deserialize)]
struct ConfigFile {
    server: Option<ServerFile>,
    storage: Option<StorageFile>,
    filesystem: Option<FilesystemFile>,
    logging: Option<LoggingFile>,
}

#[derive(Default, Deserialize)]
struct ServerFile {
    host: Option<String>,
    port: Option<u16>,
    open_browser: Option<bool>,
}
#[derive(Default, Deserialize)]
struct StorageFile {
    data_dir: Option<PathBuf>,
}
#[derive(Default, Deserialize)]
struct FilesystemFile {
    allowed_roots: Option<Vec<PathBuf>>,
}
#[derive(Default, Deserialize)]
struct LoggingFile {
    filter: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub data_dir: PathBuf,
    pub allowed_roots: Vec<PathBuf>,
    pub open_browser: bool,
    pub log_filter: String,
    pub launch_path: PathBuf,
}

impl Config {
    pub fn load(cli: Cli) -> anyhow::Result<Self> {
        let home = dirs::home_dir().ok_or_else(|| anyhow!("cannot determine home directory"))?;
        let file = match cli.config.as_ref() {
            Some(path) => toml::from_str::<ConfigFile>(
                &std::fs::read_to_string(path)
                    .with_context(|| format!("cannot read config {}", path.display()))?,
            )
            .context("invalid Jet config")?,
            None => ConfigFile::default(),
        };
        let data_dir = expand_home(
            cli.data_dir
                .or_else(|| file.storage.and_then(|v| v.data_dir))
                .unwrap_or_else(|| home.join(".local/share/jet")),
            &home,
        );
        let roots = if !cli.allowed_roots.is_empty() {
            cli.allowed_roots
        } else {
            file.filesystem
                .and_then(|v| v.allowed_roots)
                .unwrap_or_else(|| vec![home.clone()])
        };
        let mut allowed_roots = Vec::with_capacity(roots.len());
        for root in roots.into_iter().map(|path| expand_home(path, &home)) {
            allowed_roots.push(
                root.canonicalize()
                    .with_context(|| format!("allowed root does not exist: {}", root.display()))?,
            );
        }
        let launch_path = cli
            .path
            .unwrap_or(std::env::current_dir().context("cannot determine current directory")?);
        let launch_path = launch_path.canonicalize().unwrap_or(launch_path);
        Ok(Self {
            host: cli
                .host
                .or_else(|| file.server.as_ref().and_then(|v| v.host.clone()))
                .unwrap_or_else(|| "127.0.0.1".to_string()),
            port: cli
                .port
                .or_else(|| file.server.as_ref().and_then(|v| v.port))
                .unwrap_or(4747),
            data_dir,
            allowed_roots,
            open_browser: cli.open
                || file
                    .server
                    .as_ref()
                    .and_then(|v| v.open_browser)
                    .unwrap_or(false),
            log_filter: cli
                .log
                .or_else(|| file.logging.and_then(|v| v.filter))
                .unwrap_or_else(|| "jet=info,tower_http=info".to_string()),
            launch_path,
        })
    }

    pub fn socket_addr(&self) -> anyhow::Result<SocketAddr> {
        let ip: IpAddr = self.host.parse().context("host must be an IP address")?;
        Ok(SocketAddr::new(ip, self.port))
    }

    pub fn public_url(&self) -> String {
        let host = if self.host == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &self.host
        };
        format!("http://{host}:{}", self.port)
    }

    pub fn is_loopback(&self) -> bool {
        self.host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
    }

    pub fn path_allowed(&self, raw: &Path) -> bool {
        canonicalize_existing_ancestor(raw)
            .is_some_and(|path| self.allowed_roots.iter().any(|root| path.starts_with(root)))
    }
}

fn expand_home(path: PathBuf, home: &Path) -> PathBuf {
    if path == Path::new("~") {
        return home.to_path_buf();
    }
    path.strip_prefix("~")
        .map(|suffix| home.join(suffix))
        .unwrap_or(path)
}

fn canonicalize_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut candidate = path.to_path_buf();
    while !candidate.exists() {
        candidate = candidate.parent()?.to_path_buf();
    }
    candidate.canonicalize().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_existing_ancestor_prevents_write_escape() {
        let root = tempfile::tempdir().unwrap();
        let config = Config {
            host: "127.0.0.1".into(),
            port: 1,
            data_dir: root.path().into(),
            allowed_roots: vec![root.path().canonicalize().unwrap()],
            open_browser: false,
            log_filter: "info".into(),
            launch_path: root.path().into(),
        };
        assert!(config.path_allowed(&root.path().join("new/file.txt")));
        assert!(!config.path_allowed(Path::new("/etc/passwd")));
    }
}
