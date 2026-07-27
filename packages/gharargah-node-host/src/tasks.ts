import { spawn } from "node:child_process"

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
      output += chunk.toString()
    })
    proc.stderr.on("data", chunk => {
      output += chunk.toString()
    })
    proc.on("error", reject)
    proc.on("close", code => {
      resolve({ exitCode: code ?? 1, output })
    })
  })
}
