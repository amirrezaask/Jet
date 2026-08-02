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
  gitShow,
  type GitShowRef,
  type GitSummary,
  type GitHistoryCommit,
} from "./git.js"
export { TerminalHost, type TerminalLaunch, type TerminalAttachSnapshot, TERMINAL_FLOW_ACK_CHARS, TERMINAL_FLOW_HIGH_WATERMARK_CHARS, TERMINAL_FLOW_LOW_WATERMARK_CHARS } from "./terminal.js"
export { makeTerminalHostScoped } from "./effect-terminal.js"
export { openInApp, revealInFolder } from "./shell.js"
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
export {
  listAgentCliHistory,
  parseCodexThreadListResponse,
  parseGrokSessionList,
  parseOpenCodeSessionList,
  type AgentCliHistoryAdapters,
} from "./agent-cli-history.js"
export {
  applyLoginShellEnv,
  enrichProcessPath,
  resolveLoginShellPath,
} from "./shell-env.js"
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
  createLspRestartHelper,
  LspFramingDecoder,
  encodeLspMessage,
  type LspSession,
  type StartLspSessionOptions,
  type StartLspSessionResult,
  type LspRestartPolicy,
  type LspRestartHelper,
} from "./lsp-bridge.js"
export {
  getLanguageServerDefinition,
  resolveLanguageServerCommand,
  serverIdForLanguage,
  listLanguageServerDefinitions,
  findExecutableOnPath,
  resetLanguageServerRegistryForTests,
  type LanguageServerDefinition,
} from "./lsp-registry.js"
