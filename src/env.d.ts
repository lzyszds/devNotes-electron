// Vite 会把图片资源解析成 URL 字符串,这里补上模块声明供 TS 识别
declare module '*.png' {
  const src: string
  export default src
}

// Vite 注入的环境变量。只声明本项目用得到的字段:
// dev 下 BASE_URL 是 "/",生产构建是 "./"(项目用相对 base,便于 file:// 加载)
interface ImportMetaEnv {
  readonly BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** 一条端口占用记录 */
interface PortListenerInfo {
  pid: number
  processName: string
  command: string
  port: number
  address: string
  protocol: 'TCP'
  /** 是 devNotes 自己占用时为 true，界面上禁止强杀 */
  self: boolean
}

/** 单个端口的排查结果 */
interface PortInspectResult {
  port: number
  listeners: PortListenerInfo[]
  /** 查询本身失败（如系统缺 lsof）时的原因 */
  error?: string
}

interface Window {
  electronAPI?: {
    minimizeWindow: () => Promise<void>
    maximizeWindow: () => Promise<void>
    closeWindow: () => Promise<void>
    openTool: (toolName: string) => Promise<void>
    showNotification: (
      title: string,
      body: string,
      options?: { focusMainWindow?: boolean }
    ) => Promise<void>
    getAppVersion: () => Promise<string>
    /** 自动更新(可选,浏览器环境下不存在) */
    checkForUpdates?: () => Promise<unknown>
    installUpdate?: () => Promise<void>
    getUpdateStatus?: () => Promise<{
      state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev-mode'
      version?: string
      percent?: number
      bytesPerSecond?: number
      transferred?: number
      total?: number
      message?: string
      /** 最近一次检查完成时刻（ms），用于判断缓存结论是否过期 */
      checkedAt?: number
    } | null>
    onUpdateStatus?: (
      callback: (
        status:
          | { state: 'checking' }
          | { state: 'available'; version: string; checkedAt: number }
          | { state: 'not-available'; checkedAt: number }
          | {
              state: 'downloading'
              percent: number
              bytesPerSecond?: number
              transferred?: number
              total?: number
            }
          | { state: 'downloaded'; version: string; checkedAt: number }
          | { state: 'error'; message: string; checkedAt: number }
          | { state: 'dev-mode'; message: string }
      ) => void
    ) => () => void
    storeGet: (key: string) => Promise<any>
    storeSet: (key: string, value: any) => Promise<void>
    storeDelete: (key: string) => Promise<void>
    /** 主进程剪贴板读写(可选,浏览器环境下不存在) */
    clipboardRead?: () => Promise<string>
    clipboardWrite?: (text: string) => Promise<void>
    translateFetch?: (options: {
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
      timeout?: number
    }) => Promise<{ ok: boolean; status: number; text: string; error?: string }>
    getProxyConfig?: () => Promise<{
      mode: 'system' | 'manual' | 'direct'
      url?: string
    }>
    setProxyConfig?: (config: {
      mode: 'system' | 'manual' | 'direct'
      url?: string
    }) => Promise<{ mode: 'system' | 'manual' | 'direct'; url?: string }>
    testProxy?: () => Promise<{
      ok: boolean
      proxy: string
      status: number
      error?: string
    }>
    notesOpenFile?: () => Promise<{
      path: string
      name: string
      content: string
      mtimeMs?: number
    } | null>
    notesSaveFile?: (options: {
      content: string
      defaultPath?: string
    }) => Promise<{
      path: string
      name: string
    } | null>
    openExternal?: (url: string) => Promise<void>
    onOpenFileRequest?: (
      callback: (payload: {
        path: string
        name: string
        content?: string
        mtimeMs?: number
        error?: string
      }) => void
    ) => () => void
    notifyRendererReady?: () => Promise<void>
    /** 主进程要求把未保存的笔记立刻落盘（退出前 / 窗口隐藏时） */
    onNotesFlushRequest?: (callback: () => void) => () => void

    /** 全局快捷键配置：读 / 写。写会立刻在主进程重注册，返回注册失败的 id */
    getShortcuts?: () => Promise<Record<string, string>>
    setShortcuts?: (map: Record<string, string>) => Promise<{ failed: string[] }>
    /** 录制期间暂停全局快捷键 */
    setShortcutRecording?: (recording: boolean) => Promise<void>

    /** 主进程要求切到某个工具页（全局快捷键唤起时） */
    onToolOpenRequest?: (callback: (toolId: string) => void) => () => void

    /* 截图框选 */
    startCapture?: () => Promise<void>
    finishCapture?: (dataUrl: string) => Promise<void>
    cancelCapture?: () => Promise<void>
    onCaptureReady?: (callback: (payload: unknown) => void) => () => void
    requestCaptureShot?: () => Promise<unknown>

    /* 流式翻译 */
    startTranslateStream?: (options: {
      requestId: string
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
      timeout?: number
    }) => Promise<void>
    abortTranslateStream?: (requestId: string) => Promise<void>
    onTranslateStreamChunk?: (
      callback: (payload: { requestId: string; chunk: string }) => void
    ) => () => void
    onTranslateStreamEnd?: (
      callback: (payload: { requestId: string; error?: string }) => void
    ) => () => void
    onCaptureOcrRequest?: (callback: (dataUrl: string) => void) => () => void

    /* 草稿纸置顶小窗 */
    scratchOpen?: () => Promise<void>
    scratchClose?: () => Promise<void>
    scratchPin?: (pinned: boolean) => Promise<void>

    /* 剪贴板历史面板 */
    clipboardOpen?: () => Promise<void>
    clipboardClose?: () => Promise<void>
    clipboardList?: () => Promise<ClipboardEntry[]>
    clipboardRemove?: (id: string) => Promise<ClipboardEntry[]>
    clipboardClear?: () => Promise<ClipboardEntry[]>
    clipboardRestore?: (text: string) => Promise<boolean>
    clipboardCopyImage?: (imageDataUrl: string) => Promise<boolean>
    onClipboardChanged?: (callback: (entries: ClipboardEntry[]) => void) => () => void

    /* 选中即粘贴到外部应用（需辅助功能授权） */
    clipboardPasteAvailable?: () => Promise<boolean>
    clipboardPastePermission?: () => Promise<boolean>
    clipboardRequestPermission?: () => Promise<boolean>
    clipboardOpenAccessibility?: () => Promise<void>
    clipboardPaste?: (
      payload: {
        type: 'text' | 'image' | 'file'
        text?: string
        imageDataUrl?: string
        filePath?: string
      }
    ) => Promise<{ ok: boolean; reason?: 'no-module' | 'no-permission' | 'failed' }>

    /* 文件局域网分享 */

    /* 文件哈希 */
    hashPick?: () => Promise<string[]>
    hashCompute?: (payload: { paths: string[]; algorithms: string[]; requestId: number }) => Promise<HashFileResult[]>
    onHashProgress?: (callback: (progress: HashFileProgress & { requestId: number }) => void) => () => void

    /* 网络探测 */
    netInfoInterfaces?: () => Promise<LocalInterface[]>
    netInfoPublicIp?: (mode: 'direct' | 'proxy') => Promise<PublicIpResult>
    netPingStart?: (options: { host: string; count: number; intervalSec: number; timeoutSec: number; size: number }) => Promise<{ id: number; host: string }>
    netPingStop?: (id: number) => Promise<void>
    netTcpProbe?: (options: { host: string; port: number; timeoutMs: number }) => Promise<NetTcpResult>
    netHttpProbe?: (options: { url: string; timeoutMs: number }) => Promise<NetHttpResult>
    onNetPingEvent?: (callback: (event: NetPingEvent) => void) => () => void

    /* 文件路径（拖拽的 File 换成本地路径） */
    filePathsFromFiles?: (files: File[]) => string[]

    /* 局域网中转台 */
    lanStart?: () => Promise<LanStatus>
    lanStop?: () => Promise<LanStatus>
    lanStatus?: () => Promise<LanStatus>
    lanInboxList?: () => Promise<LanInboxEntry[]>
    lanInboxThumb?: (id: string) => Promise<string | null>
    lanInboxCopy?: (id: string) => Promise<boolean>
    lanInboxReveal?: (id: string) => Promise<void>
    lanInboxDelete?: (id: string) => Promise<boolean>
    lanInboxClear?: () => Promise<void>
    lanOutboxList?: () => Promise<LanOutboxEntry[]>
    lanOutboxPick?: () => Promise<LanOutboxEntry[]>
    lanOutboxAddFiles?: (paths: string[]) => Promise<LanOutboxEntry[]>
    lanOutboxAddText?: (text: string) => Promise<LanOutboxEntry[]>
    lanOutboxRemove?: (id: string) => Promise<LanOutboxEntry[]>
    lanOutboxClear?: () => Promise<LanOutboxEntry[]>
    lanSetAutoCopy?: (on: boolean) => Promise<void>
    onLanInboxReceived?: (callback: (entry: LanInboxEntry) => void) => () => void

    /* 端口占用排查 */
    portsCommon?: () => Promise<number[]>
    portsInspect?: (ports: number[]) => Promise<PortInspectResult[]>
    portsKill?: (pid: number) => Promise<{ ok: boolean; pid: number; error?: string }>

    /* 电脑配置与内存检测 */
    systemInfo?: () => Promise<import('./types/system').SystemHardwareInfo>
    systemProcessList?: () => Promise<import('./types/system').AppProcessMemory[]>
    systemKillProcess?: (pid: number) => Promise<{ ok: boolean; pid: number; error?: string }>
  }
}

/** 文件哈希的单个文件结果 */
interface HashFileResult {
  path: string
  name: string
  size: number
  digests: Partial<Record<'md5' | 'sha1' | 'sha256' | 'sha512', string>>
  error?: string
}

interface HashFileProgress {
  path: string
  readBytes: number
  totalBytes: number
}

/** 本机 IPv4 网卡 */
interface LocalInterface {
  name: string
  kind: 'wifi' | 'ethernet' | 'virtual'
  address: string
  netmask: string
  cidr: string
  mac: string
}

/** 公网出口 IP 查询结果 */
interface PublicIpResult {
  ok: boolean
  ip: string | null
  via: string | null
  error?: string
}

/** 网络探测：ping 的单条事件 */
type NetPingEvent =
  | { id: number; kind: 'reply'; seq: number; ms: number; ttl: number | null }
  | { id: number; kind: 'timeout'; seq: number }
  | { id: number; kind: 'error'; message: string }
  | { id: number; kind: 'done'; code: number | null }

interface NetTcpResult {
  ok: boolean
  ms: number | null
  error?: string
}

interface NetHttpResult {
  ok: boolean
  status: number | null
  dnsMs: number | null
  ttfbMs: number | null
  server: string | null
  error?: string
}

/** 局域网中转台：服务状态 */
interface LanStatus {
  running: boolean
  /** 手机扫码打开的地址；没有可用局域网地址时为 null */
  url: string | null
}

/** 局域网中转台：手机发来的一条内容 */
type LanInboxEntry =
  | { kind: 'file'; id: string; name: string; size: number; mime: string; receivedAt: number }
  | { kind: 'text'; id: string; text: string; receivedAt: number }

/** 局域网中转台：电脑发给手机的一条内容 */
type LanOutboxEntry =
  | { kind: 'file'; id: string; name: string; size: number; path: string; addedAt: number }
  | { kind: 'text'; id: string; text: string; addedAt: number }

/** 一条剪贴板历史记录 */
interface ClipboardEntry {
  id: string
  /** 'text' 文本，'image' 图片，'file' 文件 */
  type: 'text' | 'image' | 'file'
  /** type='text' 时的正文 */
  text?: string
  /** type='image' 时的 PNG dataURL */
  imageDataUrl?: string
  /** type='file' 时的绝对路径 */
  filePath?: string
  /** 采集时刻（毫秒时间戳） */
  at: number
  /** 原文超长被截断 */
  truncated?: boolean
}
