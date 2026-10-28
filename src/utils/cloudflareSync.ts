import {
  normalizeState,
  sortNotes,
  visibleFolders,
  visibleNotes,
  type FolderItem,
  type NoteItem,
  type NotesState,
  type ReadingBookmark,
} from './notesStore'
import { compressImageToWebp } from './imageCompress'

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
  // 敏感密钥同步策略：AI / 翻译的 API Key 默认不出本机，显式开启后才随同步上传
  //（上传前会用 encryptionPassword 单独加密，见 SENSITIVE_SETTING_KEYS）
  syncApiKeys: boolean
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

export interface StructuredSettings {
  /** 界面与外观主题 */
  appearance?: {
    theme?: string
    codeTheme?: string
  }
  /** 编辑器偏好设置 */
  editor?: {
    mode?: string
    split?: string
    view?: string
    zoom?: number
    sidebarWidth?: number
  }
  /** 翻译模块配置 */
  translate?: {
    primaryLang?: string
    apiConfig?: unknown
    prefs?: unknown
  }
  /** 快捷键绑定 */
  shortcuts?: {
    bindings?: Record<string, string>
  }
  /** 工作台导航布局 */
  workspace?: {
    railToolIds?: string[]
  }
  /** 剪贴板历史（云端存储已脱敏：图片被丢弃，以【图片】占位，保护服务器硬盘） */
  clipboard?: {
    history?: unknown[]
  }
  /** 项目级 AI 渠道多服务商独立配置 */
  aiChannel?: unknown
  /** 各独立工具设置 */
  tools?: {
    speech?: unknown
    jsonI18n?: unknown
    jsonI18nProtectedTerms?: unknown
  }
  [key: string]: unknown
}

export interface SyncPayloadSummary {
  noteCount: number
  folderCount: number
  trashedCount: number
}

export interface SyncPayload {
  app?: string
  version: number
  updatedAt: number
  updatedAtIso?: string
  deviceInfo: string
  encrypted: boolean
  summary?: SyncPayloadSummary
  // 未加密时直接为 NotesState 对象；端到端加密开启时为密文字符串 (ciphertext)
  data: NotesState | string
  /**
   * 应用设置快照（结构化分组存储）。
   * 未加密时直接为 StructuredSettings 对象；加密时为密文字符串。
   */
  settings?: StructuredSettings | SettingsSnapshot | string
}

/**
 * 要上云的设置项。
 *
 * 白名单而不是黑名单：新增的存储键默认不同步，得在这里显式登记。
 * 反过来做的话，某个临时状态或设备相关的键会不知不觉被带到别的机器上。
 *
 * 键名必须与各模块里 `*_KEY` 常量一致 —— 写错既不报错也不会同步到，
 * 改动这里时对着那些常量核一遍。
 */
export const SYNCED_SETTING_KEYS = [
  // 剪贴板历史（上传前自动剔除图片 Base64，用【图片】占位，防止撑爆云端）
  'clipboard-history',
  // 翻译与模型（不含密钥配置 —— API Key 走下面的敏感键通道）
  'text-translate-primary-lang',
  'text-translate-prefs',
  // 快捷键
  'shortcut-bindings',
  // 左侧菜单栏的默认项
  'rail-tool-ids',
  // 外观与界面偏好
  'fehelper-theme',
  'fehelper-code-theme',
  'fehelper-editor-mode',
  'fehelper-editor-split',
  'fehelper-editor-view',
  'fehelper-editor-zoom',
  'fehelper-sidebar-width',
  // 朗读设置
  'fehelper-speech-settings',
  // 各工具的局部设置
  'json-i18n-settings',
  'json-i18n-protected-terms',
] as const

/**
 * 含密钥的敏感设置项，独立于普通白名单单独管理。
 *
 * 这些键里存着用户的 API Key（AI 渠道、翻译服务），明文上云等于把密钥
 * 交给同步服务器。因此默认一律不上云；只有用户在设置里显式开启
 * 「同步 API 密钥」（cfConfig.syncApiKeys）后才会收集，且必须先设置
 * 端到端加密密码 —— 密钥单独用该密码加密后（见 SECRET_CIPHER_PREFIX）
 * 才会离开本机，即使整体 payload 未开 E2EE，密钥也始终是密文。
 */
export const SENSITIVE_SETTING_KEYS = [
  // 项目级 AI 渠道配置（各服务商独立配置字典，内含 apiKey）
  'ai-channel-config',
  // 翻译服务配置（内含 apiKey）
  'translate-api-config',
] as const

/** 敏感键上云时的密文前缀，拉取端据此识别需要解密的值 */
export const SECRET_CIPHER_PREFIX = 'e2ee::'

/** 设置快照：键 -> 值。值为 null 表示该项被显式清空 */
export type SettingsSnapshot = Record<string, unknown>

/**
 * 这些键存在 localStorage（历史原因：主题、编辑器偏好等都是渲染端自查自存，
 * 不需要主进程参与）。同步时要按存放位置分流 —— 全走 storeGet 会读不到，
 * 而且是静默失败：白名单里列着，实际一个字节都没上云。
 */
const LOCAL_STORAGE_SETTING_KEYS = new Set([
  'fehelper-theme',
  'fehelper-code-theme',
  'fehelper-editor-mode',
  'fehelper-editor-split',
  'fehelper-editor-view',
  'fehelper-sidebar-width',
  'text-translate-primary-lang',
])

/**
 * 从本地存储收集要同步的设置。
 *
 * 按键的存放位置分流读：localStorage 的走同步 getItem，其余走 electron-store。
 * 只取存在且有值的项 —— 没设过的项不上云，免得用空值覆盖别的机器。
 */
export async function collectSettings(): Promise<SettingsSnapshot> {
  const snapshot: SettingsSnapshot = {}
  const api = window.electronAPI

  for (const key of SYNCED_SETTING_KEYS) {
    try {
      if (LOCAL_STORAGE_SETTING_KEYS.has(key)) {
        const raw = localStorage.getItem(key)
        if (raw !== null) snapshot[key] = raw
        continue
      }
      const value = await api?.storeGet?.(key)
      if (value !== undefined && value !== null) {
        if (key === 'clipboard-history' && Array.isArray(value)) {
          // 用户硬性要求：剪切板的图片不要同步，云端直接丢弃图片数据，用【图片】来表示
          // 彻底剔除图片 base64/二进制数据，保护服务器硬盘空间，同时允许文本在多端同步
          snapshot[key] = value.map((entry: any) => {
            if (!entry || typeof entry !== 'object') return entry
            if (entry.type === 'image' || entry.imageDataUrl) {
              return {
                id: entry.id,
                type: 'text',
                text: '【图片】',
                at: entry.at || Date.now(),
              }
            }
            return entry
          })
        } else {
          snapshot[key] = value
        }
      }
    } catch {
      // 单项读失败不该拖垮整次同步，跳过即可
    }
  }
  return snapshot
}

/**
 * 单独收集敏感（含密钥）设置项。
 *
 * 与普通设置分开读：只在用户显式开启「同步 API 密钥」后才会被调用，
 * 避免白名单一改、密钥就跟着普通设置悄悄上云。
 */
async function collectSecretSettings(): Promise<SettingsSnapshot> {
  const snapshot: SettingsSnapshot = {}
  const api = window.electronAPI

  for (const key of SENSITIVE_SETTING_KEYS) {
    try {
      const value = await api?.storeGet?.(key)
      if (value !== undefined && value !== null) snapshot[key] = value
    } catch {
      // 单项读失败不该拖垮整次同步，跳过即可
    }
  }
  return snapshot
}

/**
 * 把敏感键加密后注入设置快照（上云前调用）。
 *
 * 统一走 encryptionPassword 派生的 AES-256-GCM 密钥 —— 与笔记正文 E2EE
 * 同一套加密体系，用户只需记一个密码。值统一加 SECRET_CIPHER_PREFIX
 * 便于拉取端识别；先 JSON.stringify 是因为键值本身可能是对象，
 * 解密端按字符串还原后再 parse 回来。
 */
async function encryptSecretSettings(
  snapshot: SettingsSnapshot,
  password: string
): Promise<void> {
  for (const key of SENSITIVE_SETTING_KEYS) {
    if (!(key in snapshot)) continue
    const plain = JSON.stringify(snapshot[key])
    snapshot[key] = SECRET_CIPHER_PREFIX + (await encryptData(plain, password))
  }
}

/**
 * 拉取端还原敏感键：识别密文前缀并解密。
 *
 * 解不开（密码不对 / 未设密码）的键直接剔除 —— 把密文原样写进本地存储
 * 会让 AI / 翻译功能直接失效，剔除后用户重新填一次 Key 即可，
 * 比静默写坏数据体面。
 */
async function decryptSecretSettings(
  snapshot: SettingsSnapshot,
  password?: string
): Promise<void> {
  for (const key of SENSITIVE_SETTING_KEYS) {
    const value = snapshot[key]
    if (typeof value !== 'string' || !value.startsWith(SECRET_CIPHER_PREFIX)) continue
    if (!password) {
      delete snapshot[key]
      continue
    }
    try {
      const plain = await decryptData(value.slice(SECRET_CIPHER_PREFIX.length), password)
      snapshot[key] = JSON.parse(plain)
    } catch {
      delete snapshot[key]
    }
  }
}

/**
 * 合并剪贴板历史：
 * 1. 按 id 对齐去重；
 * 2. 如果本地已有带真实 imageDataUrl 的图片记录，而云端是脱敏后的【图片】，必须保留本地真实图片；
 * 3. 跨设备同步过来的新文本/记录正常加入；
 * 4. 按采集时间倒序排列，最多保留 1000 条。
 */
function mergeClipboardHistory(localList: any[], remoteList: any[]): any[] {
  const map = new Map<string, any>()
  for (const item of localList) {
    if (item && item.id) {
      map.set(item.id, item)
    }
  }
  for (const remoteItem of remoteList) {
    if (!remoteItem || !remoteItem.id) continue
    const localItem = map.get(remoteItem.id)
    if (!localItem) {
      map.set(remoteItem.id, remoteItem)
    } else {
      // 本地已有该条目：若本地有图片，远端是【图片】脱敏占位，保留本地图片数据
      if (localItem.imageDataUrl && (!remoteItem.imageDataUrl || remoteItem.text === '【图片】')) {
        // 保留本地真实图片
      } else if ((remoteItem.at || 0) > (localItem.at || 0)) {
        map.set(remoteItem.id, remoteItem)
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 1000)
}

/**
 * 把云端设置写回本地。
 *
 * 逐项写入而不是整体替换：远端快照可能来自旧版本、缺某些键，
 * 整体替换会把本地已有但远端没有的设置抹掉。
 */
export async function applySettings(snapshot: SettingsSnapshot): Promise<number> {
  const api = window.electronAPI

  let applied = 0
  for (const key of [...SYNCED_SETTING_KEYS, ...SENSITIVE_SETTING_KEYS]) {
    if (!(key in snapshot)) continue
    // null 表示云端已清空（例如用户关闭了密钥同步），不回写本地，
    // 免得把本机正在使用的配置冲掉
    if (snapshot[key] === null) continue
    try {
      if (LOCAL_STORAGE_SETTING_KEYS.has(key)) {
        // localStorage 要求字符串；云端存的是当初读出来的原样，直接写回
        localStorage.setItem(key, String(snapshot[key]))
      } else if (key === 'clipboard-history' && Array.isArray(snapshot[key])) {
        // 剪贴板历史采用安全合并，防止冲掉本地未脱敏的真实图片
        const localCurrent = (await api?.storeGet?.(key)) || []
        const merged = mergeClipboardHistory(
          Array.isArray(localCurrent) ? localCurrent : [],
          snapshot[key] as any[]
        )
        await api?.storeSet?.(key, merged)
      } else {
        await api?.storeSet?.(key, snapshot[key])
      }
      applied++
    } catch {
      // 同上，单项失败不中断
    }
  }

  /*
   * 把云端值落到本地后，还得让「已经加载进内存」的模块知道。
   *
   * 有些设置在模块里缓存了一份（快捷键的 Map、主题的当前值），写盘只改了
   * 存储，内存里还是旧值 —— 不刷新的话，用户会发现键盘按下去还是老键位，
   * 得重启才生效。
   */
  if ('shortcut-bindings' in snapshot) {
    const { refreshShortcutMap } = await import('./shortcutSettings')
    await refreshShortcutMap()
  }

  // 左侧菜单栏同理：Rail 读的是内存里那份缓存，写盘不会让它变
  if ('rail-tool-ids' in snapshot) {
    const { refreshRailToolIds } = await import('./sidebarLayout')
    await refreshRailToolIds()
  }

  return applied
}

/** 将本地扁平键值 map 打包为结构化对象，便于云端存储与后台查阅 */
export function packStructuredSettings(flat: SettingsSnapshot): StructuredSettings {
  const result: StructuredSettings = {}

  if (flat['fehelper-theme'] !== undefined || flat['fehelper-code-theme'] !== undefined) {
    result.appearance = {
      theme: flat['fehelper-theme'] as string | undefined,
      codeTheme: flat['fehelper-code-theme'] as string | undefined,
    }
  }

  if (
    flat['fehelper-editor-mode'] !== undefined ||
    flat['fehelper-editor-split'] !== undefined ||
    flat['fehelper-editor-view'] !== undefined ||
    flat['fehelper-editor-zoom'] !== undefined ||
    flat['fehelper-sidebar-width'] !== undefined
  ) {
    result.editor = {
      mode: flat['fehelper-editor-mode'] as string | undefined,
      split: flat['fehelper-editor-split'] as string | undefined,
      view: flat['fehelper-editor-view'] as string | undefined,
      zoom: flat['fehelper-editor-zoom'] !== undefined ? Number(flat['fehelper-editor-zoom']) : undefined,
      sidebarWidth: flat['fehelper-sidebar-width'] !== undefined ? Number(flat['fehelper-sidebar-width']) : undefined,
    }
  }

  if (
    flat['text-translate-primary-lang'] !== undefined ||
    flat['translate-api-config'] !== undefined ||
    flat['text-translate-prefs'] !== undefined
  ) {
    result.translate = {
      primaryLang: flat['text-translate-primary-lang'] as string | undefined,
      apiConfig: flat['translate-api-config'],
      prefs: flat['text-translate-prefs'],
    }
  }

  if (flat['shortcut-bindings'] !== undefined) {
    result.shortcuts = {
      bindings: flat['shortcut-bindings'] as Record<string, string>,
    }
  }

  if (flat['rail-tool-ids'] !== undefined) {
    result.workspace = {
      railToolIds: flat['rail-tool-ids'] as string[],
    }
  }

  if (flat['clipboard-history'] !== undefined) {
    result.clipboard = {
      history: flat['clipboard-history'] as unknown[],
    }
  }

  if (flat['ai-channel-config'] !== undefined) {
    result.aiChannel = flat['ai-channel-config']
  }

  if (
    flat['fehelper-speech-settings'] !== undefined ||
    flat['json-i18n-settings'] !== undefined ||
    flat['json-i18n-protected-terms'] !== undefined
  ) {
    result.tools = {
      speech: flat['fehelper-speech-settings'],
      jsonI18n: flat['json-i18n-settings'],
      jsonI18nProtectedTerms: flat['json-i18n-protected-terms'],
    }
  }

  return result
}

/** 将结构化对象解包还原为本地扁平键值 map（双向兼容老版本与新版本） */
export function unpackStructuredSettings(settings: any): SettingsSnapshot {
  if (!settings || typeof settings !== 'object') return {}

  const flat: SettingsSnapshot = {}

  // 1. 兼容老版本直接保存的平铺键（含敏感键：老备份里的密钥是明文平铺存的）
  for (const k of [...SYNCED_SETTING_KEYS, ...SENSITIVE_SETTING_KEYS]) {
    if (k in settings && settings[k] !== undefined) {
      flat[k] = settings[k]
    }
  }

  // 2. 解包新版本的分类结构
  if (settings.appearance && typeof settings.appearance === 'object') {
    if (settings.appearance.theme !== undefined) flat['fehelper-theme'] = settings.appearance.theme
    if (settings.appearance.codeTheme !== undefined) flat['fehelper-code-theme'] = settings.appearance.codeTheme
  }
  if (settings.editor && typeof settings.editor === 'object') {
    if (settings.editor.mode !== undefined) flat['fehelper-editor-mode'] = settings.editor.mode
    if (settings.editor.split !== undefined) flat['fehelper-editor-split'] = settings.editor.split
    if (settings.editor.view !== undefined) flat['fehelper-editor-view'] = settings.editor.view
    if (settings.editor.zoom !== undefined) flat['fehelper-editor-zoom'] = settings.editor.zoom
    if (settings.editor.sidebarWidth !== undefined) flat['fehelper-sidebar-width'] = settings.editor.sidebarWidth
  }
  if (settings.translate && typeof settings.translate === 'object') {
    if (settings.translate.primaryLang !== undefined) flat['text-translate-primary-lang'] = settings.translate.primaryLang
    if (settings.translate.apiConfig !== undefined) flat['translate-api-config'] = settings.translate.apiConfig
    if (settings.translate.prefs !== undefined) flat['text-translate-prefs'] = settings.translate.prefs
  }
  if (settings.shortcuts && typeof settings.shortcuts === 'object') {
    if (settings.shortcuts.bindings !== undefined) flat['shortcut-bindings'] = settings.shortcuts.bindings
  }
  if (settings.workspace && typeof settings.workspace === 'object') {
    if (settings.workspace.railToolIds !== undefined) flat['rail-tool-ids'] = settings.workspace.railToolIds
  }
  if (settings.clipboard && typeof settings.clipboard === 'object') {
    if (settings.clipboard.history !== undefined) flat['clipboard-history'] = settings.clipboard.history
  }
  if (settings.aiChannel !== undefined) {
    flat['ai-channel-config'] = settings.aiChannel
  }
  if (settings.tools && typeof settings.tools === 'object') {
    if (settings.tools.speech !== undefined) flat['fehelper-speech-settings'] = settings.tools.speech
    if (settings.tools.jsonI18n !== undefined) flat['json-i18n-settings'] = settings.tools.jsonI18n
    if (settings.tools.jsonI18nProtectedTerms !== undefined) flat['json-i18n-protected-terms'] = settings.tools.jsonI18nProtectedTerms
  }

  return flat
}

export interface SyncResult {
  success: boolean
  message: string
  remoteTime?: number
  mergedCount?: number
}

const CF_CONFIG_STORE_KEY = 'fehelper-cf-sync-config'
export const SNAPSHOTS_STORE_KEY = 'fehelper-backup-snapshots'

/**
 * 默认自有云端同步服务地址
 */
export const DEFAULT_SERVER_URL = 'https://sync.lzyszds.cn'

export const DEFAULT_CF_CONFIG: CloudflareSyncConfig = {
  enabled: false,
  mode: 'worker',
  workerUrl: DEFAULT_SERVER_URL,
  workerToken: '',
  kvAccountId: '',
  kvNamespaceId: '',
  kvApiToken: '',
  enableE2EE: false,
  encryptionPassword: '',
  syncApiKeys: false,
  autoSync: false,
  autoSyncOnStartup: false,
  autoBackupEnabled: false,
  autoBackupIntervalMinutes: 10,
  autoBackupOnEdit: false,
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

/**
 * 当前客户端专属应用租户标识
 */
export const APP_SYNC_ID = 'notes'

/**
 * 规范化多应用云同步服务路由：
 * 将用户配置的服务基础地址自动对齐到 `/${app}/sync` 端点，
 * 同时兼容健康检查 `/health` 路径。
 */
export function resolveSyncEndpoints(rawServerUrl: string, appId: string = APP_SYNC_ID): {
  healthUrl: string
  syncUrl: string
  uploadUrl: string
} {
  let base = (rawServerUrl || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '')
  // 若传入带有末尾 /sync，先去除
  if (base.endsWith('/sync')) {
    base = base.slice(0, -5).replace(/\/+$/, '')
  }
  // 若传入末尾已经带有 /notes 或对应 app，提取基础域名
  if (base.endsWith(`/${appId}`)) {
    const root = base.slice(0, -(appId.length + 1)).replace(/\/+$/, '')
    return {
      healthUrl: `${root}/health`,
      syncUrl: `${base}/sync`,
      uploadUrl: `${base}/upload`,
    }
  }
  return {
    healthUrl: `${base}/health`,
    syncUrl: `${base}/${appId}/sync`,
    uploadUrl: `${base}/${appId}/upload`,
  }
}

/**
 * 上传笔记图片/媒体附件至统一云端对象存储 (POST /:app/upload)。
 *
 * 关键优化策略（保护轻量云服务器磁盘）：
 * 1. 客户端使用 Canvas 自动进行高质量 WebP 压缩，长边限制不超过 1920px（避免超清 Retina 截图/4K 巨图撑爆云服务器磁盘）；
 * 2. 压缩率通常达 85%~95%（数 MB 截图压缩为 80~200KB），大幅节省网络上传与下载耗时；
 * 3. 矢量图（SVG）自动跳过转换保留原始无损；
 * 4. 压缩异常时优雅回退原始数据，保障用户输入不中断；
 * 5. 优先使用当前配置的云同步凭据；若未配置或失败，返回错误以便调用方降级为 Data URL。
 */
export async function uploadSyncImage(
  fileOrBase64: File | Blob | string,
  filename?: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const config = await loadCloudflareConfig()
    if (!config.enabled) {
      return { ok: false, error: '未开启云端同步服务' }
    }
    const serverUrl = (config.workerUrl || DEFAULT_SERVER_URL).trim()
    const token = (config.workerToken || '').trim()
    if (!token || token.length < 8) {
      return { ok: false, error: '未配置有效的同步凭据 (Token)' }
    }

    // 1. 客户端 WebP 压缩与格式转换（保护服务器磁盘，SVG 自动保留矢量）
    let uploadBlob: Blob
    let isSvg = false
    const rawName = filename || (fileOrBase64 instanceof File ? fileOrBase64.name : `img_${Date.now()}`)
    const baseName = rawName.replace(/\.[^.]+$/, '')

    try {
      const compressResult = await compressImageToWebp(fileOrBase64, {
        maxEdge: 1920,
        quality: 0.82,
      })
      uploadBlob = compressResult.blob
      isSvg = compressResult.blob.type === 'image/svg+xml'
    } catch (compressErr) {
      console.warn('图片客户端 WebP 压缩跳过/失败，使用原始对象:', compressErr)
      if (fileOrBase64 instanceof Blob) {
        uploadBlob = fileOrBase64
        isSvg = fileOrBase64.type === 'image/svg+xml'
      } else if (typeof fileOrBase64 === 'string') {
        const base64Data = fileOrBase64.includes(',') ? fileOrBase64.split(',')[1] : fileOrBase64
        const mimeMatch = fileOrBase64.match(/^data:([^;]+);base64,/)
        const mime = mimeMatch ? mimeMatch[1] : 'image/png'
        const raw = atob(base64Data)
        const u8 = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) {
          u8[i] = raw.charCodeAt(i)
        }
        uploadBlob = new Blob([u8], { type: mime })
        isSvg = mime === 'image/svg+xml'
      } else {
        return { ok: false, error: '不支持的文件类型' }
      }
    }

    const finalExt = isSvg ? '.svg' : '.webp'
    const finalFilename = `${baseName}${finalExt}`

    const { uploadUrl } = resolveSyncEndpoints(serverUrl, APP_SYNC_ID)
    const formData = new FormData()
    formData.append('file', uploadBlob, finalFilename)

    // FormData 上传走原生 fetch（Nginx CORS 已全量放行）
    const fetchRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-App-Id': APP_SYNC_ID,
        'x-sync-token': token,
      },
      body: formData,
    })
    const text = await fetchRes.text()
    const res = {
      ok: fetchRes.ok,
      status: fetchRes.status,
      text,
    }

    if (!res.ok) {
      return { ok: false, error: `服务器上传失败 (HTTP ${res.status}): ${res.text.slice(0, 100)}` }
    }

    const json = JSON.parse(res.text)
    if (json.ok && json.url) {
      return { ok: true, url: json.url }
    }
    return { ok: false, error: json.error || '服务器未返回图片地址' }
  } catch (err: any) {
    return { ok: false, error: err?.message || '图片上传网络异常' }
  }
}

// ================= 3. Cloudflare 操作层 (Worker & KV) =================
export async function testCloudflareConnection(config: CloudflareSyncConfig): Promise<{
  ok: boolean
  message: string
}> {
  try {
    if (config.mode === 'worker') {
      const serverUrl = (config.workerUrl || DEFAULT_SERVER_URL).trim()
      if (!serverUrl) {
        return { ok: false, message: '请填写云端同步服务完整地址' }
      }
      const token = (config.workerToken || '').trim()
      if (token && token.length < 8) {
        return { ok: false, message: '同步凭据 (Token) 长度需至少 8 位' }
      }

      const { healthUrl } = resolveSyncEndpoints(serverUrl, APP_SYNC_ID)
      const res = await executeRequest(healthUrl, {
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
              'X-App-Id': APP_SYNC_ID,
              'x-sync-token': token,
            }
          : { 'X-App-Id': APP_SYNC_ID },
      })

      if (res.ok) {
        return { ok: true, message: '连接成功：统一云端同步平台在线，devNotes 专属空间就绪 (HTTP 200)' }
      }
      return {
        ok: false,
        message: `服务响应异常 (HTTP ${res.status}): ${res.text.slice(0, 120)}`,
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
    return { ok: false, message: `网络连接错误: ${err?.message || '无法连接到云端同步服务器'}` }
  }
}

/**
 * 生成要上传的状态：**回收站里的文档只留墓碑，不留内容**。
 *
 * 回收站按「本机保留即可」处理 —— 它的内容没必要占用云端空间、也没必要
 * 跟着同步到别的设备。但**不能整条剔除**：别的设备若还持有这篇活着的老副本，
 * 剔除掉就等于本地没有「它已被删」的记忆，下次同步它会从对面复活。
 * 所以留下 id + deletedAt 的骨架，正文与标题一并清空。
 */
function toSyncPayload(state: NotesState): NotesState {
  return {
    ...state,
    notes: state.notes.map((note) => {
      if (!note.deletedAt) return note
      // 只留传「这篇已删」所需的最小字段，正文与标题一律不带出去
      const skeleton: NoteItem = {
        id: note.id,
        title: '',
        content: '',
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        deletedAt: note.deletedAt,
      }
      return skeleton
    }),
  }
}

// 推送备份到云端
export async function pushToCloudflare(
  state: NotesState,
  config: CloudflareSyncConfig
): Promise<SyncResult> {
  try {
    const syncState = toSyncPayload(state)
    const isEncrypted = Boolean(config.enableE2EE && config.encryptionPassword)

    // 收集本地设置并转换为分类结构
    const rawSettings = await collectSettings()

    /*
     * API 密钥（AI 渠道 / 翻译服务）默认不出本机。用户显式开启同步密钥时
     * 必须已有端到端加密密码 —— 密钥单独加密后才注入快照，即使整体 payload
     * 走明文通道，密钥也始终是密文。
     */
    if (config.syncApiKeys) {
      if (!config.encryptionPassword) {
        throw new Error('已开启「同步 API 密钥」，请先设置端到端加密密码，否则密钥无法加密上云')
      }
      const secretSettings = await collectSecretSettings()
      await encryptSecretSettings(secretSettings, config.encryptionPassword)
      Object.assign(rawSettings, secretSettings)
    }

    const structuredSettings = packStructuredSettings(rawSettings)

    // 统计摘要（方便在管理端一眼看清快照概况）
    const aliveNotes = syncState.notes.filter((note) => !note.deletedAt)
    const summary: SyncPayloadSummary = {
      noteCount: aliveNotes.length,
      folderCount: syncState.folders?.length || 0,
      trashedCount: syncState.notes.length - aliveNotes.length,
    }

    // 仅在开启端到端加密时进行 AES 密文加密（密文为字符串）；
    // 未加密时直接保持原生结构化对象，彻底杜绝反人类的字符串双重序列化
    let payloadData: NotesState | string
    let payloadSettings: StructuredSettings | string

    if (isEncrypted) {
      const rawJson = JSON.stringify(syncState)
      const settingsJson = JSON.stringify(structuredSettings)
      payloadData = await encryptData(rawJson, config.encryptionPassword)
      payloadSettings = await encryptData(settingsJson, config.encryptionPassword)
    } else {
      payloadData = syncState
      payloadSettings = structuredSettings
    }

    const payload: SyncPayload = {
      app: APP_SYNC_ID,
      version: 2,
      updatedAt: Date.now(),
      updatedAtIso: new Date().toISOString(),
      deviceInfo: 'devNotes Desktop',
      encrypted: isEncrypted,
      summary,
      data: payloadData,
      settings: payloadSettings,
    }

    const payloadStr = JSON.stringify(payload)

    if (config.mode === 'worker') {
      const serverUrl = (config.workerUrl || DEFAULT_SERVER_URL).trim()
      const token = (config.workerToken || '').trim()
      if (!token || token.length < 8) {
        throw new Error('同步凭据 (Token) 未设置或长度少于 8 位，请在「接入设置」中配置')
      }
      const { syncUrl } = resolveSyncEndpoints(serverUrl, APP_SYNC_ID)
      // 自有多租户云服务使用 PUT /notes/sync
      const res = await executeRequest(syncUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-App-Id': APP_SYNC_ID,
          'x-sync-token': token,
        },
        body: payloadStr,
      })

      if (!res.ok) {
        throw new Error(`云端上传失败 (HTTP ${res.status}): ${res.text.slice(0, 120)}`)
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
      message: err?.message || '备份至云端失败',
    }
  }
}

// 从云端拉取备份数据
export async function pullFromCloudflare(config: CloudflareSyncConfig): Promise<{
  success: boolean
  message: string
  remoteState?: NotesState
  /** 云端保存的设置快照。旧版本备份没有这一项 */
  remoteSettings?: SettingsSnapshot
  remoteTime?: number
}> {
  try {
    let rawPayloadText = ''

    if (config.mode === 'worker') {
      const serverUrl = (config.workerUrl || DEFAULT_SERVER_URL).trim()
      const token = (config.workerToken || '').trim()
      if (!token || token.length < 8) {
        throw new Error('同步凭据 (Token) 未设置或长度少于 8 位，请在「接入设置」中配置')
      }
      const { syncUrl } = resolveSyncEndpoints(serverUrl, APP_SYNC_ID)
      const res = await executeRequest(syncUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-App-Id': APP_SYNC_ID,
          'x-sync-token': token,
        },
      })

      if (res.status === 404 || !res.text || res.text === '{}') {
        return { success: false, message: '云端暂无备份数据，请先执行一次备份' }
      }
      if (!res.ok) {
        throw new Error(`云端拉取失败 (HTTP ${res.status}): ${res.text.slice(0, 120)}`)
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

    const parsedJson = JSON.parse(rawPayloadText)
    // 兼容自有服务器包裹结构: { data: <SyncPayload>, updatedAt: ... }
    let payload: SyncPayload
    if (parsedJson && typeof parsedJson === 'object') {
      if (parsedJson.data === null && parsedJson.updatedAt === null) {
        return { success: false, message: '云端暂无备份数据，请先在当前设备执行一次备份' }
      }
      if (
        parsedJson.data &&
        typeof parsedJson.data === 'object' &&
        ('version' in parsedJson.data || 'data' in parsedJson.data)
      ) {
        payload = parsedJson.data as SyncPayload
      } else {
        payload = parsedJson as SyncPayload
      }
    } else {
      throw new Error('云端返回的数据格式无法解析')
    }

    // 1. 解析笔记数据：全面兼容结构化对象、旧版未加密字符串、加密密文字符串
    let remoteNotesState: NotesState
    if (payload.encrypted) {
      if (!config.encryptionPassword) {
        throw new Error('该备份已被端到端加密，请在设置中输入密码后重试解密拉取')
      }
      const decrypted = await decryptData(payload.data as string, config.encryptionPassword)
      remoteNotesState = JSON.parse(decrypted)
    } else if (typeof payload.data === 'string') {
      remoteNotesState = JSON.parse(payload.data)
    } else if (payload.data && typeof payload.data === 'object') {
      remoteNotesState = payload.data as NotesState
    } else {
      throw new Error('备份文档数据为空或格式不正确')
    }

    // 远端可能是老版本客户端推的（没有 folders / deletedAt 这些字段），
    // 统一过一遍归一化再交给上层，否则缺字段会在侧栏渲染时炸掉
    const remoteState = normalizeState(remoteNotesState)

    // 2. 解析设置数据：全面兼容结构化对象、旧版平铺对象、字符串密文/JSON
    let remoteSettings: SettingsSnapshot | undefined
    if (payload.settings) {
      try {
        let rawSettingsObj: any
        if (payload.encrypted) {
          const decrypted = await decryptData(payload.settings as string, config.encryptionPassword)
          rawSettingsObj = JSON.parse(decrypted)
        } else if (typeof payload.settings === 'string') {
          rawSettingsObj = JSON.parse(payload.settings)
        } else {
          rawSettingsObj = payload.settings
        }
        remoteSettings = unpackStructuredSettings(rawSettingsObj)
        // 敏感键可能是密文（e2ee:: 前缀），按需解密；解不开的键会被剔除
        await decryptSecretSettings(remoteSettings, config.encryptionPassword)
      } catch {
        // 设置解不开不该让整次拉取失败 —— 笔记才是主体，设置是附带的
      }
    }

    return {
      success: true,
      message: '拉取成功',
      remoteState,
      remoteSettings,
      remoteTime: payload.updatedAt,
    }
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || '从云端拉取失败',
    }
  }
}

/**
 * 文件夹合并：**以 id 对齐**，同名不算同一个。
 *
 * 两机各自建的「工作」是两个不同 id 的文件夹，合并后都保留（可能出现同名并列）。
 * 这是刻意的 —— 按名字合并会把两边同名文件夹里的文档混在一起，而文件夹重名
 * 恰恰是「两件不同的事恰好取了同一个名字」，混起来比并列更难收拾。
 *
 * 删除靠墓碑（deletedAt）传播：删文件夹不是抹掉条目，而是打标记留在数组里。
 * 只有墓碑比对面「活着」的版本更新时才认定删除成立，否则对面后建的会赢。
 */
/**
 * 合并两端的阅读书签。
 *
 * 与文件夹的墓碑机制不同，书签没有「删除也需要传播」的问题 ——
 * 删掉一条就少一条，下一次合并时对面那份若还在，会被当成「对面新加的书签」又回来。
 *
 * 这是刻意的取舍：给书签再加墓碑的话，每条都要常驻一个 deletedAt，
 * 而书签本来就是「随手记的临时位置」，为了跨设备删除而永久保留墓碑得不偿失。
 * 本机删掉后若又被别的设备带回来，再删一次即可 —— 代价远小于墓碑的复杂度。
 * （跨设备同步的正常路径是「在这台记、在那台用」，删除极少跨设备发生。）
 *
 * 同 id 的两条按 at 取新，这样「在 A 机改了备注、在 B 机没动」能正确合并。
 */
function mergeReadingBookmarks(
  localBookmarks: ReadingBookmark[] | undefined,
  remoteBookmarks: ReadingBookmark[] | undefined
): ReadingBookmark[] {
  const result = new Map<string, ReadingBookmark>()
  localBookmarks?.forEach((bookmark) => result.set(bookmark.id, bookmark))

  remoteBookmarks?.forEach((remoteBookmark) => {
    const localBookmark = result.get(remoteBookmark.id)
    if (!localBookmark || remoteBookmark.at > localBookmark.at) {
      result.set(remoteBookmark.id, remoteBookmark)
    }
  })

  // 按创建时刻排，最近记的在前 —— 与「书签列表」在 UI 上的顺序一致
  return Array.from(result.values()).sort((a, b) => b.at - a.at)
}

function mergeFolders(
  localFolders: FolderItem[],
  remoteFolders: FolderItem[]
): { folders: FolderItem[]; addedFromRemote: number; removedByRemote: number } {
  const result = new Map<string, FolderItem>()
  localFolders.forEach((folder) => result.set(folder.id, folder))

  let addedFromRemote = 0
  let removedByRemote = 0

  const stampOf = (folder: FolderItem) => folder.updatedAt ?? folder.createdAt ?? 0

  remoteFolders.forEach((remoteFolder) => {
    const localFolder = result.get(remoteFolder.id)
    if (!localFolder) {
      // 本地没见过这个 id：墓碑也是有效信息（对端删过、本机从没见过它）
      result.set(remoteFolder.id, remoteFolder)
      if (!remoteFolder.deletedAt) addedFromRemote++
      return
    }

    /*
     * 墓碑优先于存活版本，**不看时间戳**。
     *
     * 删除是终态：另一台设备在不知情的情况下重命名了它（updatedAt 反而更新），
     * 若按时间戳让存活版赢，A 机上刚被清空的归属要跟着一起被搅乱 ——
     * 「删了又被别人的改名复活」比「改名在删除面前失效」难解释得多。
     *
     * 两端都是墓碑时按时间戳取新的（保留最近一次删除的时间，够用即可）。
     */
    const localDead = Boolean(localFolder.deletedAt)
    const remoteDead = Boolean(remoteFolder.deletedAt)

    if (localDead && !remoteDead) return // 本地墓碑胜出，忽略对方的改名
    if (remoteDead && !localDead) {
      removedByRemote++
      result.set(remoteFolder.id, remoteFolder)
      return
    }
    // 都是墓碑 或 都活着：谁的时间戳新听谁的
    if (stampOf(remoteFolder) > stampOf(localFolder)) {
      result.set(remoteFolder.id, remoteFolder)
    }
  })

  /*
   * 墓碑**永不丢弃**。曾试过给个 30 天 TTL 清理，但那是错的：
   * 丢掉之后本地就没有「这个 id 已删」的记忆了，任何一台离线超过 TTL 的设备
   * 一旦上线，它那份还活着的旧数据会在 !localFolder 分支被当成新文件夹收回来 ——
   * 删除等于没做。单条墓碑只有几十字节，留着比复活便宜得多。
   */
  const folders = Array.from(result.values())

  return { folders, addedFromRemote, removedByRemote }
}

// ================= 4. 智能文档合并算法 (Smart Merge) =================
export function smartMergeNotes(local: NotesState, remote: NotesState): {
  mergedState: NotesState
  addedFromRemote: number
  updatedFromRemote: number
  /** 因对端删除而消失的文件夹数，用于在同步结果里提示用户 */
  removedFolders: number
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
    } else if (localNote.deletedAt) {
      /*
       * 本地这篇在回收站里：一律以本地为准，整条保留。
       *
       * 云端的回收站条目是剥掉正文的骨架（见 toSyncPayload），
       * 若按 updatedAt 让远端赢，本机回收站的正文就被清空了 ——
       * 回收站内容按定位只存本机，没有「从云端取回」这回事。
       */
    } else if (remoteNote.deletedAt) {
      /*
       * 对端把它删了、本地还活着：采用墓碑（删除优先于内容更新）。
       * 同样保留本地的正文 —— 本机并没有删它，只是要跟上「它已经不在活跃列表」。
       * 内容留着，万一之后又从回收站还原，正文还在。
       */
      resultMap.set(localNote.id, { ...localNote, deletedAt: remoteNote.deletedAt })
    } else {
      /*
       * 双方都活着，逐字段各取其新：
       *   正文/标题等按 updatedAt 整体取最新的一份；
       *   归类按 folderMovedAt 单独比 —— 归类不动 updatedAt，
       *   没有这个字段就只能盲选，远端「拖进新文件夹」的动作会整个丢掉。
       * 老数据没有 folderMovedAt，兜成 0，于是一律以本地归类为准（旧行为）。
       */
      const contentWinner = remoteNote.updatedAt > localNote.updatedAt ? remoteNote : localNote
      const localMoved = localNote.folderMovedAt ?? 0
      const remoteMoved = remoteNote.folderMovedAt ?? 0
      const folderWinner = remoteMoved > localMoved ? remoteNote : localNote

      // 阅读书签同理，按各自的 at 逐条比，理由见 ReadingBookmark.at 的注释
      const bookmarks = mergeReadingBookmarks(
        localNote.readingBookmarks,
        remoteNote.readingBookmarks
      )

      if (contentWinner === remoteNote) updatedFromRemote++
      resultMap.set(contentWinner.id, {
        ...contentWinner,
        folderId: folderWinner.folderId,
        ...(folderWinner.folderMovedAt !== undefined
          ? { folderMovedAt: folderWinner.folderMovedAt }
          : {}),
        ...(bookmarks.length ? { readingBookmarks: bookmarks } : {}),
      })
    }
  })

  const mergedNotes = Array.from(resultMap.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  )

  // 书签组优先 + 更新时间倒序，与侧栏列表同一口径；回收站文档不能被选为活动文档
  const alive = sortNotes(visibleNotes(mergedNotes))
  const activeId =
    (local.activeId && alive.some((n) => n.id === local.activeId)
      ? local.activeId
      : alive[0]?.id) || null

  const { folders, removedByRemote } = mergeFolders(
    local.folders || [],
    remote.folders || []
  )

  /* 归属校验必须对着**未删除**的文件夹做：远端可能把某文件夹删了（墓碑还在），
     那些文档就得落回未分类，否则侧栏会出现一个点不到的归属 */
  const folderIds = new Set(visibleFolders(folders).map((folder) => folder.id))
  const mergedNotesWithFolder = mergedNotes.map((note) =>
    note.folderId && !folderIds.has(note.folderId) ? { ...note, folderId: null } : note
  )

  return {
    mergedState: { notes: mergedNotesWithFolder, folders, activeId },
    addedFromRemote,
    updatedFromRemote,
    removedFolders: removedByRemote,
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
    if (!cfg) return DEFAULT_CF_CONFIG

    /*
     * 老版本迁移：workerUrl 为空的配置补上默认服务地址。
     *
     * （旧版还会识别「内置示例 Worker 端点」并重置 —— 那是开发者的个人
     * Worker 地址，推广版已将其从产物中移除，不再对任何用户暴露。）
     */
    if (cfg.mode === 'worker' && !cfg.workerUrl) {
      cfg.workerUrl = DEFAULT_SERVER_URL
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
  // 计数与标题都只看未删除文档 —— 回收站里的不该出现在「N 篇」和快照摘要里
  const alive = state.notes.filter((note) => !note.deletedAt)
  return {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    trigger,
    docCount: alive.length,
    sizeBytes: new Blob([jsonStr]).size,
    noteTitles: alive.map((n) => n.title || '未命名笔记').slice(0, 5),
    state: JSON.parse(jsonStr),
  }
}

// ================= 6. 1分钟部署 Cloudflare Worker 代码模板 =================
export const CLOUDFLARE_WORKER_SCRIPT = `/**
 * devNotes Cloudflare Worker 同步网关
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
      return new Response(JSON.stringify({ status: 'ok', service: 'devNotes CF Sync' }), {
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

    return new Response('devNotes Cloudflare Sync Worker is running', { headers: corsHeaders });
  },
};
`
