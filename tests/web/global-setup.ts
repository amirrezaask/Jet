import { execFileSync } from "node:child_process"

export default function globalSetup(): void {
  if (process.env.JET_SKIP_E2E_BUILD === "1") return
  execFileSync("pnpm", ["--filter", "yaade", "build"], { stdio: "inherit" })
}
