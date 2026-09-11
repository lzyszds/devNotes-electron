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
})

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
    }
  }
}
