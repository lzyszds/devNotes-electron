import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { InboxEntry, LanStatus, OutboxEntry } from './lanTransfer'
import type { HttpResult, PingEvent, TcpResult } from './netProbe'
import type { LocalInterface, PublicIpResult } from './netInfo'
import type { HashProgress, HashResult } from './hashFile'
import type { UpdateStatus } from './updater'
import type { SystemHardwareInfo, AppProcessMemory } from './systemInfo'

// Expose API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  
  // Tool operations
  openTool: (toolName: string) => ipcRenderer.invoke('open-tool', toolName),

  /* 草稿纸置顶小窗 */
  scratchOpen: () => ipcRenderer.invoke('scratch-open'),
  scratchClose: () => ipcRenderer.invoke('scratch-close'),
  scratchPin: (pinned: boolean) => ipcRenderer.invoke('scratch-pin', pinned),

  /* 剪贴板历史面板 */
  clipboardOpen: () => ipcRenderer.invoke('clipboard-open'),
  clipboardClose: () => ipcRenderer.invoke('clipboard-close'),
  /*
   * 列表是「轻条目」：图片条目只有 imageId 指针（原图与缩略图分别落盘，
   * 缩略图走 dnclip://thumb/<id> 协议直读），绝无 base64 大字符串。
   */
  clipboardList: (): Promise<
    {
      id: string
      type: 'text' | 'image' | 'file'
      text: string
      at: number
      truncated?: boolean
      imageId?: string
      imageBytes?: number
    }[]
  > => ipcRenderer.invoke('clipboard-list'),
  clipboardRemove: (id: string) => ipcRenderer.invoke('clipboard-remove', id),
  clipboardClear: () => ipcRenderer.invoke('clipboard-clear'),
  clipboardCopyImage: (imageDataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard-copy-image', imageDataUrl),
  /** 按条目 id 复制图片。原图在磁盘上，由主进程按需读并写回系统剪贴板 */
  clipboardCopyImageById: (entryId: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard-copy-image-by-id', entryId),
  /**
   * 上云用的剪贴板投影（图片一律脱敏成【图片】）。
   * 主进程侧直接生成，省掉「整份历史过 IPC 再在渲染层 map」的开销。
   */
  clipboardProjectForSync: (): Promise<
    { id: string; type: 'text'; text: string; at: number }[]
  > => ipcRenderer.invoke('clipboard-project-for-sync'),

  /* 选中即粘贴到当前聚焦的外部应用（需要辅助功能授权） */
  clipboardOpenAccessibility: (): Promise<void> =>
    ipcRenderer.invoke('clipboard-open-accessibility'),
  clipboardPaste: (
    payload: {
      type: 'text' | 'image' | 'file'
      text?: string
      imageDataUrl?: string
      filePath?: string
    }
  ): Promise<{ ok: boolean; reason?: 'no-module' | 'no-permission' | 'failed' }> =>
    ipcRenderer.invoke('clipboard-paste', payload),
  /** 按条目 id 粘贴图片：主进程读原图文件 → base64 → 写剪贴板 → 模拟 ⌘V */
  clipboardPasteImage: (
    entryId: string
  ): Promise<{ ok: boolean; reason?: 'no-module' | 'no-permission' | 'failed' }> =>
    ipcRenderer.invoke('clipboard-paste-image', entryId),

  /** 采集到新内容时推送，面板不用轮询 */
  onClipboardChanged: (
    callback: (entries: { id: string; text: string; at: number; truncated?: boolean }[]) => void
  ) => {
    const listener = (_: unknown, entries: Parameters<typeof callback>[0]) => callback(entries)
    ipcRenderer.on('clipboard:changed', listener)
    return () => {
      ipcRenderer.removeListener('clipboard:changed', listener)
    }
  },

  /* 端口占用排查 */
  portsCommon: (): Promise<number[]> => ipcRenderer.invoke('ports-common'),
  portsInspect: (ports: number[]) => ipcRenderer.invoke('ports-inspect', ports),
  portsKill: (pid: number) => ipcRenderer.invoke('ports-kill', pid),

  /* 电脑硬件配置与实时进程内存检测 */
  systemInfo: (): Promise<SystemHardwareInfo> => ipcRenderer.invoke('system-info'),
  systemProcessList: (): Promise<AppProcessMemory[]> => ipcRenderer.invoke('system-process-list'),
  systemKillProcess: (pid: number): Promise<{ ok: boolean; pid: number; error?: string }> =>
    ipcRenderer.invoke('system-kill-process', pid),
  
  // Notifications
  showNotification: (title: string, body: string, options?: { focusMainWindow?: boolean }) =>
    ipcRenderer.invoke('show-notification', title, body, options),
  
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // 自动更新：手动检查、立即重启安装，获取当前状态及订阅状态推送
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  getUpdateStatus: () => ipcRenderer.invoke('update-get-status'),
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const listener = (_: unknown, status: UpdateStatus) => callback(status)
    ipcRenderer.on('update:status', listener)
    return () => {
      ipcRenderer.removeListener('update:status', listener)
    }
  },

  // Store operations
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key: string) => ipcRenderer.invoke('store-delete', key),

  // 剪贴板读写(右键菜单的复制/粘贴使用)
  clipboardRead: () => ipcRenderer.invoke('clipboard-read'),
  clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard-write', text),

  // 翻译 API 代理（绕过 CORS，走系统/手动代理）
  translateFetch: (options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    timeout?: number
  }) => ipcRenderer.invoke('translate-fetch', options),

  getProxyConfig: () => ipcRenderer.invoke('get-proxy-config'),
  setProxyConfig: (config: {
    mode: 'system' | 'manual' | 'direct'
    url?: string
  }) => ipcRenderer.invoke('set-proxy-config', config),
  testProxy: () => ipcRenderer.invoke('test-proxy'),

  // Markdown notes file IO
  notesOpenFile: () => ipcRenderer.invoke('notes-open-file'),
  notesSaveFile: (options: { content: string; defaultPath?: string }) =>
    ipcRenderer.invoke('notes-save-file', options),

  // 在系统默认浏览器中安全打开外部链接
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  /* 文件路径：拖拽进来的 File 对象需要用 webUtils 换成本地真实路径 */
  filePathsFromFiles: (files: File[]): string[] =>
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),

  /* 网络探测 */
  netPingStart: (options: { host: string; count: number; intervalSec: number; timeoutSec: number; size: number }): Promise<{ id: number; host: string }> =>
    ipcRenderer.invoke('net-ping-start', options),
  netPingStop: (id: number): Promise<void> => ipcRenderer.invoke('net-ping-stop', id),
  netInfoInterfaces: (): Promise<LocalInterface[]> => ipcRenderer.invoke('netinfo-interfaces'),

  /* 文件哈希 */
  hashPick: (): Promise<string[]> => ipcRenderer.invoke('hash-pick'),
  hashCompute: (payload: { paths: string[]; algorithms: string[]; requestId: number }): Promise<HashResult[]> =>
    ipcRenderer.invoke('hash-compute', payload),
  onHashProgress: (callback: (progress: HashProgress & { requestId: number }) => void) => {
    const listener = (_: unknown, progress: HashProgress & { requestId: number }) => callback(progress)
    ipcRenderer.on('hash:progress', listener)
    return () => {
      ipcRenderer.removeListener('hash:progress', listener)
    }
  },
  netInfoPublicIp: (mode: 'direct' | 'proxy'): Promise<PublicIpResult> =>
    ipcRenderer.invoke('netinfo-public-ip', mode),
  netTcpProbe: (options: { host: string; port: number; timeoutMs: number }): Promise<TcpResult> =>
    ipcRenderer.invoke('net-tcp-probe', options),
  netHttpProbe: (options: { url: string; timeoutMs: number }): Promise<HttpResult> =>
    ipcRenderer.invoke('net-http-probe', options),
  onNetPingEvent: (callback: (event: PingEvent & { id: number }) => void) => {
    const listener = (_: unknown, event: PingEvent & { id: number }) => callback(event)
    ipcRenderer.on('net-ping:event', listener)
    return () => {
      ipcRenderer.removeListener('net-ping:event', listener)
    }
  },

  /* 局域网中转台 */
  lanStart: (): Promise<LanStatus> => ipcRenderer.invoke('lan-start'),
  lanStop: (): Promise<LanStatus> => ipcRenderer.invoke('lan-stop'),
  lanStatus: (): Promise<LanStatus> => ipcRenderer.invoke('lan-status'),
  lanInboxList: (): Promise<InboxEntry[]> => ipcRenderer.invoke('lan-inbox-list'),
  lanInboxThumb: (id: string): Promise<string | null> => ipcRenderer.invoke('lan-inbox-thumb', id),
  lanInboxCopy: (id: string): Promise<boolean> => ipcRenderer.invoke('lan-inbox-copy', id),
  lanInboxReveal: (id: string): Promise<void> => ipcRenderer.invoke('lan-inbox-reveal', id),
  lanInboxDelete: (id: string): Promise<boolean> => ipcRenderer.invoke('lan-inbox-delete', id),
  lanInboxClear: (): Promise<void> => ipcRenderer.invoke('lan-inbox-clear'),
  lanOutboxList: (): Promise<OutboxEntry[]> => ipcRenderer.invoke('lan-outbox-list'),
  lanOutboxPick: (): Promise<OutboxEntry[]> => ipcRenderer.invoke('lan-outbox-pick'),
  lanOutboxAddFiles: (paths: string[]): Promise<OutboxEntry[]> => ipcRenderer.invoke('lan-outbox-add-files', paths),
  lanOutboxAddText: (text: string): Promise<OutboxEntry[]> => ipcRenderer.invoke('lan-outbox-add-text', text),
  lanOutboxRemove: (id: string): Promise<OutboxEntry[]> => ipcRenderer.invoke('lan-outbox-remove', id),
  lanOutboxClear: (): Promise<OutboxEntry[]> => ipcRenderer.invoke('lan-outbox-clear'),
  lanSetAutoCopy: (on: boolean): Promise<void> => ipcRenderer.invoke('lan-set-auto-copy', on),
  onLanInboxReceived: (callback: (entry: InboxEntry) => void) => {
    const listener = (_: unknown, entry: InboxEntry) => callback(entry)
    ipcRenderer.on('lan:inbox-received', listener)
    return () => {
      ipcRenderer.removeListener('lan:inbox-received', listener)
    }
  },

  // Markdown 文件关联:外部打开文件请求(双击 .md 文件)
  onOpenFileRequest: (callback: (payload: OpenFilePayload) => void) => {
    const listener = (_: unknown, payload: OpenFilePayload) => callback(payload)
    ipcRenderer.on('notes:open-file-request', listener)
    return () => {
      ipcRenderer.removeListener('notes:open-file-request', listener)
    }
  },
  notifyRendererReady: () => ipcRenderer.invoke('notes-renderer-ready'),

  /**
   * 主进程要求把未保存的笔记立刻落盘（退出前 / 窗口隐藏时）。
   * 返回取消订阅函数，与其它 on* 一致。
   */
  onNotesFlushRequest: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('notes:flush-request', listener)
    return () => {
      ipcRenderer.removeListener('notes:flush-request', listener)
    }
  },

  // 全局快捷键：读配置、存配置（存完主进程会立刻重注册，返回注册失败的 id）
  getShortcuts: (): Promise<Record<string, string>> => ipcRenderer.invoke('get-shortcuts'),
  setShortcuts: (map: Record<string, string>): Promise<{ failed: string[] }> =>
    ipcRenderer.invoke('set-shortcuts', map),
  /** 录制期间暂停全局快捷键，免得按下的组合真的把窗口唤起 */
  setShortcutRecording: (recording: boolean): Promise<void> =>
    ipcRenderer.invoke('set-shortcut-recording', recording),

  /**
   * 主进程要求切到某个工具页（全局快捷键唤起窗口时用）。
   * 跟 onOpenFileRequest 一样返回取消订阅函数。
   */
  onToolOpenRequest: (callback: (toolId: string) => void) => {
    const listener = (_: unknown, toolId: string) => callback(toolId)
    ipcRenderer.on('tool:open-request', listener)
    return () => {
      ipcRenderer.removeListener('tool:open-request', listener)
    }
  },

  // 截图框选：遮罩窗口侧的接口
  startCapture: () => ipcRenderer.invoke('start-capture'),
  finishCapture: (dataUrl: string) => ipcRenderer.invoke('finish-capture', dataUrl),
  cancelCapture: () => ipcRenderer.invoke('cancel-capture'),
  /** 主进程推来待框选的全屏图 */
  onCaptureReady: (callback: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on('capture:ready', listener)
    return () => {
      ipcRenderer.removeListener('capture:ready', listener)
    }
  },
  /** 渲染层就绪后主动拉一次截图（防止推的消息早于监听挂上而丢失） */
  requestCaptureShot: () => ipcRenderer.invoke('request-capture-shot'),
  /** 自定义选区的底图已解码并经过绘制帧，主进程校验发送窗口后再显示 */
  notifyCaptureShown: () => ipcRenderer.send('capture:shown'),

  /* 流式翻译：发起 + 中断 + 订阅分块推送 */
  startTranslateStream: (options: {
    requestId: string
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    timeout?: number
  }): Promise<void> => ipcRenderer.invoke('translate-stream-start', options),
  abortTranslateStream: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('translate-stream-abort', requestId),
  onTranslateStreamChunk: (
    callback: (payload: { requestId: string; chunk: string }) => void
  ) => {
    const listener = (_: unknown, payload: { requestId: string; chunk: string }) =>
      callback(payload)
    ipcRenderer.on('translate-stream-chunk', listener)
    return () => {
      ipcRenderer.removeListener('translate-stream-chunk', listener)
    }
  },
  onTranslateStreamEnd: (
    callback: (payload: { requestId: string; error?: string }) => void
  ) => {
    const listener = (_: unknown, payload: { requestId: string; error?: string }) =>
      callback(payload)
    ipcRenderer.on('translate-stream-end', listener)
    return () => {
      ipcRenderer.removeListener('translate-stream-end', listener)
    }
  },
  /** 主窗口侧：收到框选好的图，该去做 OCR 了 */
  onCaptureOcrRequest: (callback: (dataUrl: string) => void) => {
    const listener = (_: unknown, dataUrl: string) => callback(dataUrl)
    ipcRenderer.on('capture:ocr-request', listener)
    return () => {
      ipcRenderer.removeListener('capture:ocr-request', listener)
    }
  },
  /** light-ocr（PP-OCRv6 子进程）识别一张图；依赖缺失时返回 unsupported */
  lightOcr: (
    dataUrl: string
  ): Promise<{ status: 'ok'; text: string } | { status: 'unsupported' } | { status: 'failed'; reason: string }> =>
    ipcRenderer.invoke('ocr-light-recognize', dataUrl),
})

// 外部打开文件的消息负载
export interface OpenFilePayload {
  path: string
  name: string
  content?: string
  mtimeMs?: number
  error?: string
}

/** 一条端口占用记录（与 electron/ports.ts 的 PortListener 对应） */
export interface PortListenerInfo {
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
export interface PortInspectResult {
  port: number
  listeners: PortListenerInfo[]
  /** 查询本身失败（如系统缺 lsof）时的原因 */
  error?: string
}

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
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
      checkForUpdates: () => Promise<unknown>
      installUpdate: () => Promise<void>
      getUpdateStatus: () => Promise<UpdateStatus | null>
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
      storeGet: (key: string) => Promise<any>
      storeSet: (key: string, value: any) => Promise<void>
      storeDelete: (key: string) => Promise<void>
      clipboardRead: () => Promise<string>
      clipboardWrite: (text: string) => Promise<void>
      translateFetch: (options: {
        url: string
        method?: string
        headers?: Record<string, string>
        body?: string
        timeout?: number
      }) => Promise<{ ok: boolean; status: number; text: string; error?: string }>
      getProxyConfig: () => Promise<{
        mode: 'system' | 'manual' | 'direct'
        url?: string
      }>
      setProxyConfig: (config: {
        mode: 'system' | 'manual' | 'direct'
        url?: string
      }) => Promise<{ mode: 'system' | 'manual' | 'direct'; url?: string }>
      testProxy: () => Promise<{
        ok: boolean
        proxy: string
        status: number
        error?: string
      }>
      notesOpenFile: () => Promise<{
        path: string
        name: string
        content: string
      } | null>
      notesSaveFile: (options: {
        content: string
        defaultPath?: string
      }) => Promise<{
        path: string
        name: string
      } | null>
      onOpenFileRequest: (
        callback: (payload: OpenFilePayload) => void
      ) => () => void
      notifyRendererReady: () => Promise<void>
      onNotesFlushRequest: (callback: () => void) => () => void

      /** 草稿纸置顶小窗 */
      scratchOpen: () => Promise<void>
      scratchClose: () => Promise<void>
      scratchPin: (pinned: boolean) => Promise<void>

      /** 端口占用排查 */
      portsCommon: () => Promise<number[]>
      portsInspect: (ports: number[]) => Promise<PortInspectResult[]>
      portsKill: (pid: number) => Promise<{ ok: boolean; pid: number; error?: string }>

      /** 电脑硬件配置与实时进程内存检测 */
      systemInfo: () => Promise<SystemHardwareInfo>
      systemProcessList: () => Promise<AppProcessMemory[]>
      systemKillProcess: (pid: number) => Promise<{ ok: boolean; pid: number; error?: string }>
    }
  }
}
