import { useEffect, useState } from "react"
import { formatDurationMs } from "@yaade/agents"
import type { HqAgentSummary } from "@yaade/rpc"
import { pathToFileUri, type YaadeTheme } from "@yaade/shared"
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@yaade/ui/primitives"
import { TerminalPanel } from "@yaade/ui/terminal"
import {
  ArrowUpRight,
  CheckCheck,
  CircleAlert,
  FolderKanban,
  History,
  Radio,
  TerminalSquare,
} from "lucide-react"
import { useLiveAgent } from "../hooks/useLiveAgent.js"
import { useSystemSignals } from "../system-signals/SystemSignalsProvider.js"

export type HqAgentDialogProps = {
  agent: HqAgentSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  theme: YaadeTheme
  onOpenProject: (agent: HqAgentSummary) => void
  onOpenWorkspace: (agent: HqAgentSummary) => void
}

function statusLabel(agent: HqAgentSummary): string {
  if (agent.telemetry === "pending") return "Telemetry connecting"
  return agent.status.replaceAll("_", " ")
}

function eventLabel(kind: string): string {
  return kind.replaceAll(".", " ").replaceAll("_", " ")
}

export default function HqAgentDialog({
  agent,
  open,
  onOpenChange,
  theme,
  onOpenProject,
  onOpenWorkspace,
}: HqAgentDialogProps) {
  const notifications = useSystemSignals()
  const live = useLiveAgent(agent)
  const [disconnected, setDisconnected] = useState(false)
  const [unreadOverride, setUnreadOverride] = useState<number | null>(null)

  useEffect(() => {
    if (!open || !agent) return
    notifications.setViewingSessionId(agent.sessionId)
    setDisconnected(false)
    setUnreadOverride(null)
    return () => notifications.setViewingSessionId(null)
  }, [agent?.sessionId, open]) // eslint-disable-line react-hooks/exhaustive-deps -- dialog identity

  if (!agent) return null

  const unread =
    unreadOverride ??
    notifications.unreadBySession[agent.sessionId] ??
    agent.unreadCount
  const status = live.snapshot
    ? statusLabel({
        ...agent,
        status: live.snapshot.status,
        telemetry: "connected",
      })
    : statusLabel(agent)
  const runtimeMs =
    live.snapshot?.runtime.processRuntimeMs ?? agent.runtimeMs

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="wide"
        className="flex h-[min(86dvh,48rem)] max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-hidden sm:max-w-5xl"
        data-yaade-hq-agent-dialog
      >
        <DialogHeader>
          <DialogTitle>{agent.title}</DialogTitle>
          <DialogDescription>
            {agent.projectName} · {agent.projectSessionTitle}
            {agent.worktreeBranch ? ` · ${agent.worktreeBranch}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={agent.attention ? "destructive" : "secondary"}>
            {agent.provider}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {status}
          </Badge>
          {unread > 0 ? <Badge>{unread} unread</Badge> : null}
          <span className="ml-auto font-mono text-sm text-muted-foreground">
            {formatDurationMs(runtimeMs)}
          </span>
        </div>

        <Tabs defaultValue="terminal" className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="terminal">
              <TerminalSquare />
              Terminal
            </TabsTrigger>
            <TabsTrigger value="activity">
              <History />
              Activity
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="terminal"
            className="relative min-h-0 overflow-hidden rounded-md border bg-[var(--yaade-bg)]"
          >
            {disconnected ? (
              <Empty className="h-full border-0" data-yaade-hq-agent-disconnected>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CircleAlert />
                  </EmptyMedia>
                  <EmptyTitle>Agent terminal disconnected</EmptyTitle>
                  <EmptyDescription>
                    The renderer could not attach, or the PTY exited. Project
                    context and recent activity are still available.
                  </EmptyDescription>
                </EmptyHeader>
                <DialogFooter className="sm:justify-center">
                  <Button
                    variant="outline"
                    onClick={() => onOpenProject(agent)}
                  >
                    <FolderKanban data-icon="inline-start" />
                    Open Project
                  </Button>
                  <Button onClick={() => onOpenWorkspace(agent)}>
                    <ArrowUpRight data-icon="inline-start" />
                    Open Workspace
                  </Button>
                </DialogFooter>
              </Empty>
            ) : (
              <TerminalPanel
                cwdRootUri={pathToFileUri(agent.cwdPath)}
                theme={theme}
                tabId={`hq:${agent.sessionId}`}
                focused={open}
                isActive={open}
                existingPtyId={agent.ptyId}
                status="running"
                attachOnly
                onFailed={() => setDisconnected(true)}
                onExit={() => setDisconnected(true)}
              />
            )}
          </TabsContent>

          <TabsContent value="activity" className="min-h-0 overflow-hidden">
            <div className="grid h-full min-h-0 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Agent details</CardTitle>
                  <CardDescription>Current runtime context.</CardDescription>
                  <CardAction>
                    <Radio className="size-4 text-muted-foreground" />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-4 text-sm">
                    <div className="grid gap-1">
                      <dt className="text-muted-foreground">Connection</dt>
                      <dd>{disconnected ? "Disconnected" : "Attached"}</dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-muted-foreground">Runtime</dt>
                      <dd className="font-mono">
                        {formatDurationMs(runtimeMs)}
                      </dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-muted-foreground">Working directory</dt>
                      <dd className="break-all font-mono text-xs">
                        {agent.cwdPath}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              <Card className="min-h-0 overflow-hidden">
                <CardHeader>
                  <CardTitle>Recent activity</CardTitle>
                  <CardDescription>
                    Latest telemetry events for this agent.
                  </CardDescription>
                  <CardAction>
                    <Badge variant="secondary">{live.events.length}</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="min-h-0 flex-1">
                  <ScrollArea className="h-full">
                    <div data-yaade-hq-agent-events>
                      {live.events.length === 0 ? (
                        <Empty className="min-h-48 border">
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <History />
                            </EmptyMedia>
                            <EmptyTitle>No telemetry events</EmptyTitle>
                            <EmptyDescription>
                              {live.loadingHistory
                                ? "Loading activity…"
                                : "New activity will appear here."}
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        <ItemGroup>
                          {[...live.events].reverse().map((event, index) => (
                            <div key={event.id}>
                              {index > 0 ? <ItemSeparator /> : null}
                              <Item size="sm">
                                <ItemContent>
                                  <ItemTitle className="capitalize">
                                    {eventLabel(event.kind)}
                                  </ItemTitle>
                                  <ItemDescription>
                                    {new Date(event.occurredAt).toLocaleTimeString(
                                      [],
                                      {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        second: "2-digit",
                                      },
                                    )}
                                  </ItemDescription>
                                </ItemContent>
                              </Item>
                            </div>
                          ))}
                        </ItemGroup>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={unread === 0}
            onClick={() => {
              void notifications.markSessionRead(agent.sessionId).then(() => {
                setUnreadOverride(0)
              })
            }}
          >
            <CheckCheck data-icon="inline-start" />
            Mark Read
          </Button>
          <Button variant="outline" onClick={() => onOpenProject(agent)}>
            <FolderKanban data-icon="inline-start" />
            Open Project
          </Button>
          <Button onClick={() => onOpenWorkspace(agent)}>
            <TerminalSquare data-icon="inline-start" />
            Open Workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
