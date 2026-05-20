import { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, Notification, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    title: 'FeHelper - 前端助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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

  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
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
