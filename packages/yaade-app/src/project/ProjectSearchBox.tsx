import { useState } from "react"
import { SearchIcon } from "lucide-react"
import { Input, Spinner } from "@yaade/ui/primitives"

export type ProjectSearchBoxProps = {
  disabled?: boolean
  pending?: boolean
  onSubmit: (query: string) => void | Promise<void>
}

export function ProjectSearchBox({
  disabled,
  pending,
  onSubmit,
}: ProjectSearchBoxProps) {
  const [query, setQuery] = useState("")

  return (
    <form
      className="mb-4"
      data-yaade-project-search=""
      onSubmit={event => {
        event.preventDefault()
        const trimmed = query.trim()
        if (!trimmed || pending || disabled) return
        void onSubmit(trimmed)
      }}
    >
      <label className="sr-only" htmlFor="yaade-project-search">
        Search project
      </label>
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="yaade-project-search"
          data-yaade-project-search-input=""
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search project… opens Neovim quickfix"
          disabled={disabled || pending}
          className="h-9 pl-8 pr-9 font-mono text-sm"
          autoComplete="off"
          spellCheck={false}
        />
        {pending ? (
          <Spinner className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2" />
        ) : null}
      </div>
    </form>
  )
}
