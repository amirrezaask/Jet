export type JetProblemSeverity = "error" | "warning" | "info"

export type JetProblem = {
  uri: string
  path: string
  line: number
  column: number
  severity: JetProblemSeverity
  message: string
  source?: string
}
