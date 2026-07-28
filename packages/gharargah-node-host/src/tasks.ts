import { spawn } from "node:child_process"

const MAX_TASK_OUTPUT = 8 * 1024 * 1024

export function appendBoundedTaskOutput(current: string, chunk: string): string {
  const combined = `${current}${chunk}`
  if (Buffer.byteLength(combined, "utf8") <= MAX_TASK_OUTPUT) return combined
  const bytes = Buffer.from(combined, "utf8")
  let start = bytes.length - MAX_TASK_OUTPUT
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1
  return bytes.subarray(start).toString("utf8")
}

export type TaskSpawnRequest = {
  command: string
  args?: string[]
  cwd: string
}

export type TaskSpawnResult = {
  exitCode: number
  output: string
}

export function spawnTask(req: TaskSpawnRequest): Promise<TaskSpawnResult> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32"
    const command = isWin ? "cmd" : req.command
    const args = isWin ? ["/C", req.command, ...(req.args ?? [])] : (req.args ?? [])
    const proc = spawn(command, args, {
      cwd: req.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    })
    let output = ""
    proc.stdout.on("data", chunk => {
      output = appendBoundedTaskOutput(output, chunk.toString())
    })
    proc.stderr.on("data", chunk => {
      output = appendBoundedTaskOutput(output, chunk.toString())
    })
    proc.on("error", reject)
    proc.on("close", code => {
      resolve({ exitCode: code ?? 1, output })
    })
  })
}
