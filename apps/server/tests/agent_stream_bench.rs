//! Deterministic agent persistence/write-amplification microbench (no UI).
//! Run: `cargo test -p jet --test agent_stream_bench -- --nocapture`

use jet_server::host::agents::{reset_write_thread_metrics, write_thread_metrics, AgentsHost};
use serde_json::json;
use std::time::Instant;
use tempfile::TempDir;

#[test]
fn agent_thread_persist_budget() {
    reset_write_thread_metrics();
    let dir = TempDir::new().expect("tempdir");
    let root = dir.path().to_string_lossy().to_string();
    let host = AgentsHost::new();
    let t0 = Instant::now();
    let thread = host
        .create_thread(&json!({
            "workspaceRootUri": format!("file://{root}"),
            "workspaceRootPath": root,
            "agentId": "cursor",
        }))
        .expect("create");
    let create_ms = t0.elapsed().as_millis();
    let id = thread["id"].as_str().unwrap();

    let mut hydrate_ms = 0u128;
    for _ in 0..20 {
        let t1 = Instant::now();
        let _ = host.read_thread(&root, id).expect("read");
        hydrate_ms += t1.elapsed().as_millis();
    }
    let avg_hydrate = hydrate_ms / 20;
    let (writes, bytes) = write_thread_metrics();

    println!(
        "agent_stream_bench create_ms={create_ms} avg_hydrate_ms={avg_hydrate} writes={writes} bytes={bytes}"
    );
    assert!(
        create_ms < 500,
        "create_thread too slow: {create_ms}ms (local budget)"
    );
    assert!(
        avg_hydrate < 50,
        "thread hydration too slow: {avg_hydrate}ms avg"
    );
    assert!(writes >= 1);
}
