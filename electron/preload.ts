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
    }
  }
}
