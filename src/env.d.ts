interface Window {
  electronAPI?: {
    minimizeWindow: () => Promise<void>
    maximizeWindow: () => Promise<void>
    closeWindow: () => Promise<void>
    openTool: (toolName: string) => Promise<void>
    showNotification: (title: string, body: string) => Promise<void>
    getAppVersion: () => Promise<string>
    storeGet: (key: string) => Promise<any>
    storeSet: (key: string, value: any) => Promise<void>
    storeDelete: (key: string) => Promise<void>
  }
}
