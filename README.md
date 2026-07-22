# Jet

Jet is a project-oriented agent workspace and command center. It is delivered as one Rust executable: the process owns files, terminals, agents, Git, search, and language servers while serving the React application and its same-origin HTTP/WebSocket APIs.

## Build and run

Requirements for building are Rust, Node.js, and pnpm. Production does not require Node.js.

```bash
pnpm install
pnpm build
./apps/server/target/release/jet
```

The server prints its address, normally `http://127.0.0.1:4747`. The release executable contains the compiled frontend; there is no adjacent asset directory or production Node process.

Useful options:

```bash
jet --host 127.0.0.1 --port 4747
jet --data-dir ~/.local/share/jet
jet --config ~/.config/jet/config.toml
jet --open
jet --host 0.0.0.0 --port 4747
```

Binding a non-loopback address exposes a process that can read and write allowed files, run commands, operate Git, and control agent CLIs. Jet has deliberately no authentication. Only expose it on a network whose access is controlled by the operator.

## Configuration

Precedence is command-line arguments, environment variables, configuration file, then defaults. Supported environment variables include `JET_HOST`, `JET_PORT`, `JET_DATA_DIR`, `JET_ALLOWED_ROOTS` (comma-separated), `JET_LOG`, `JET_OPEN_BROWSER`, and `JET_CONFIG`.

```toml
[server]
host = "127.0.0.1"
port = 4747
open_browser = false

[storage]
data_dir = "~/.local/share/jet"

[filesystem]
allowed_roots = ["~/projects"]

[logging]
filter = "jet=info,tower_http=info"
```

Filesystem access is restricted to canonicalized allowed roots. Project file APIs accept project-relative paths and reject absolute paths, parent traversal, and symlink escapes.

## Development and tests

`pnpm dev` runs Vite with HMR and the Rust API server. Vite proxies `/api`, `/health`, and `/ws`; production always uses the Rust-served build.

```bash
pnpm -r typecheck
pnpm test
pnpm test:server
pnpm test:e2e
```

Browser tests start isolated Jet server processes with temporary databases and Chromium profiles. They do not use the developer's project catalog or agent state.
