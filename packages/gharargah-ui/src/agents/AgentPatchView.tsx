import { parsePatchFiles } from "@pierre/diffs"
import { FileDiff, PatchDiff } from "@pierre/diffs/react"
import { useMemo } from "react"
import { resolveDiffThemeName } from "./diffRendering.js"

type AgentPatchViewProps = {
  patch: string
  theme: "light" | "dark"
}

export function AgentPatchView({ patch, theme }: AgentPatchViewProps) {
  const parsed = useMemo(() => {
    try {
      return parsePatchFiles(patch)
    } catch {
      return null
    }
  }, [patch])

  const options = useMemo(
    () => ({ diffStyle: "split" as const, theme: resolveDiffThemeName(theme), themeType: theme }),
    [theme],
  )

  if (!parsed || parsed.length === 0) {
    return (
      <pre className="overflow-x-auto p-3 text-xs leading-5 text-foreground">
        {patch}
      </pre>
    )
  }

  const totalFiles = parsed.reduce((count, entry) => count + entry.files.length, 0)
  if (parsed.length === 1 && totalFiles === 1) {
    return <PatchDiff patch={patch} options={options} />
  }

  return (
    <div className="flex flex-col">
      {parsed.flatMap((entry, patchIndex) =>
        entry.files.map((fileDiff, fileIndex) => (
          <div
            key={`${patchIndex}:${fileIndex}:${fileDiff.prevName ?? fileDiff.name}:${fileDiff.name}`}
            className={patchIndex === 0 && fileIndex === 0 ? "" : "border-t border-input"}
          >
            <FileDiff fileDiff={fileDiff} options={options} />
          </div>
        )),
      )}
    </div>
  )
}
