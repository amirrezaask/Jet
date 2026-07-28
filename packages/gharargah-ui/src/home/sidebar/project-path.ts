function comparableProjectPath(projectPath: string): string {
  const normalized = projectPath
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`)
  return normalized.replace(/^\/private(?=\/(?:var|tmp)(?:\/|$))/, "")
}

export function sameProjectPath(left: string, right: string): boolean {
  return comparableProjectPath(left) === comparableProjectPath(right)
}
