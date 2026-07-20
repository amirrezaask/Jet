import { Component, type ErrorInfo, type ReactNode } from "react"

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[jet] renderer crashed", error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
        <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-destructive">
            Gharargah needs to recover
          </p>
          <h1 className="mt-2 text-lg font-semibold">The renderer hit an unexpected error.</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your project files and terminal processes were not modified. Reload the interface to
            reconnect to this session.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="mt-4 h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors duration-[var(--gharargah-motion-fast)] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => window.location.reload()}
          >
            Reload Gharargah
          </button>
        </section>
      </main>
    )
  }
}
