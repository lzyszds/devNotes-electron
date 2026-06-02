import { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, Notification, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const store = new Store()

function loadRendererWindow(window: BrowserWindow, toolName?: string) {
  const query = toolName ? `?tool=${encodeURIComponent(toolName)}` : ''

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(`${process.env.VITE_DEV_SERVER_URL}${query}`)
    return
  }

  window.loadFile(path.join(__dirname, '../dist/index.html'), {
    search: query,
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    title: 'FeHelper - 前端助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  })

  loadRendererWindow(mainWindow)

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createToolWindow(toolName: string) {
  const toolWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    title: `FeHelper - ${toolName}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  })

  loadRendererWindow(toolWindow, toolName)

  toolWindow.once('ready-to-show', () => {
    toolWindow.show()
  })
}

function createTray() {
  const iconDir = path.join(__dirname, '../assets')
  const iconFiles = ['icon.png', 'icon.jpg', 'icon.jpeg', 'icon.ico']
  let icon: nativeImage | null = null
  
  for (const file of iconFiles) {
    const iconPath = path.join(iconDir, file)
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath)
      if (!icon.isEmpty()) break
    }
  }
  
  if (!icon || icon.isEmpty()) {
    console.warn('No tray icon found, skipping tray creation')
    return
  }
  
  try {
    const trayIcon = process.platform === 'darwin' 
      ? icon.resize({ width: 22, height: 22 }) 
      : icon.resize({ width: 16, height: 16 })
    tray = new Tray(trayIcon)
  } catch (e) {
    console.warn('Failed to create tray:', e)
    return
  }
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示 FeHelper', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  
  tray.setToolTip('FeHelper - 前端助手')
  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
}

function setupIpc() {
  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle('window-close', () => {
    mainWindow?.hide()
  })

  ipcMain.handle('show-notification', (_, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  })

  ipcMain.handle('open-tool', (_, toolName: string) => {
    createToolWindow(toolName)
  })

  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  // Store operations
  ipcMain.handle('store-get', (_, key: string) => {
    return store.get(key)
  })

  ipcMain.handle('store-set', (_, key: string, value: any) => {
    store.set(key, value)
  })

  ipcMain.handle('store-delete', (_, key: string) => {
    store.delete(key)
  })
}

app.whenReady().then(() => {
  createMainWindow()
  createTray()
  setupIpc()

  globalShortcut.register('Alt+Shift+F', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
