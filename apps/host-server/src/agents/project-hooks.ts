import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import type { AgentProvider } from "@gharargah/agents"

/** Shared forwarder script invoked by Codex/Cursor project hooks. */
export function ensureHookForwarderScript(dataDir?: string): string {
  const root =
    dataDir ??
    process.env.JET_DATA_DIR ??
    path.join(os.homedir(), ".local", "share", "jet")
  const binDir = path.join(root, "bin")
  fs.mkdirSync(binDir, { recursive: true })
  const scriptPath = path.join(binDir, "gharargah-hook-forward.sh")
  const script = `#!/bin/sh
# Gharargah ADE hook forwarder — fire-and-forget; never block Cursor/Codex.
# Sync curl here made the IDE unusable (every tool/edit waited up to 5s).
set -eu
PROVIDER="\${GHARARGAH_PROVIDER:-}"
SESSION_ID="\${GHARARGAH_SESSION_ID:-}"
INGEST_URL="\${GHARARGAH_INGEST_URL:-}"
QUEUE_DIR="\${GHARARGAH_HOOK_QUEUE:-$HOME/.local/share/jet/hook-queue}"
# Drain stdin immediately so the provider can continue.
PAYLOAD="$(cat)"
if [ -z "$INGEST_URL" ] || [ -z "$PROVIDER" ] || [ -z "$SESSION_ID" ]; then
  exit 0
fi
BODY="$PAYLOAD"
(
  CODE=0
  curl --silent --show-error --max-time 2 --request POST \\
    --header "content-type: application/json" \\
    --data-binary "$BODY" \\
    "$INGEST_URL" >/dev/null || CODE=$?
  if [ "$CODE" -ne 0 ]; then
    mkdir -p "$QUEUE_DIR"
    TS="$(date +%s)"
    RAND="$(awk 'BEGIN{srand(); print int(rand()*100000)}')"
    printf '%s\\n' "{\\"meta\\":{\\"provider\\":\\"$PROVIDER\\",\\"sessionId\\":\\"$SESSION_ID\\",\\"ingestUrl\\":\\"$INGEST_URL\\"},\\"payload\\":$BODY}" \\
      > "$QUEUE_DIR/\${TS}-\${RAND}.json" || true
  fi
) >/dev/null 2>&1 &
exit 0
`
  fs.writeFileSync(scriptPath, script, { mode: 0o755 })
  return scriptPath
}

function mergeHookCommand(
  existing: unknown,
  forwarder: string,
): unknown[] {
  const list = Array.isArray(existing) ? [...existing] : []
  const already = list.some((entry) => {
    if (!entry || typeof entry !== "object") return false
    const cmd = (entry as { command?: string }).command
    return typeof cmd === "string" && cmd.includes("gharargah-hook-forward")
  })
  if (!already) {
    list.push({ command: forwarder })
  }
  return list
}

/** Idempotent merge of Gharargah forwarder into project `.codex/hooks.json`. */
export function installCodexProjectHooks(
  projectRoot: string,
  dataDir?: string,
): string {
  const forwarder = ensureHookForwarderScript(dataDir)
  const dir = path.join(projectRoot, ".codex")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "hooks.json")
  let current: { hooks?: Record<string, unknown> } = {}
  if (fs.existsSync(file)) {
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8")) as typeof current
    } catch {
      current = {}
    }
  }
  const hooks = { ...(current.hooks ?? {}) }
  const events = [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "Stop",
  ]
  for (const ev of events) {
    hooks[ev] = [
      {
        hooks: mergeHookCommand(
          Array.isArray(hooks[ev])
            ? (hooks[ev] as unknown[]).flatMap((e) =>
                e && typeof e === "object" && "hooks" in e
                  ? ((e as { hooks: unknown }).hooks as unknown[])
                  : [],
              )
            : [],
          forwarder,
        ),
      },
    ]
  }
  fs.writeFileSync(file, JSON.stringify({ hooks }, null, 2), "utf8")
  return file
}

/** Idempotent merge into project `.cursor/hooks.json`. */
export function installCursorProjectHooks(
  projectRoot: string,
  dataDir?: string,
): string {
  const forwarder = ensureHookForwarderScript(dataDir)
  const dir = path.join(projectRoot, ".cursor")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "hooks.json")
  let current: { version?: number; hooks?: Record<string, unknown[]> } = {
    version: 1,
    hooks: {},
  }
  if (fs.existsSync(file)) {
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8")) as typeof current
    } catch {
      /* keep default */
    }
  }
  const hooks = { ...(current.hooks ?? {}) }
  // High-signal only. afterFileEdit / shell hooks fire constantly and made
  // Cursor IDE unusable when this file is present in the project.
  const events = [
    "sessionStart",
    "sessionEnd",
    "beforeSubmitPrompt",
    "preToolUse",
    "postToolUse",
    "postToolUseFailure",
    "preCompact",
    "stop",
  ]
  const dropSpam = [
    "beforeShellExecution",
    "afterShellExecution",
    "afterFileEdit",
  ]
  for (const ev of dropSpam) {
    if (!Array.isArray(hooks[ev])) continue
    hooks[ev] = (hooks[ev] as unknown[]).filter(entry => {
      if (!entry || typeof entry !== "object") return true
      const cmd = (entry as { command?: string }).command
      return !(typeof cmd === "string" && cmd.includes("gharargah-hook-forward"))
    })
    if ((hooks[ev] as unknown[]).length === 0) delete hooks[ev]
  }
  for (const ev of events) {
    hooks[ev] = mergeHookCommand(hooks[ev], forwarder) as unknown[]
  }
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, hooks }, null, 2),
    "utf8",
  )
  return file
}

/** Write OpenCode project plugin that POSTs events quickly. */
export function installOpenCodePlugin(
  projectRoot: string,
  _dataDir?: string,
): string {
  const dir = path.join(projectRoot, ".opencode", "plugin")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "gharargah-telemetry.js")
  const source = `// Gharargah ADE telemetry plugin — fire-and-forget, never block OpenCode.
export const GharargahTelemetry = async () => {
  return {
    event: async ({ event }) => {
      const url = process.env.GHARARGAH_INGEST_URL
      if (!url) return
      const body = JSON.stringify({ event })
      // Do not await — OpenCode must not stall on Gharargah availability.
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(2000),
      }).catch(() => {})
    },
  }
}
`
  fs.writeFileSync(file, source, "utf8")
  return file
}

export function installProjectHooksForProvider(
  provider: AgentProvider,
  projectRoot: string,
  dataDir?: string,
): string[] {
  switch (provider) {
    case "codex":
      return [installCodexProjectHooks(projectRoot, dataDir)]
    case "cursor":
      return [installCursorProjectHooks(projectRoot, dataDir)]
    case "opencode":
      return [installOpenCodePlugin(projectRoot, dataDir)]
    default:
      return []
  }
}
