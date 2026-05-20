/**
 * FeHelper Electron - Preload Script
 * Bridges the main process and renderer process
 * Exposes a Chrome-compatible API for the renderer
 */

import { contextBridge, ipcRenderer } from "electron";

// Expose Chrome-compatible APIs to renderer
contextBridge.exposeInMainWorld("chrome", {
  // Runtime API
  runtime: {
    getManifest: () => ipcRenderer.invoke("getManifest"),

    getURL: (path) => `file://${__dirname}/../renderer/${path}`,

    getId: () => "fehelper-electron",

    lastError: null,

    sendMessage: (message, callback) => {
      // Handle message from renderer
      if (message.type === "fh-dynamic-any-thing") {
        handleDynamicThing(message, callback);
      } else if (message.type === "open-dynamic-tool") {
        ipcRenderer.invoke("openTool", message.page, message.query);
      }
    },

    onMessage: {
      addListener: (callback) => {
        ipcRenderer.on("chrome-message", (event, message) => callback(message));
      },
      removeListener: (callback) => {
        ipcRenderer.removeListener("chrome-message", callback);
      },
    },

    openOptionsPage: () => ipcRenderer.invoke("openOptionsPage"),

    reload: () => ipcRenderer.invoke("window.reload"),
  },

  // Tabs API
  tabs: {
    query: (options, callback) => {
      ipcRenderer.invoke("tabs.query", options).then(callback);
    },

    create: (options, callback) => {
      ipcRenderer.invoke("tabs.create", options).then(callback);
    },

    sendMessage: (tabId, message, callback) => {
      ipcRenderer.invoke("tabs.sendMessage", tabId, message).then(callback);
    },

    update: (tabId, options, callback) => {
      if (callback) callback({ id: tabId });
    },

    reload: (tabId, callback) => {
      if (callback) callback();
    },
  },

  // Storage API
  storage: {
    local: {
      get: (keys, callback) => {
        ipcRenderer.invoke("storage.get", keys).then((result) => {
          if (callback) callback(result);
        });
      },

      set: (items, callback) => {
        ipcRenderer.invoke("storage.set", items).then(() => {
          if (callback) callback();
        });
      },

      remove: (keys, callback) => {
        ipcRenderer.invoke("storage.remove", keys).then(() => {
          if (callback) callback();
        });
      },
    },

    session: {
      get: (keys, callback) => {
        const key = Array.isArray(keys) ? keys[0] : keys;
        ipcRenderer.invoke("contentCache.get", key).then((result) => {
          if (callback) callback({ [key]: result });
        });
      },

      set: (items, callback) => {
        const [key, value] = Object.entries(items)[0];
        ipcRenderer.invoke("contentCache.set", key, value).then(() => {
          if (callback) callback();
        });
      },

      remove: (keys, callback) => {
        if (callback) callback();
      },
    },
  },

  // Notifications API
  notifications: {
    create: (id, options, callback) => {
      ipcRenderer.invoke("notifications.create", id, options).then(() => {
        if (callback) callback(id);
      });
    },

    clear: (id, callback) => {
      ipcRenderer.invoke("notifications.clear", id).then(() => {
        if (callback) callback(true);
      });
    },
  },

  // Context Menus API
  contextMenus: {
    create: (options, callback) => {
      ipcRenderer.invoke("contextMenus.create", options).then(() => {
        if (callback) callback("");
      });
    },

    remove: (id, callback) => {
      if (callback) callback();
    },
  },

  // Scripting API
  scripting: {
    executeScript: (options, callback) => {
      ipcRenderer.invoke("scripting.executeScript", options).then(() => {
        if (callback) callback();
      });
    },
  },

  // Commands API
  commands: {
    getAll: (callback) => {
      ipcRenderer.invoke("commands.getAll").then((commands) => {
        if (callback) callback(commands);
      });
    },
  },

  // Window API (extension-specific)
  windows: {
    getCurrent: (options, callback) => {
      if (callback) callback({ id: 1, focused: true });
    },

    update: (windowId, options, callback) => {
      if (callback) callback({ id: windowId });
    },
  },

  // Action API (Chrome Extension Manifest V3)
  action: {
    setBadgeText: (options) => {},
    getBadgeText: () => "",
    setPopup: (options) => {},
    onClicked: {
      addListener: (callback) => {
        ipcRenderer.on("action-clicked", () => callback());
      },
      removeListener: (callback) => {
        ipcRenderer.removeListener("action-clicked", callback);
      },
    },
  },

  // Alarms API
  alarms: {
    create: (name, options) => {},
    onAlarm: {
      addListener: (callback) => {},
    },
  },

  // Web Navigation API
  webNavigation: {
    onCompleted: {
      addListener: (callback) => {},
    },
    onDOMContentLoaded: {
      addListener: (callback) => {},
    },
  },

  // Shell API
  shell: {
    openExternal: (url) => ipcRenderer.invoke("shell.openExternal", url),
  },

  // App Info
  app: {
    getInfo: () => ipcRenderer.invoke("getAppInfo"),
  },
});

// Handle dynamic things (fh-dynamic-any-thing)
async function handleDynamicThing(message, callback) {
  const { thing, params } = message;

  switch (thing) {
    case "save-options":
      // Save options
      break;

    case "trigger-screenshot":
      const screenshot = await ipcRenderer.invoke("captureVisibleTab");
      if (callback) callback(screenshot);
      break;

    case "statistics-tool-usage":
      // Handle statistics
      break;

    default:
      if (callback) callback({ success: true });
  }
}

// Expose additional helpers
contextBridge.exposeInMainWorld("FhBridge", {
  // Capture visible tab
  captureVisibleTab: () => ipcRenderer.invoke("captureVisibleTab"),

  // Open tool
  openTool: (toolName, query) =>
    ipcRenderer.invoke("openTool", toolName, query),

  // Get content from cache
  getContent: (key) => ipcRenderer.invoke("contentCache.get", key),

  // Store content in cache
  setContent: (key, data) => ipcRenderer.invoke("contentCache.set", key, data),

  // Window controls
  closeWindow: () => ipcRenderer.invoke("window.close"),
  minimizeWindow: () => ipcRenderer.invoke("window.minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window.maximize"),

  // App info
  getAppInfo: () => ipcRenderer.invoke("getAppInfo"),

  // Send message to main process
  sendToMain: (channel, data) => ipcRenderer.send(channel, data),

  // Listen to main process messages
  onMainMessage: (channel, callback) => {
    ipcRenderer.on(channel, (event, data) => callback(data));
  },
});

// Log preload completion
console.log("FeHelper Electron preload script loaded");
