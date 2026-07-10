export type HostDialogProvider = {
  showOpenFolderDialog(): Promise<string | null>
  showSaveFileDialog(defaultPath?: string): Promise<string | null>
}

export type HostNativeChrome = {
  syncNativeChrome(colors: { background: string; foreground: string }): Promise<void>
}

export type HostLaunchState = {
  getLaunchConfig(): Promise<import("@jet/node-host").LaunchConfig | null>
  deliverLaunch(config: import("@jet/node-host").LaunchConfig): void
}

export type HostServices = {
  dialog: HostDialogProvider
  nativeChrome: HostNativeChrome
  launch: HostLaunchState
  getHomeDir(): string
  loadGlobalJetrcScanRoots(): Promise<string[]>
}
