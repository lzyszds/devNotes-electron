/**
 * 一次性把旧 localStorage 迁进 electron-store，然后删掉旧 key。
 * 仅迁移期允许碰 localStorage；业务路径禁止再读写。
 */

function readLegacyRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLegacy(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 读旧值（JSON parse）；读完不删除，交给调用方决定 */
export function peekLegacyLocalJson<T>(key: string): T | undefined {
  const raw = readLegacyRaw(key);
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** 读旧字符串；用于非 JSON 偏好 */
export function peekLegacyLocalString(key: string): string | undefined {
  const raw = readLegacyRaw(key);
  return raw == null ? undefined : raw;
}

/** 删掉一批旧 key（迁移成功或 store 已有权威数据后调用） */
export function purgeLegacyLocalKeys(keys: string[]) {
  for (const key of keys) removeLegacy(key);
}

/**
 * 若 electron-store 尚无该 key，把 legacy localStorage 值写进去再删除。
 * 返回最终应用该用的值（store 已有则用 store，否则用 legacy，都没有则 undefined）。
 */
export async function adoptLegacyLocalJson<T>(
  storeKey: string,
  legacyKey: string,
): Promise<T | undefined> {
  const api = window.electronAPI;
  if (api?.storeGet) {
    try {
      const existing = await api.storeGet(storeKey);
      if (existing != null) {
        removeLegacy(legacyKey);
        return existing as T;
      }
    } catch {
      /* fall through */
    }
  }
  const legacy = peekLegacyLocalJson<T>(legacyKey);
  if (legacy === undefined) return undefined;
  if (api?.storeSet) {
    try {
      await api.storeSet(storeKey, legacy);
    } catch {
      /* ignore */
    }
  }
  removeLegacy(legacyKey);
  return legacy;
}
