pub mod app;
pub mod config;
pub mod host;
pub mod mock_acp;
pub mod persistence;
pub mod static_files;

use anyhow::Context;
use clap::Parser;
use config::{Cli, Config};
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

pub async fn run() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let config = Config::load(cli)?;
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new(config.log_filter.clone()))
        .try_init()
        .ok();

    std::fs::create_dir_all(&config.data_dir)
        .with_context(|| format!("cannot create data directory {}", config.data_dir.display()))?;
    let database = persistence::Database::open(config.data_dir.join("jet.sqlite3"))?;
    let state = Arc::new(app::AppState::new(config.clone(), database)?);
    let router = app::router(state.clone());
    let address = config.socket_addr()?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .with_context(|| format!("cannot bind Jet to {address}"))?;
    let url = config.public_url();
    println!("Jet is running at {url}");
    if !config.is_loopback() {
        eprintln!("Warning: Jet is listening on {} without authentication.\nAnyone with network access to this port can control this machine through Jet.", config.host);
    }
    if config.open_browser {
        if let Err(error) = open::that(&url) {
            tracing::warn!(%error, "could not open browser");
        }
    }

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal(state))
        .await
        .context("Jet server failed")
}

async fn shutdown_signal(state: Arc<app::AppState>) {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    state.host.events.emit("server:shuttingDown", vec![]);
    state.host.shutdown();
}
