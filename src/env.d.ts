interface Window {
  electronAPI?: {
    minimizeWindow: () => Promise<void>
    maximizeWindow: () => Promise<void>
    closeWindow: () => Promise<void>
    openTool: (toolName: string) => Promise<void>
    showNotification: (title: string, body: string) => Promise<void>
    getAppVersion: () => Promise<string>
  }
}
