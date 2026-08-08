import type { ProjectSessionSummary } from "@yaade/rpc"
import type { GitCommit } from "@yaade/shared"
import { pathToFileUri } from "@yaade/shared"

const README_NAMES = new Set(["readme.md", "readme"])

export type DashboardField<T> = {
  value: T
  error: string | null
}

export type ProjectDashboard = {
  readme: DashboardField<string | null>
  sessions: DashboardField<ProjectSessionSummary[]>
  isGitRepo: DashboardField<boolean>
  branch: DashboardField<string | null>
  branches: DashboardField<string[] | null>
  history: DashboardField<GitCommit[] | null>
}

type DashboardFs = {
  readDir(uri: string): Promise<Array<{ name: string; isDirectory: boolean }>>
  readFile(uri: string): Promise<string>
}

type DashboardGit = {
  isRepo(rootUri: string): Promise<boolean>
  branch(rootUri: string): Promise<string | null>
  branches(rootUri: string): Promise<string[]>
  history(rootUri: string, limit?: number): Promise<GitCommit[]>
}

export type ProjectDashboardDependencies = {
  fs?: DashboardFs
  git?: DashboardGit
  listSessions: () => Promise<ProjectSessionSummary[]>
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

async function settle<T>(
  operation: () => Promise<T>,
  fallback: T,
  message: string,
): Promise<DashboardField<T>> {
  try {
    return { value: await operation(), error: null }
  } catch (error) {
    return { value: fallback, error: errorMessage(error, message) }
  }
}

async function readProjectReadme(
  projectPath: string,
  fs: DashboardFs | undefined,
): Promise<string | null> {
  if (!fs) return null
  const rootUri = pathToFileUri(projectPath)
  const entries = await fs.readDir(rootUri)
  const name = entries.find(
    entry => !entry.isDirectory && README_NAMES.has(entry.name.toLowerCase()),
  )?.name
  if (!name) return null
  const text = await fs.readFile(
    pathToFileUri(`${projectPath.replace(/\/+$/, "")}/${name}`),
  )
  return text.trim().length > 0 ? text : null
}

function unavailableGitFields(
  error: string | null,
): Pick<
  ProjectDashboard,
  "branch" | "branches" | "history"
> {
  return {
    branch: { value: null, error },
    branches: { value: null, error },
    history: { value: null, error },
  }
}

export async function loadProjectDashboard(
  projectPath: string,
  dependencies: ProjectDashboardDependencies,
): Promise<ProjectDashboard> {
  const rootUri = pathToFileUri(projectPath)
  const readmePromise = settle(
    () => readProjectReadme(projectPath, dependencies.fs),
    null,
    "Could not read README.",
  )
  const sessionsPromise = settle(
    dependencies.listSessions,
    [],
    "Could not load sessions.",
  )

  const gitPromise = (async () => {
    if (!dependencies.git) {
      return {
        isGitRepo: { value: false, error: null },
        ...unavailableGitFields(null),
      }
    }
    const repository = await settle(
      () => dependencies.git!.isRepo(rootUri),
      false,
      "Could not inspect repository.",
    )
    if (repository.error || !repository.value) {
      return {
        isGitRepo: repository,
        ...unavailableGitFields(repository.error),
      }
    }
    const [branch, branches, history] =
      await Promise.all([
        settle(
          () => dependencies.git!.branch(rootUri),
          null,
          "Could not load the current branch.",
        ),
        settle(
          () => dependencies.git!.branches(rootUri),
          null,
          "Could not load branches.",
        ),
        settle(
          () => dependencies.git!.history(rootUri, 5),
          null,
          "Could not load recent commits.",
        ),
      ])
    return {
      isGitRepo: repository,
      branch,
      branches,
      history,
    }
  })()

  const [readme, sessions, git] = await Promise.all([
    readmePromise,
    sessionsPromise,
    gitPromise,
  ])
  return { readme, sessions, ...git }
}

export function recentProjectSessions(
  sessions: readonly ProjectSessionSummary[],
  limit = 5,
): ProjectSessionSummary[] {
  return [...sessions]
    .filter(session => !session.archivedAt)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, limit)
}

export function resolveProjectFilePath(
  projectPath: string,
  target: string,
): string | null {
  const cleanTarget = target.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? ""
  if (
    !cleanTarget ||
    cleanTarget.startsWith("/") ||
    cleanTarget.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(cleanTarget)
  ) {
    return null
  }
  let decodedTarget: string
  try {
    decodedTarget = decodeURIComponent(cleanTarget)
  } catch {
    return null
  }
  const rootParts = projectPath.replace(/\/+$/, "").split("/").filter(Boolean)
  const parts = [...rootParts]
  for (const segment of decodedTarget.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (parts.length <= rootParts.length) return null
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  const resolved = `/${parts.join("/")}`
  const root = `/${rootParts.join("/")}`
  return resolved === root || resolved.startsWith(`${root}/`) ? resolved : null
}
