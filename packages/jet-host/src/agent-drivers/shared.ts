import type { TurnEvent } from "@jet/agents"
import { parseStreamJsonLine, splitStreamJsonBuffer } from "@jet/agents"
import { spawn, type ChildProcess } from "node:child_process"

export type StreamJsonDriverInput = {
  command: string
  args: string[]
  cwd: string
  assistantMessageId: string
  signal: AbortSignal
  onEvent: (event: TurnEvent) => void
}

export function runStreamJsonCli(input: StreamJsonDriverInput): Promise<void> {
  return new Promise(resolve => {
    let child: ChildProcess | null = null
    let buffer = ""
    let finished = false

    const finish = () => {
      if (finished) return
      finished = true
      resolve()
    }

    const onAbort = () => {
      child?.kill("SIGTERM")
    }

    if (input.signal.aborted) {
      input.onEvent({ kind: "turn-error", message: "Turn interrupted" })
      finish()
      return
    }

    input.signal.addEventListener("abort", onAbort, { once: true })

    child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")

    child.stdout?.on("data", chunk => {
      buffer += String(chunk)
      const { lines, rest } = splitStreamJsonBuffer(buffer)
      buffer = rest
      for (const line of lines) {
        const event = parseStreamJsonLine(line, input.assistantMessageId)
        if (event) input.onEvent(event)
      }
    })

    let stderr = ""
    child.stderr?.on("data", chunk => {
      stderr += String(chunk)
    })

    child.on("error", error => {
      input.onEvent({
        kind: "turn-error",
        message: error instanceof Error ? error.message : String(error),
      })
      finish()
    })

    child.on("close", code => {
      input.signal.removeEventListener("abort", onAbort)
      if (buffer.trim()) {
        const event = parseStreamJsonLine(buffer, input.assistantMessageId)
        if (event) input.onEvent(event)
      }
      if (input.signal.aborted) {
        input.onEvent({ kind: "turn-error", message: "Turn interrupted" })
        finish()
        return
      }
      if (code !== 0) {
        const message = stderr.trim() || `Agent exited with code ${code ?? "unknown"}`
        input.onEvent({ kind: "turn-error", message })
        finish()
        return
      }
      input.onEvent({ kind: "turn-complete" })
      finish()
    })
  })
}

export function resolveBinary(candidates: string[]): string {
  return candidates[0] ?? candidates[candidates.length - 1] ?? "agent"
}
