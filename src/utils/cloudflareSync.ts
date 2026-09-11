import type { NoteItem, NotesState } from './notesStore'

export type CloudflareSyncMode = 'worker' | 'kv'

export interface BackupSnapshot {
  id: string
  timestamp: number
  trigger: 'auto' | 'manual' | 'startup' | 'rollback_guard'
  docCount: number
  sizeBytes: number
  noteTitles: string[]
  state: NotesState
}

export interface CloudflareSyncConfig {
  enabled: boolean
  mode: CloudflareSyncMode
  // Worker 模式
  workerUrl: string
  workerToken: string
  // KV 模式
  kvAccountId: string
  kvNamespaceId: string
  kvApiToken: string
  // 端到端加密（可选）
  enableE2EE: boolean
  encryptionPassword?: string
  // 自动化策略
  autoSync: boolean // 本地有修改防抖自动上传
  autoSyncOnStartup: boolean // 启动时自动从云端拉取最新
  // 自动备份快照配置
  autoBackupEnabled: boolean // 开启自动备份
  autoBackupIntervalMinutes: number // 自动备份间隔分钟数（默认 10）
  autoBackupOnEdit: boolean // 编辑停止后自动保存快照
  maxSnapshots: number // 保留最多历史快照数（默认 20）
  lastSyncTime?: number
  lastBackupTime?: number
}

export interface SyncPayload {
  version: number
  updatedAt: number
  deviceInfo: string
  encrypted: boolean
  data: string // 若加密则为 base64 ciphertext；若未加密则为 JSON.stringify(NotesState)
}

export interface SyncResult {
  success: boolean
  message: string
  remoteTime?: number
  mergedCount?: number
}

const CF_CONFIG_STORE_KEY = 'fehelper-cf-sync-config'
export const SNAPSHOTS_STORE_KEY = 'fehelper-backup-snapshots'

export const DEFAULT_CF_CONFIG: CloudflareSyncConfig = {
  enabled: true,
  mode: 'worker',
  workerUrl: 'https://fehelper.1024327189.workers.dev',
  workerToken: '',
  kvAccountId: '',
  kvNamespaceId: '',
  kvApiToken: '',
  enableE2EE: false,
  encryptionPassword: '',
  autoSync: true,
  autoSyncOnStartup: true,
  autoBackupEnabled: true,
  autoBackupIntervalMinutes: 10,
  autoBackupOnEdit: true,
  maxSnapshots: 20,
  lastSyncTime: 0,
  lastBackupTime: 0,
}

// ================= 1. 端到端加密 (Web Crypto AES-256-GCM) =================
async function getKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

export async function encryptData(plainText: string, password?: string): Promise<string> {
  if (!password) return plainText

  const enc = new TextEncoder()
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const key = await getKeyFromPassword(password, salt)

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    enc.encode(plainText)
  )

  // 包装 salt (16 bytes) + iv (12 bytes) + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + encryptedBuffer.byteLength)
  combined.set(salt, 0)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(encryptedBuffer), salt.length + iv.length)

  return bufferToBase64(combined.buffer)
}

export async function decryptData(cipherBase64: string, password?: string): Promise<string> {
  if (!password) return cipherBase64

  try {
    const rawBuffer = base64ToBuffer(cipherBase64)
    const rawBytes = new Uint8Array(rawBuffer)

    const salt = rawBytes.slice(0, 16)
    const iv = rawBytes.slice(16, 28)
    const data = rawBytes.slice(28)

    const key = await getKeyFromPassword(password, salt)
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      key,
      data as any
    )

    const dec = new TextDecoder()
    return dec.decode(decryptedBuffer)
  } catch {
    throw new Error('解密失败：同步加密密码错误或云端数据已损坏')
  }
}

// ================= 2. 网络传输适配层 (Electron 跨域优先，浏览器原生 fallback) =================
async function executeRequest(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
  }
): Promise<{ ok: boolean; status: number; text: string }> {
  // 1. Electron 代理，彻底避免 CORS 跨域问题
  if (window.electronAPI?.translateFetch) {
    try {
      const res = await window.electronAPI.translateFetch({
        url,
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body,
        timeout: 15000,
      })
      return {
        ok: res.ok,
        status: res.status,
        text: res.text,
      }
    } catch {
      // fallback to browser fetch
    }
  }

  // 2. 标准 fetch
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
  })
  const text = await res.text()
  return {
    ok: res.ok,
    status: res.status,
    text,
  }
}

// ================= 3. Cloudflare 操作层 (Worker & KV) =================
export async function testCloudflareConnection(config: CloudflareSyncConfig): Promise<{
  ok: boolean
  message: string
}> {
  try {
    if (config.mode === 'worker') {
      if (!config.workerUrl) {
        return { ok: false, message: '请填写 Cloudflare Worker 完整地址' }
      }
      const pingUrl = config.workerUrl.replace(/\/+$/, '') + '/health'
      const res = await executeRequest(pingUrl, {
        headers: config.workerToken
          ? {
              Authorization: `Bearer ${config.workerToken}`,
              'x-sync-token': config.workerToken,
            }
          : undefined,
      })

      if (res.ok) {
        return { ok: true, message: '连接成功：Cloudflare Worker 状态正常响应' }
      }
      return {
        ok: false,
        message: `Worker 响应异常 (HTTP ${res.status}): ${res.text.slice(0, 120)}`,
      }
    } else {
      // KV 模式测试
      if (!config.kvAccountId || !config.kvNamespaceId || !config.kvApiToken) {
        return { ok: false, message: '请完整填写 Cloudflare Account ID、KV ID 及 API Token' }
      }
      const testUrl = `https://api.cloudflare.com/client/v4/accounts/${config.kvAccountId}/storage/kv/namespaces/${config.kvNamespaceId}/values/__ping_test__`
      const res = await executeRequest(testUrl, {
        headers: {
          Authorization: `Bearer ${config.kvApiToken}`,
        },
      })

      // 404 说明 KV 存在且 API Token 拥有读取权限，可以访问此 Namespace
      if (res.ok || res.status === 404) {
        return { ok: true, message: '连接成功：Cloudflare KV 命名空间认证通过' }
      }
      return {
        ok: false,
        message: `Cloudflare KV 认证失败 (HTTP ${res.status}): ${res.text.slice(0, 120)}`,
      }
    }
  } catch (err: any) {
    return { ok: false, message: `网络连接错误: ${err?.message || '无法连接到 Cloudflare'}` }
  }
}

// 推送备份到云端
export async function pushToCloudflare(
  state: NotesState,
  config: CloudflareSyncConfig
): Promise<SyncResult> {
  try {
    const rawJson = JSON.stringify(state)
    const isEncrypted = Boolean(config.enableE2EE && config.encryptionPassword)
    const payloadData = isEncrypted
      ? await encryptData(rawJson, config.encryptionPassword)
      : rawJson

    const payload: SyncPayload = {
      version: 1,
      updatedAt: Date.now(),
      deviceInfo: 'FeHelper Desktop Pro',
      encrypted: isEncrypted,
      data: payloadData,
    }

    const payloadStr = JSON.stringify(payload)

    if (config.mode === 'worker') {
      const url = config.workerUrl.replace(/\/+$/, '') + '/sync'
      const res = await executeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.workerToken}`,
          'x-sync-token': config.workerToken,
        },
        body: payloadStr,
      })

      if (!res.ok) {
        throw new Error(`Worker 上传失败 (HTTP ${res.status}): ${res.text.slice(0, 120)}`)
      }
    } else {
      const url = `https://api.cloudflare.com/client/v4/accounts/${config.kvAccountId}/storage/kv/namespaces/${config.kvNamespaceId}/values/fehelper_notes_backup`
      const res = await executeRequest(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.kvApiToken}`,
        },
        body: payloadStr,
      })

      if (!res.ok) {
        throw new Error(`Cloudflare KV 保存失败 (HTTP ${res.status}): ${res.text.slice(0, 120)}`)
      }
    }

    return {
      success: true,
      message: `备份成功（已同步 ${state.notes.length} 篇文档）`,
      remoteTime: payload.updatedAt,
    }
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || '备份至 Cloudflare 失败',
    }
  }
}

// 从云端拉取备份数据
export async function pullFromCloudflare(config: CloudflareSyncConfig): Promise<{
  success: boolean
  message: string
  remoteState?: NotesState
  remoteTime?: number
}> {
  try {
    let rawPayloadText = ''

    if (config.mode === 'worker') {
      const url = config.workerUrl.replace(/\/+$/, '') + '/sync'
      const res = await executeRequest(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.workerToken}`,
          'x-sync-token': config.workerToken,
        },
      })

      if (res.status === 404 || !res.text || res.text === '{}') {
        return { success: false, message: '云端暂无备份数据，请先执行一次备份' }
      }
      if (!res.ok) {
        throw new Error(`Worker 拉取失败 (HTTP ${res.status}): ${res.text.slice(0, 120)}`)
      }
      rawPayloadText = res.text
    } else {
      const url = `https://api.cloudflare.com/client/v4/accounts/${config.kvAccountId}/storage/kv/namespaces/${config.kvNamespaceId}/values/fehelper_notes_backup`
      const res = await executeRequest(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.kvApiToken}`,
        },
      })

      if (res.status === 404 || !res.text) {
        return { success: false, message: 'Cloudflare KV 空间内未找到备份记录' }
      }
      if (!res.ok) {
        throw new Error(`Cloudflare KV 拉取失败 (HTTP ${res.status}): ${res.text.slice(0, 120)}`)
      }
      rawPayloadText = res.text
    }

    const payload: SyncPayload = JSON.parse(rawPayloadText)
    let jsonString = payload.data

    if (payload.encrypted) {
      if (!config.encryptionPassword) {
        throw new Error('该备份已被端到端加密，请在设置中输入密码后重试解密拉取')
      }
      jsonString = await decryptData(payload.data, config.encryptionPassword)
    }

    const remoteState: NotesState = JSON.parse(jsonString)
    return {
      success: true,
      message: '拉取成功',
      remoteState,
      remoteTime: payload.updatedAt,
    }
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || '从 Cloudflare 拉取失败',
    }
  }
}

// ================= 4. 智能文档合并算法 (Smart Merge) =================
export function smartMergeNotes(local: NotesState, remote: NotesState): {
  mergedState: NotesState
  addedFromRemote: number
  updatedFromRemote: number
} {
  const localMap = new Map<string, NoteItem>()
  local.notes.forEach((note) => localMap.set(note.id, note))

  let addedFromRemote = 0
  let updatedFromRemote = 0

  const resultMap = new Map<string, NoteItem>(localMap)

  remote.notes.forEach((remoteNote) => {
    const localNote = localMap.get(remoteNote.id)
    if (!localNote) {
      // 本地没有这篇，吸收云端新笔记
      resultMap.set(remoteNote.id, remoteNote)
      addedFromRemote++
    } else {
      // 双方都有，保留修改时间最新的一份
      if (remoteNote.updatedAt > localNote.updatedAt) {
        resultMap.set(remoteNote.id, remoteNote)
        updatedFromRemote++
      }
    }
  })

  const mergedNotes = Array.from(resultMap.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  )

  const activeId =
    (local.activeId && mergedNotes.some((n) => n.id === local.activeId)
      ? local.activeId
      : mergedNotes[0]?.id) || null

  return {
    mergedState: { notes: mergedNotes, activeId },
    addedFromRemote,
    updatedFromRemote,
  }
}

// ================= 5. 配置读写与持久化 =================
export async function loadCloudflareConfig(): Promise<CloudflareSyncConfig> {
  try {
    let cfg: CloudflareSyncConfig | null = null
    if (window.electronAPI?.storeGet) {
      const stored = await window.electronAPI.storeGet(CF_CONFIG_STORE_KEY)
      if (stored && typeof stored === 'object') {
        cfg = { ...DEFAULT_CF_CONFIG, ...stored }
      }
    }
    if (!cfg) {
      const local = localStorage.getItem(CF_CONFIG_STORE_KEY)
      if (local) {
        cfg = { ...DEFAULT_CF_CONFIG, ...JSON.parse(local) }
      }
    }
    if (!cfg || !cfg.workerUrl) {
      cfg = { ...DEFAULT_CF_CONFIG, ...(cfg || {}), workerUrl: DEFAULT_CF_CONFIG.workerUrl, enabled: true }
      void saveCloudflareConfig(cfg)
    }
    return cfg
  } catch {
    return DEFAULT_CF_CONFIG
  }
}

export async function saveCloudflareConfig(config: CloudflareSyncConfig): Promise<void> {
  try {
    if (window.electronAPI?.storeSet) {
      await window.electronAPI.storeSet(CF_CONFIG_STORE_KEY, config)
    }
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(CF_CONFIG_STORE_KEY, JSON.stringify(config))
  } catch {
    // ignore
  }
}

export async function loadBackupSnapshots(): Promise<BackupSnapshot[]> {
  try {
    if (window.electronAPI?.storeGet) {
      const stored = await window.electronAPI.storeGet(SNAPSHOTS_STORE_KEY)
      if (Array.isArray(stored)) return stored
    }
    const local = localStorage.getItem(SNAPSHOTS_STORE_KEY)
    if (local) {
      const parsed = JSON.parse(local)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    // ignore
  }
  return []
}

export async function saveBackupSnapshots(snapshots: BackupSnapshot[]): Promise<void> {
  try {
    if (window.electronAPI?.storeSet) {
      await window.electronAPI.storeSet(SNAPSHOTS_STORE_KEY, snapshots)
    }
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(SNAPSHOTS_STORE_KEY, JSON.stringify(snapshots))
  } catch {
    // ignore
  }
}

export function createSnapshotFromState(
  state: NotesState,
  trigger: 'auto' | 'manual' | 'startup' | 'rollback_guard'
): BackupSnapshot {
  const jsonStr = JSON.stringify(state)
  return {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    trigger,
    docCount: state.notes.length,
    sizeBytes: new Blob([jsonStr]).size,
    noteTitles: state.notes.map((n) => n.title || '未命名笔记').slice(0, 5),
    state: JSON.parse(jsonStr),
  }
}

// ================= 6. 1分钟部署 Cloudflare Worker 代码模板 =================
export const CLOUDFLARE_WORKER_SCRIPT = `/**
 * FeHelper Notes Cloudflare Worker 同步网关
 * 部署指南：
 * 1. 登录 Cloudflare Dashboard -> Workers & Pages -> Create Worker
 * 2. 将此代码全选替换并点击 Deploy 保存发布
 * 3. 在 Settings -> Variables 中添加 KV Namespace 绑定 (变量名必须为: FEHELPER_KV)
 * 4. 可选：在 Settings -> Variables 中添加环境变量 SECRET_TOKEN (如: my_secret_key)
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-sync-token',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 鉴权校验（如果配置了 SECRET_TOKEN）
    if (env.SECRET_TOKEN) {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.replace('Bearer ', '') || request.headers.get('x-sync-token');
      if (token !== env.SECRET_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid sync token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const url = new URL(request.url);

    // 健康检查探针
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'FeHelper CF Sync' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/sync') {
      if (!env.FEHELPER_KV) {
        return new Response(JSON.stringify({ error: 'Worker未绑定 FEHELPER_KV 命名空间' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 获取云端备份
      if (request.method === 'GET') {
        const data = await env.FEHELPER_KV.get('fehelper_notes_backup');
        if (!data) {
          return new Response(JSON.stringify({}), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(data, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 上传备份
      if (request.method === 'POST') {
        const body = await request.text();
        await env.FEHELPER_KV.put('fehelper_notes_backup', body);
        return new Response(JSON.stringify({ success: true, savedAt: Date.now() }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('FeHelper Cloudflare Sync Worker is running', { headers: corsHeaders });
  },
};
`
