import { getGitWorker } from "./background-pool.js"
import type { HostRegistry } from "./registry.js"

export function registerGitHandlers(registry: HostRegistry): void {
  registry.handle("git:isRepo", async args =>
    getGitWorker().dispatch<boolean>("isRepo", { rootUri: args[0] }),
  )
  registry.handle("git:status", async args => getGitWorker().dispatch("status", { rootUri: args[0] }))
  registry.handle("git:diff", async args =>
    getGitWorker().dispatch<string>("diff", {
      rootUri: args[0],
      ...(args[1] as { path?: string; staged?: boolean } | undefined),
    }),
  )
  registry.handle("git:branch", async args =>
    getGitWorker().dispatch<string | null>("branch", { rootUri: args[0] }),
  )
  registry.handle("git:stage", async args => {
    await getGitWorker().dispatch<void>("stage", { rootUri: args[0], paths: args[1] })
  })
  registry.handle("git:unstage", async args => {
    await getGitWorker().dispatch<void>("unstage", { rootUri: args[0], paths: args[1] })
  })
  registry.handle("git:commit", async args => {
    await getGitWorker().dispatch<void>("commit", { rootUri: args[0], message: args[1] })
  })
  registry.handle("git:branches", async args =>
    getGitWorker().dispatch<string[]>("branches", { rootUri: args[0] }),
  )
}
