import { contextBridge, ipcRenderer } from 'electron'

// Expose API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  
  // Tool operations
  openTool: (toolName: string) => ipcRenderer.invoke('open-tool', toolName),
  
  // Notifications
  showNotification: (title: string, body: string) => 
    ipcRenderer.invoke('show-notification', title, body),
  
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Store operations
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key: string) => ipcRenderer.invoke('store-delete', key),

  // 剪贴板读写(右键菜单的复制/粘贴使用)
  clipboardRead: () => ipcRenderer.invoke('clipboard-read'),
  clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard-write', text),

  // 翻译 API 代理（绕过 CORS，走系统/手动代理）
  translateFetch: (options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    timeout?: number
  }) => ipcRenderer.invoke('translate-fetch', options),

  getProxyConfig: () => ipcRenderer.invoke('get-proxy-config'),
  setProxyConfig: (config: {
    mode: 'system' | 'manual' | 'direct'
    url?: string
  }) => ipcRenderer.invoke('set-proxy-config', config),
  testProxy: () => ipcRenderer.invoke('test-proxy'),

  // Markdown notes file IO
  notesOpenFile: () => ipcRenderer.invoke('notes-open-file'),
  notesSaveFile: (options: { content: string; defaultPath?: string }) =>
    ipcRenderer.invoke('notes-save-file', options),

  // 在系统默认浏览器中安全打开外部链接
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Markdown 文件关联:外部打开文件请求(双击 .md 文件)
  onOpenFileRequest: (callback: (payload: OpenFilePayload) => void) => {
    const listener = (_: unknown, payload: OpenFilePayload) => callback(payload)
    ipcRenderer.on('notes:open-file-request', listener)
    return () => {
      ipcRenderer.removeListener('notes:open-file-request', listener)
    }
  },
  notifyRendererReady: () => ipcRenderer.invoke('notes-renderer-ready'),

  // 全局快捷键：读配置、存配置（存完主进程会立刻重注册，返回注册失败的 id）
  getShortcuts: (): Promise<Record<string, string>> => ipcRenderer.invoke('get-shortcuts'),
  setShortcuts: (map: Record<string, string>): Promise<{ failed: string[] }> =>
    ipcRenderer.invoke('set-shortcuts', map),
  /** 录制期间暂停全局快捷键，免得按下的组合真的把窗口唤起 */
  setShortcutRecording: (recording: boolean): Promise<void> =>
    ipcRenderer.invoke('set-shortcut-recording', recording),

  /**
   * 主进程要求切到某个工具页（全局快捷键唤起窗口时用）。
   * 跟 onOpenFileRequest 一样返回取消订阅函数。
   */
  onToolOpenRequest: (callback: (toolId: string) => void) => {
    const listener = (_: unknown, toolId: string) => callback(toolId)
    ipcRenderer.on('tool:open-request', listener)
    return () => {
      ipcRenderer.removeListener('tool:open-request', listener)
    }
  },

  // 截图框选：遮罩窗口侧的接口
  startCapture: () => ipcRenderer.invoke('start-capture'),
  finishCapture: (dataUrl: string) => ipcRenderer.invoke('finish-capture', dataUrl),
  cancelCapture: () => ipcRenderer.invoke('cancel-capture'),
  /** 主进程推来待框选的全屏图 */
  onCaptureReady: (callback: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on('capture:ready', listener)
    return () => {
      ipcRenderer.removeListener('capture:ready', listener)
    }
  },
  /** 渲染层就绪后主动拉一次截图（防止推的消息早于监听挂上而丢失） */
  requestCaptureShot: () => ipcRenderer.invoke('request-capture-shot'),

  /* 流式翻译：发起 + 中断 + 订阅分块推送 */
  startTranslateStream: (options: {
    requestId: string
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    timeout?: number
  }): Promise<void> => ipcRenderer.invoke('translate-stream-start', options),
  abortTranslateStream: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('translate-stream-abort', requestId),
  onTranslateStreamChunk: (
    callback: (payload: { requestId: string; chunk: string }) => void
  ) => {
    const listener = (_: unknown, payload: { requestId: string; chunk: string }) =>
      callback(payload)
    ipcRenderer.on('translate-stream-chunk', listener)
    return () => {
      ipcRenderer.removeListener('translate-stream-chunk', listener)
    }
  },
  onTranslateStreamEnd: (
    callback: (payload: { requestId: string; error?: string }) => void
  ) => {
    const listener = (_: unknown, payload: { requestId: string; error?: string }) =>
      callback(payload)
    ipcRenderer.on('translate-stream-end', listener)
    return () => {
      ipcRenderer.removeListener('translate-stream-end', listener)
    }
  },
  /** 主窗口侧：收到框选好的图，该去做 OCR 了 */
  onCaptureOcrRequest: (callback: (dataUrl: string) => void) => {
    const listener = (_: unknown, dataUrl: string) => callback(dataUrl)
    ipcRenderer.on('capture:ocr-request', listener)
    return () => {
      ipcRenderer.removeListener('capture:ocr-request', listener)
    }
  },
})

// 外部打开文件的消息负载
export interface OpenFilePayload {
  path: string
  name: string
  content?: string
  mtimeMs?: number
  error?: string
}

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      minimizeWindow: () => Promise<void>
      maximizeWindow: () => Promise<void>
      closeWindow: () => Promise<void>
      openTool: (toolName: string) => Promise<void>
      showNotification: (title: string, body: string) => Promise<void>
      getAppVersion: () => Promise<string>
      storeGet: (key: string) => Promise<any>
      storeSet: (key: string, value: any) => Promise<void>
      storeDelete: (key: string) => Promise<void>
      clipboardRead: () => Promise<string>
      clipboardWrite: (text: string) => Promise<void>
      translateFetch: (options: {
        url: string
        method?: string
        headers?: Record<string, string>
        body?: string
        timeout?: number
      }) => Promise<{ ok: boolean; status: number; text: string; error?: string }>
      getProxyConfig: () => Promise<{
        mode: 'system' | 'manual' | 'direct'
        url?: string
      }>
      setProxyConfig: (config: {
        mode: 'system' | 'manual' | 'direct'
        url?: string
      }) => Promise<{ mode: 'system' | 'manual' | 'direct'; url?: string }>
      testProxy: () => Promise<{
        ok: boolean
        proxy: string
        status: number
        error?: string
      }>
      notesOpenFile: () => Promise<{
        path: string
        name: string
        content: string
      } | null>
      notesSaveFile: (options: {
        content: string
        defaultPath?: string
      }) => Promise<{
        path: string
        name: string
      } | null>
      onOpenFileRequest: (
        callback: (payload: OpenFilePayload) => void
      ) => () => void
      notifyRendererReady: () => Promise<void>
    }
  }
}
