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

    /* 端口占用排查 */
    portsCommon?: () => Promise<number[]>
    portsInspect?: (ports: number[]) => Promise<PortInspectResult[]>
    portsKill?: (pid: number) => Promise<{ ok: boolean; pid: number; error?: string }>
  }
}
