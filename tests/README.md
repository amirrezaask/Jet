# Browser verification

The historical `tests/electron/` directory contains the shared product scenarios; the name is retained to avoid a noisy move. The suite now drives Chromium against the standalone Rust server.

```bash
pnpm test:e2e
GHARARGAH_HEADED=1 pnpm test:e2e
pnpm test:bench
```

Global setup builds the React frontend and debug Rust executable. Every scenario launches one Rust process on a free loopback port with a temporary data directory. Test projects are restricted to repository fixtures through `JET_ALLOWED_ROOTS`.

Failures retain Playwright traces, screenshots, video, browser console output, and server logs. New UI or browser-visible behavior must include scoped DOM assertions and runtime verification; query echoes do not count as result-list proof.
