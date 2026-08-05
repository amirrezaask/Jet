import { useCallback, useEffect, useState } from "react"
import type { ProjectSession } from "@yaade/rpc"
import { MuxApp } from "./mux/MuxApp.js"
import { ProjectPage } from "./project/ProjectPage.js"
import {
  createProjectSession,
  loadProjectSession,
  listProjectSessions,
} from "./project-session-client.js"
import {
  popToProjectUrl,
  projectRootFromLocation,
  pushProjectUrl,
  pushSessionUrl,
  sessionIdFromSearch,
  urlPathForProjectRoot,
  workspaceDocumentTitle,
} from "./url-workspace.js"

type BootState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready"
      homeDir: string
      machineHostname: string
      projectPath: string
      sessionId: string | null
      session: ProjectSession | null
    }

export function AppRoot() {
  const [boot, setBoot] = useState<BootState>({ status: "loading" })
  const [routeEpoch, setRouteEpoch] = useState(0)

  const readRoute = useCallback(() => {
    setRouteEpoch(n => n + 1)
  }, [])

  useEffect(() => {
    const onPop = () => readRoute()
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [readRoute])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let homeDir = ""
      try {
        homeDir = (await window.yaade?.getHomeDir?.()) ?? ""
      } catch {
        homeDir = ""
      }

      let machineHostname = "local"
      try {
        const sys = await fetch("/api/v1/system")
        if (sys.ok) {
          const body = (await sys.json()) as { machineHostname?: string }
          if (typeof body.machineHostname === "string") {
            machineHostname = body.machineHostname
          }
        }
      } catch {
        /* keep local */
      }

      const pathname =
        typeof location !== "undefined" ? location.pathname : "/"
      let projectPath = projectRootFromLocation(homeDir, pathname)
      if (
        projectPath &&
        homeDir &&
        (pathname === "/" || pathname === "")
      ) {
        try {
          const cfg = await window.yaade?.getLaunchConfig?.()
          if (cfg?.workspacePath) projectPath = cfg.workspacePath
        } catch {
          /* keep home */
        }
      }

      if (!projectPath) {
        if (!cancelled) {
          setBoot({
            status: "error",
            message: "Could not resolve a project path from the URL.",
          })
        }
        return
      }

      document.title = workspaceDocumentTitle(projectPath, homeDir)

      const sessionId = sessionIdFromSearch()
      if (!sessionId) {
        if (!cancelled) {
          setBoot({
            status: "ready",
            homeDir,
            machineHostname,
            projectPath,
            sessionId: null,
            session: null,
          })
        }
        return
      }

      try {
        const session = await loadProjectSession(sessionId)
        if (cancelled) return
        if (session.projectPath !== projectPath) {
          setBoot({
            status: "ready",
            homeDir,
            machineHostname,
            projectPath,
            sessionId: null,
            session: null,
          })
          return
        }
        setBoot({
          status: "ready",
          homeDir,
          machineHostname,
          projectPath,
          sessionId,
          session,
        })
      } catch (error) {
        if (cancelled) return
        setBoot({
          status: "ready",
          homeDir,
          machineHostname,
          projectPath,
          sessionId: null,
          session: null,
        })
        console.warn(
          "Failed to load session; showing project page:",
          error instanceof Error ? error.message : error,
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [routeEpoch])

  const openSession = useCallback(
    async (sessionId: string) => {
      if (boot.status !== "ready") return
      const session = await loadProjectSession(sessionId)
      pushSessionUrl(location.pathname, sessionId)
      setBoot({
        ...boot,
        sessionId,
        session,
      })
    },
    [boot],
  )

  const backToProject = useCallback(() => {
    if (boot.status !== "ready") return
    popToProjectUrl(location.pathname)
    setBoot({
      ...boot,
      sessionId: null,
      session: null,
    })
  }, [boot])

  const navigateProject = useCallback(
    (absolutePath: string) => {
      if (boot.status !== "ready") return
      const nextAbs = absolutePath.replace(/\/+$/, "") || "/"
      const currentAbs = boot.projectPath.replace(/\/+$/, "") || "/"
      if (nextAbs === currentAbs) return
      pushProjectUrl(urlPathForProjectRoot(absolutePath, boot.homeDir))
      readRoute()
    },
    [boot, readRoute],
  )

  // Project-page agent bridge (MuxApp installs its own when a session is open).
  useEffect(() => {
    if (boot.status !== "ready" || boot.session) return
    const projectPath = boot.projectPath
    window.__yaadeAgent = {
      openWorkspace: async () => undefined,
      addWorkspace: async () => undefined,
      listWorkspaces: () => [
        { id: "project", path: projectPath, name: projectPath },
      ],
      openFile: async () => undefined,
      executeCommand: async () => undefined,
      getState: () => ({
        workspace: projectPath,
        activeWorkspace: projectPath,
        workspaces: [{ id: "project", path: projectPath, name: projectPath }],
        message: null,
        paletteOpen: false,
        focusedPanel: null,
        openBuffers: [],
        panels: [],
        fontSize: 13,
        activeEditorDirty: false,
        searchReady: false,
        shellView: "home",
        sessionLayout: "sidebar",
        sessionMode: null,
        agentChatEnabled: false,
        route: "project",
        sessionId: null,
        sessionCwd: null,
      }),
      waitForReady: async () => undefined,
      waitForEditor: async () => undefined,
      setFontSize: () => undefined,
      getEditorText: () => null,
      setEditorSelection: () => undefined,
      getCursorPosition: () => null,
      getSelectionRangeCount: () => null,
      acceptConfirm: async () => undefined,
      dismissConfirm: async () => undefined,
      readFixtureFile: async () => "",
      waitForListRows: async () => undefined,
      getPerfMeasures: () => [],
      clearPerf: () => undefined,
      markPerf: () => undefined,
      measurePerf: () => undefined,
      dropFilesOnTerminal: async () => false,
      getTerminalText: () => "",
      getTerminalCellHeight: () => 0,
      getTerminalCellSize: () => null,
      getTerminalDims: () => null,
      getTerminalCursor: () => null,
      findTerminalText: () => null,
      createProjectSession: async input => {
        const created = await createProjectSession({
          rootPath: projectPath,
          title: input?.title,
          worktree: input?.worktree,
        })
        await openSession(created.id)
        return { id: created.id }
      },
      listProjectSessions: async () => {
        const rows = await listProjectSessions(projectPath)
        return rows.map(r => ({ id: r.id, title: r.title }))
      },
      openProjectSession: async sessionId => {
        await openSession(sessionId)
      },
      backToProject: async () => {
        backToProject()
      },
    }
    return () => {
      // Only clear our project stub — MuxApp installs its own bridge when a
      // session opens; do not race-delete that instance.
      if (window.__yaadeAgent?.getState?.().route === "project") {
        delete window.__yaadeAgent
      }
    }
  }, [backToProject, boot, openSession])

  if (boot.status === "loading") {
    return (
      <div
        className="grid h-full place-items-center bg-background text-muted-foreground"
        data-yaade-boot="loading"
      >
        Loading…
      </div>
    )
  }

  if (boot.status === "error") {
    return (
      <div
        className="grid h-full place-items-center bg-background p-8 text-foreground"
        data-yaade-boot="error"
        role="alert"
      >
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold">Unable to open workspace</p>
          <p className="mt-2 text-sm text-muted-foreground">{boot.message}</p>
        </div>
      </div>
    )
  }

  if (boot.session && boot.sessionId) {
    return (
      <MuxApp
        key={boot.sessionId}
        session={boot.session}
        homeDir={boot.homeDir}
        machineHostname={boot.machineHostname}
        onBackToProject={backToProject}
      />
    )
  }

  return (
    <ProjectPage
      projectPath={boot.projectPath}
      homeDir={boot.homeDir}
      machineHostname={boot.machineHostname}
      onOpenSession={openSession}
      onNavigateProject={navigateProject}
      listSessions={() => listProjectSessions(boot.projectPath)}
    />
  )
}
