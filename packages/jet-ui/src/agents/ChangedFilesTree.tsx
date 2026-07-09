import type { AgentFileChange } from "@jet/agents"
import { memo, useCallback, useMemo, useState } from "react"
import { ChevronRightIcon, FolderClosedIcon, FolderIcon } from "lucide-react"
import { cn } from "../lib/utils.js"
import { Button } from "../components/ui/button.js"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.js"
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel.js"
import {
  buildTurnDiffTree,
  summarizeTurnDiffStats,
  type TurnDiffTreeNode,
} from "./turnDiffTree.js"

const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {}

export const ChangedFilesCard = memo(function ChangedFilesCard(props: {
  files: ReadonlyArray<AgentFileChange>
  allDirectoriesExpanded: boolean
  onToggleAllDirectories: () => void
}) {
  const { files, allDirectoriesExpanded, onToggleAllDirectories } = props
  const summaryStat = useMemo(() => summarizeTurnDiffStats(files), [files])

  return (
    <div className="relative mt-4 rounded-2xl bg-card/40 shadow-xs/5 after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-2xl after:border after:border-input">
      <div className="sticky top-0 z-10 mb-3 flex items-center justify-between gap-2 rounded-t-2xl bg-card/72 p-3 backdrop-blur-md">
        <p className="flex items-center gap-1 font-medium text-foreground text-xs leading-4">
          <span>{files.length} changed files</span>
          {hasNonZeroStat(summaryStat) ? (
            <DiffStatLabel
              additions={summaryStat.additions}
              className="text-xs leading-4"
              deletions={summaryStat.deletions}
              layout="inline"
            />
          ) : null}
        </p>
        <Button
          type="button"
          size="xs"
          variant="outline"
          data-scroll-anchor-ignore
          onClick={onToggleAllDirectories}
        >
          {allDirectoriesExpanded ? "Collapse all" : "Expand all"}
        </Button>
      </div>
      <div className="px-2 pb-2">
        <ChangedFilesTree
          files={files}
          allDirectoriesExpanded={allDirectoriesExpanded}
        />
      </div>
    </div>
  )
})

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  files: ReadonlyArray<AgentFileChange>
  allDirectoriesExpanded: boolean
}) {
  const { files, allDirectoriesExpanded } = props
  const treeNodes = useMemo(() => buildTurnDiffTree(files), [files])
  const directoryPathsKey = useMemo(() => collectDirectoryPaths(treeNodes).join("\u0000"), [treeNodes])
  const hasDirectoryNodes = directoryPathsKey.length > 0
  const expansionStateKey = `${allDirectoriesExpanded ? "expanded" : "collapsed"}\u0000${directoryPathsKey}`
  const [directoryExpansionState, setDirectoryExpansionState] = useState<{
    key: string
    overrides: Record<string, boolean>
  }>(() => ({
    key: expansionStateKey,
    overrides: {},
  }))
  const expandedDirectories =
    directoryExpansionState.key === expansionStateKey
      ? directoryExpansionState.overrides
      : EMPTY_DIRECTORY_OVERRIDES

  const toggleDirectory = useCallback(
    (pathValue: string) => {
      setDirectoryExpansionState(current => {
        const nextOverrides = current.key === expansionStateKey ? current.overrides : {}
        return {
          key: expansionStateKey,
          overrides: {
            ...nextOverrides,
            [pathValue]: !(nextOverrides[pathValue] ?? allDirectoriesExpanded),
          },
        }
      })
    },
    [allDirectoriesExpanded, expansionStateKey],
  )

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    const leftPadding = 8 + depth * 14
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? allDirectoriesExpanded
      return (
        <Collapsible
          key={`dir:${node.path}`}
          open={isExpanded}
          onOpenChange={() => toggleDirectory(node.path)}
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-1.5 rounded-xl py-1 pr-3 font-normal hover:bg-accent/60"
              style={{ paddingLeft: `${leftPadding}px` }}
            >
              <ChevronRightIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
                  isExpanded && "rotate-90",
                )}
              />
              {isExpanded ? (
                <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
              ) : (
                <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
              )}
              <span className="truncate font-mono text-3xs text-muted-foreground/90 group-hover:text-foreground/90">
                {node.name}
              </span>
              {hasNonZeroStat(node.stat) ? (
                <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums">
                  <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
                </span>
              ) : null}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5">
            {node.children.map(childNode => renderTreeNode(childNode, depth + 1))}
          </CollapsibleContent>
        </Collapsible>
      )
    }

    return (
      <div
        key={`file:${node.path}`}
        className="group flex w-full items-center gap-1.5 rounded-xl py-1 pr-3 text-left transition-colors hover:bg-accent/60"
        style={{ paddingLeft: `${leftPadding}px` }}
      >
        {hasDirectoryNodes || depth > 0 ? (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        ) : null}
        <span className="size-2 rounded-full bg-muted-foreground/50" />
        <span className="truncate font-mono text-3xs text-muted-foreground/80 group-hover:text-foreground/90">
          {node.name}
        </span>
        {node.stat ? (
          <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums">
            <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        ) : null}
      </div>
    )
  }

  return <div className="space-y-0.5">{treeNodes.map(node => renderTreeNode(node, 0))}</div>
})

function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind !== "directory") continue
    paths.push(node.path)
    paths.push(...collectDirectoryPaths(node.children))
  }
  return paths
}
