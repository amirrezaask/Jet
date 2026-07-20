import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { pathToFileUri } from "@gharargah/shared"
import { GharargahPanelTree, buildTabsView } from "@gharargah/workspace"
import type { WorkspaceFolder } from "@gharargah/workspace"
import {
  isContextualTabKind,
  resolveContextWorkspaceFolder,
  resolveFolderForActiveTab,
} from "./resolve-tab-workspace.js"
import { registerTerminalSession } from "./tabs/terminal-session.js"

const folderA: WorkspaceFolder = {
  id: "a",
  root: { uri: pathToFileUri("/proj/a"), path: "/proj/a", name: "alpha" },
}
const folderB: WorkspaceFolder = {
  id: "b",
  root: { uri: pathToFileUri("/proj/b"), path: "/proj/b", name: "beta" },
}

function mockWorkspace(folders: WorkspaceFolder[], activeId?: string) {
  return {
    folders,
    manager: {
      activeFolder: folders.find(f => f.id === activeId) ?? folders[0] ?? null,
    },
    tabRegistry: {
      kindFor(id: string) {
        if (id.startsWith("file:")) return "editor"
        if (id.startsWith("gharargah:terminal:")) return "terminal"
        if (id === "gharargah:search") return "search"
        return undefined
      },
    },
    folderStateForUri(uri: string) {
      for (const folder of folders) {
        const prefix = `${folder.root.path}/`
        const path = uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri
        if (path === folder.root.path || path.startsWith(prefix)) {
          return { id: folder.id }
        }
      }
      return null
    },
  } as never
}

describe("isContextualTabKind", () => {
  it("recognizes editor and terminal", () => {
    assert.equal(isContextualTabKind("editor"), true)
    assert.equal(isContextualTabKind("terminal"), true)
    assert.equal(isContextualTabKind("search"), false)
  })
})

describe("resolveFolderForActiveTab", () => {
  it("returns folder for active editor file", () => {
    const fileUri = pathToFileUri("/proj/a/src/index.ts")
    const { tree, editorPanel } = GharargahPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildTabsView(fileUri, [fileUri]))
    const workspace = mockWorkspace([folderA, folderB], "b")
    const folder = resolveFolderForActiveTab(tree, editorPanel, workspace.tabRegistry, workspace)
    assert.equal(folder?.id, "a")
  })

  it("returns folder for active terminal cwd", () => {
    const tabId = "gharargah:terminal:1"
    registerTerminalSession(tabId, folderB.root.uri)
    const { tree, editorPanel } = GharargahPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildTabsView(tabId, [tabId]))
    const workspace = mockWorkspace([folderA, folderB], "a")
    const folder = resolveFolderForActiveTab(tree, editorPanel, workspace.tabRegistry, workspace)
    assert.equal(folder?.id, "b")
  })
})

describe("resolveContextWorkspaceFolder", () => {
  it("uses last context when search tab is focused", () => {
    const { tree, editorPanel } = GharargahPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildTabsView("gharargah:search", ["gharargah:search"]))
    const workspace = mockWorkspace([folderA, folderB], "b")
    const folder = resolveContextWorkspaceFolder(
      tree,
      editorPanel,
      workspace.tabRegistry,
      workspace,
      folderA,
    )
    assert.equal(folder?.id, "a")
  })
})
