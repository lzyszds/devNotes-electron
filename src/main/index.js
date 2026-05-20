/**
 * FeHelper Electron - Main Process
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  Notification,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const log = require("electron-log");

log.initialize();
log.transports.file.level = "info";

let mainWindow = null;
let tray = null;
let settingsWindow = null;
let store = null;

// Memory fallback store
const memoryStore = {
  data: {
    installedTools: {},
    favorites: [],
    options: {},
  },
  get(key) {
    return key ? this.data[key] : this.data;
  },
  set(key, val) {
    this.data[key] = val;
  },
  delete(key) {
    delete this.data[key];
  },
};

// Initialize store asynchronously
async function initStore() {
  try {
    const { default: Store } = await import("electron-store");
    store = new Store({
      name: "fehelper-settings",
      defaults: memoryStore.data,
    });
    log.info("Store initialized with electron-store");
  } catch (e) {
    store = memoryStore;
    log.warn("Using memory store:", e.message);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.resolve(__dirname, "../renderer/popup/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
    },
  });
  settingsWindow.loadFile(
    path.resolve(__dirname, "../renderer/tools/options/index.html"),
  );
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function getToolTitle(name) {
  const titles = {
    "json-format": "JSON 美化",
    "qr-code": "二维码",
    "en-decode": "编码转换",
    timestamp: "时间戳",
    regexp: "正则",
    password: "密码生成",
    options: "工具市场",
  };
  return titles[name] || "FeHelper";
}

function openTool(toolName, query = "") {
  const existing = BrowserWindow.getAllWindows().filter(
    (w) => w.toolName === toolName && !w.isDestroyed(),
  );
  if (existing.length > 0) {
    existing[0].focus();
    return;
  }

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    title: getToolTitle(toolName),
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
    },
  });
  win.toolName = toolName;

  const toolPath = path.resolve(
    __dirname,
    "../renderer/tools",
    toolName,
    "index.html",
  );
  win.loadURL(query ? `file://${toolPath}?${query}` : `file://${toolPath}`);
}

function createTray() {
  tray = new Tray(path.join(__dirname, "../../assets/icon.png"));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开",
        click: () => (mainWindow ? mainWindow.show() : createMainWindow()),
      },
      { label: "工具市场", click: createSettingsWindow },
      { type: "separator" },
      { label: "JSON", click: () => openTool("json-format") },
      { label: "二维码", click: () => openTool("qr-code") },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ]),
  );
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "文件",
        submenu: [
          { label: "工具市场", click: createSettingsWindow },
          { type: "separator" },
          {
            label: "退出",
            accelerator: "CmdOrCtrl+Q",
            click: () => app.quit(),
          },
        ],
      },
      {
        label: "工具",
        submenu: [
          { label: "JSON", click: () => openTool("json-format") },
          { label: "二维码", click: () => openTool("qr-code") },
          { label: "编码", click: () => openTool("en-decode") },
        ],
      },
    ]),
  );
}

function setupIpc() {
  ipcMain.handle("storage.get", async (e, keys) => {
    if (typeof keys === "string") return store.get(keys);
    const result = {};
    if (Array.isArray(keys)) keys.forEach((k) => (result[k] = store.get(k)));
    return result;
  });
  ipcMain.handle("storage.set", async (e, items) => {
    Object.entries(items).forEach(([k, v]) => store.set(k, v));
    return { success: true };
  });
  ipcMain.handle("openTool", async (e, name, query) => {
    openTool(name, query);
    return { success: true };
  });
  ipcMain.handle("openOptionsPage", async () => {
    createSettingsWindow();
    return { success: true };
  });
  ipcMain.handle("getManifest", async () => ({
    version: "2026.4.2920",
    name: "FeHelper",
  }));
  ipcMain.handle("notifications.create", async (e, id, opts) => {
    if (Notification.isSupported())
      new Notification({ title: opts.title, body: opts.message }).show();
    return { success: true };
  });
}

app.whenReady().then(async () => {
  await initStore();
  createMenu();
  createMainWindow();
  createTray();
  setupIpc();
  globalShortcut.register("Alt+Shift+J", () => {
    if (mainWindow)
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
