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
    translateFetch?: (options: {
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
      timeout?: number
    }) => Promise<{ ok: boolean; status: number; text: string; error?: string }>
    getProxyConfig?: () => Promise<{
      mode: 'system' | 'manual' | 'direct'
      url?: string
    }>
    setProxyConfig?: (config: {
      mode: 'system' | 'manual' | 'direct'
      url?: string
    }) => Promise<{ mode: 'system' | 'manual' | 'direct'; url?: string }>
    testProxy?: () => Promise<{
      ok: boolean
      proxy: string
      status: number
      error?: string
    }>
    notesOpenFile?: () => Promise<{
      path: string
      name: string
      content: string
      mtimeMs?: number
    } | null>
    notesSaveFile?: (options: {
      content: string
      defaultPath?: string
    }) => Promise<{
      path: string
      name: string
    } | null>
    onOpenFileRequest?: (
      callback: (payload: {
        path: string
        name: string
        content?: string
        mtimeMs?: number
        error?: string
      }) => void
    ) => () => void
    notifyRendererReady?: () => Promise<void>
  }
}
