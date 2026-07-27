export { uriToPath, pathToUri, readFile, writeFile, writeTempDrop, readDir, stat } from "./fs.js"
export {
  gitIsRepo,
  gitStatus,
  gitDiff,
  gitBranch,
  gitSummary,
  gitHistory,
  gitStage,
  gitUnstage,
  gitCommit,
  gitCommitWithBody,
  gitBranches,
  gitCheckout,
  gitDiscard,
  gitFetch,
  gitPull,
  gitPush,
} from "./git.js"
export { TerminalHost, type TerminalLaunch, type TerminalAttachSnapshot } from "./terminal.js"
export { openInApp } from "./shell.js"
export { spawnTask, type TaskSpawnRequest, type TaskSpawnResult } from "./tasks.js"
export { PerfHost } from "./perf.js"
export {
  projectSearch,
  listProjectFiles,
  fileSearch,
  trackFileAccess,
  ensureFffIndex,
  isFffScanReady,
  isGitWorkspace,
  isSearchScanReady,
} from "./search.js"
export { probeFffAvailable, isFffAvailable, disposeFffIndex } from "./fff-service.js"
export { assertAllowedPath, assertAllowedUri, normalizeRoots } from "./sandbox.js"
export { loadGlobalGharargahrcScanRoots } from "./global-gharargahrc.js"
export { applyLoginShellEnv, resolveLoginShellPath } from "./shell-env.js"
export {
  findWorkspaceRoot,
  resolveLaunchTarget,
  WORKSPACE_MARKERS,
  type LaunchConfig,
} from "./resolve-launch.js"
export {
  startLspSession,
  stopLspSession,
  stopAllLspSessions,
  setLspCrashHandler,
  getLspSession,
  type LspSession,
  type StartLspSessionOptions,
} from "./lsp-bridge.js"
