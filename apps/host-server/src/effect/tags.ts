import { Context, type PubSub } from "effect"
import type { PerfHost, TerminalHost } from "@gharargah/node-host"
import type { NotificationStreamEvent } from "@gharargah/shared"
import type { HostConfig } from "../config.js"
import type { EventHub } from "../events.js"
import type { HostRuntime } from "../host-runtime.js"
import type { NotificationService } from "../notifications/index.js"
import type { ProjectDatabase } from "../persistence.js"
import type { WorkspaceHost } from "../workspace.js"

export class HostConfigTag extends Context.Tag("gharargah/HostConfig")<
  HostConfigTag,
  HostConfig
>() {}

export class EventHubTag extends Context.Tag("gharargah/EventHub")<EventHubTag, EventHub>() {}

export class ProjectDatabaseTag extends Context.Tag("gharargah/ProjectDatabase")<
  ProjectDatabaseTag,
  ProjectDatabase
>() {}

export class NotificationServiceTag extends Context.Tag("gharargah/NotificationService")<
  NotificationServiceTag,
  NotificationService
>() {}

/** Fan-out for structured notification stream events (before EventHub WS framing). */
export class NotificationEventPubSub extends Context.Tag("gharargah/NotificationEventPubSub")<
  NotificationEventPubSub,
  PubSub.PubSub<NotificationStreamEvent>
>() {}

export { GitServiceTag, type GitService } from "./git.js"
export class TerminalHostTag extends Context.Tag("gharargah/TerminalHost")<
  TerminalHostTag,
  TerminalHost
>() {}

export class WorkspaceHostTag extends Context.Tag("gharargah/WorkspaceHost")<
  WorkspaceHostTag,
  WorkspaceHost
>() {}

export class PerfHostTag extends Context.Tag("gharargah/PerfHost")<PerfHostTag, PerfHost>() {}

export class HomeDirTag extends Context.Tag("gharargah/HomeDir")<HomeDirTag, string>() {}

/** Aggregate runtime for HTTP/WS handlers and dispatch. */
export class HostRuntimeTag extends Context.Tag("gharargah/HostRuntime")<
  HostRuntimeTag,
  HostRuntime
>() {}
