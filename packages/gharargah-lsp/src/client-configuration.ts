import type { ConfigurationParams } from "vscode-languageserver-protocol"

/**
 * Gharargah does not expose per-server settings yet. Returning one empty
 * settings object per requested section is still required: gopls treats a
 * missing `workspace/configuration` response as a workspace-load failure.
 */
export function defaultWorkspaceConfiguration(params: ConfigurationParams): object[] {
  return params.items.map(() => ({}))
}
