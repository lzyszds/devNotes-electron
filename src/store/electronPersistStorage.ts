import type { StateStorage } from "zustand/middleware";

/**
 * zustand persist → 主进程 electron-store。
 * 无 Electron IPC 时（纯 Web）退到进程内 Map，绝不回写 localStorage。
 *
 * zustand 传入的是 JSON 字符串；我们 parse 后把对象交给 storeSet，
 * 读回时再 stringify，避免 electron-store 里再套一层转义字符串。
 */
const memoryFallback = new Map<string, string>();

export const electronPersistStorage: StateStorage = {
  getItem: async (name) => {
    const api = window.electronAPI;
    if (api?.storeGet) {
      try {
        const value = await api.storeGet(name);
        if (value == null) return null;
        return typeof value === "string" ? value : JSON.stringify(value);
      } catch {
        return null;
      }
    }
    return memoryFallback.get(name) ?? null;
  },
  setItem: async (name, value) => {
    const api = window.electronAPI;
    if (api?.storeSet) {
      try {
        let parsed: unknown = value;
        try {
          parsed = JSON.parse(value);
        } catch {
          /* 非 JSON 就原样存 */
        }
        await api.storeSet(name, parsed);
      } catch {
        /* 写失败不抛到 UI */
      }
      return;
    }
    memoryFallback.set(name, value);
  },
  removeItem: async (name) => {
    const api = window.electronAPI;
    if (api?.storeDelete) {
      try {
        await api.storeDelete(name);
      } catch {
        /* ignore */
      }
      return;
    }
    memoryFallback.delete(name);
  },
};
