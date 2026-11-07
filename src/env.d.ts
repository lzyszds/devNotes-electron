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

type TrayTitleMode = 'dual' | 'pnl_mem' | 'pnl' | 'equity' | 'memory' | 'ticker' | 'none'

/** 托盘状态显示配置（主进程持久化到 electron-store 的 tray-status 键） */
interface TrayStatusConfig {
  enabled: boolean
  /** 自动刷新间隔，秒 */
  intervalSec: 5 | 10 | 30
  /** 状态栏标题挂字模式 */
  titleMode?: TrayTitleMode
  /** 选定关注的行情代码 */
  tickerSymbol?: string
  /** 是否在托盘右键菜单中显示行情与持仓收益 */
  showMarketInMenu?: boolean
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
    /** 同步写 electron-store（pagehide / 退出紧急路径） */
    storeSetSync?: (key: string, value: any) => boolean
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
    notifyCaptureShown?: () => void

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
    /** 调试日志落盘（即发即忘） */
    debugLog?: (line: string) => void
    /**
     * 告诉主进程截图订阅已经挂好：主进程开始直推、不再留缓存，
     * 并把冷启动 / 页面刷新期间暂存的那张补推过来。
     */
    notifyCaptureOcrReady?: () => void

    /* light-ocr（PP-OCRv6 子进程）识别：依赖缺失时 unsupported，渲染层回退 tesseract */
    lightOcr?: (
      dataUrl: string,
      provider?: 'auto' | 'cpu' | 'apple',
      requestId?: number
    ) => Promise<
      { status: 'ok'; text: string }
      | { status: 'unsupported' }
      | { status: 'failed'; reason: string }
    >
    /** 识别进度。stage 只做文案归类；value 是本阶段进度（0~1），weight 是它在整条进度里的占比 */
    onOcrProgress?: (
      callback: (progress: {
        requestId: number
        stage: 'engine' | 'detect' | 'recognize'
        value: number
        weight?: number
        current?: number
        total?: number
      }) => void
    ) => () => void

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
    clipboardCopyImage?: (imageDataUrl: string) => Promise<boolean>
    /** 按条目 id 复制图片（原图在磁盘，主进程按需读） */
    clipboardCopyImageById?: (entryId: string) => Promise<boolean>
    /** 上云用的剪贴板投影：图片已脱敏成【图片】，只回轻条目 */
    clipboardProjectForSync?: () => Promise<
      { id: string; type: 'text'; text: string; at: number }[]
    >
    onClipboardChanged?: (callback: (entries: ClipboardEntry[]) => void) => () => void

    /* 选中即粘贴到外部应用（需辅助功能授权） */
    clipboardOpenAccessibility?: () => Promise<void>
    permissionsGet?: () => Promise<{ accessibilitySupported: boolean; accessibility: boolean; pasteAvailable: boolean; platform: string }>
    permissionsRequestAccessibility?: () => Promise<boolean>
    marketQuotes?: (payload: { spot: string[]; contracts: string[] }) => Promise<{
      symbol: string; name: string; kind: 'contract' | 'spot'; asset: 'crypto' | 'equity'; price: number; changePercent: number;
      change: number; currency: string; fundingRate?: number; openInterest?: number; high24h?: number; low24h?: number;
      markPrice?: number; nextFundingTime?: number; fundingIntervalHours?: number; turnover24h?: number; longRatio?: number;
      open?: number; prevClose?: number; volume?: number; turnoverRate?: number; pe?: number; pb?: number;
      amplitude?: number; floatMarketCap?: number; marketCap?: number; updatedAt: number;
    }[]>
    marketHot?: (payload?: {
      limit?: number
      offset?: number
      assetFilter?: 'all' | 'crypto' | 'equity'
      force?: boolean
    }) => Promise<{
      items: Array<{
        symbol: string; name: string; kind: 'contract' | 'spot'; asset: 'crypto' | 'equity'; price: number; changePercent: number;
        change: number; currency: string; fundingRate?: number; openInterest?: number; high24h?: number; low24h?: number;
        markPrice?: number; nextFundingTime?: number; fundingIntervalHours?: number; turnover24h?: number; longRatio?: number;
        open?: number; prevClose?: number; volume?: number; turnoverRate?: number; pe?: number; pb?: number;
        amplitude?: number; floatMarketCap?: number; marketCap?: number; updatedAt: number;
      }>
      offset: number
      limit: number
      total: number
      hasMore: boolean
    }>
    marketNews?: (payload?: {
      page?: number
      pageSize?: number
      force?: boolean
    }) => Promise<{
      items: Array<{
        title: string
        url: string
        source: string
        publishedAt: string
        category: 'equity' | 'crypto' | 'exchange'
        sentiment: 'bull' | 'bear' | 'neutral'
      }>
      page: number
      pageSize: number
      totalCount: number
      hasMore: boolean
    }>
    marketCandles?: (payload: {
      symbol: string
      kind: 'contract' | 'spot'
      interval?: '1h' | '4h' | '1d'
    }) => Promise<number[]>
    marketAccount?: () => Promise<{
      /** 失败的字段为 null（不是 0），渲染层据此显示 --，别把失败当成零资产/空仓 */
      total: number | null
      available: number | null
      unrealisedPnl: number | null
      /** 合约 total + 现货 USDT；总资产估值 = totalAsset + unrealisedPnl */
      totalAsset: number | null
      totalAssetSpot: number | null
      openPositions: Array<{
        contract: string
        symbol: string
        mode: string
        side: 'long' | 'short'
        size: number
        value: number
        entryPrice: number
        markPrice: number
        unrealisedPnl: number
        pnlPercent: number
        leverage: number
        liqPrice: number
        margin: number
      }> | null
      spotBalances: Array<{
        currency: string
        available: number
        locked: number
      }> | null
      balanceError?: string
      positionError?: string
      spotError?: string
      /** 有任意一个账户接口失败时为 true，成功的部分照常展示 */
      partial?: boolean
      updatedAt: number
    }>
    /** 只返回配置状态；Key 与 Secret 永远不会回传到渲染进程。 */
    gateCredentialsStatus?: () => Promise<{ configured: boolean; encryptionAvailable: boolean }>
    gateCredentialsSave?: (payload: { key: string; secret: string }) => Promise<{ configured: boolean; encryptionAvailable: boolean }>
    gateCredentialsClear?: () => Promise<{ configured: boolean; encryptionAvailable: boolean }>
    clipboardPaste?: (
      payload: {
        type: 'text' | 'image' | 'file'
        text?: string
        imageDataUrl?: string
        filePath?: string
      }
    ) => Promise<{ ok: boolean; reason?: 'no-module' | 'no-permission' | 'failed' }>
    /** 按条目 id 粘贴图片：主进程读原图文件 → base64 → 写剪贴板 → 模拟 ⌘V */
    clipboardPasteImage?: (
      entryId: string
    ) => Promise<{ ok: boolean; reason?: 'no-module' | 'no-permission' | 'failed' }>

    /* 文件局域网分享 */

    /* 文件哈希 */
    hashPick?: () => Promise<string[]>
    hashCompute?: (payload: { paths: string[]; algorithms: string[]; requestId: number }) => Promise<HashFileResult[]>
    onHashProgress?: (callback: (progress: HashFileProgress & { requestId: number }) => void) => () => void

    /* Speedtest® CLI（Ookla 官方，主进程跑二进制，进度以事件推送） */
    speedtestStart?: () => Promise<{ id: number }>
    speedtestStop?: (id: number) => Promise<void>
    onSpeedtestEvent?: (callback: (event: SpeedtestIpcEvent) => void) => () => void

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

    /* 托盘状态显示（内存占用等），配置在设置面板里改 */
    trayStatusGet?: () => Promise<TrayStatusConfig>
    trayStatusSet?: (cfg: Partial<TrayStatusConfig>) => Promise<TrayStatusConfig>

    /* 电脑配置与内存检测 */
    systemInfo?: () => Promise<import('./types/system').SystemHardwareInfo>
    systemProcessList?: () => Promise<import('./types/system').AppProcessMemory[]>
    systemLive?: () => Promise<import('./types/system').SystemLive>
    systemLiveProcesses?: () => Promise<import('./types/system').LiveProcess[]>
    systemVolumes?: () => Promise<import('./types/system').DiskVolume[]>
    systemProcessIcons?: (paths: string[]) => Promise<Record<string, string | null>>
    systemProcessSignal?: (pids: number[], action: 'suspend' | 'resume') => Promise<{ ok: boolean; failed: number }>
    systemSpawn?: (command: string) => Promise<{ ok: boolean; pid?: number; error?: string }>
    systemStartupList?: () => Promise<import('./types/system').StartupItem[]>
    systemStartupToggle?: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
    systemKillProcess?: (pid: number) => Promise<{ ok: boolean; pid: number; error?: string }>
    systemDiskChoose?: () => Promise<string | null>
    systemDiskScan?: (root: string) => Promise<{ path: string; name: string; sizeBytes: number; isDirectory: boolean; modifiedAt: number }[]>
    systemDiskReveal?: (target: string) => Promise<boolean>
    systemDevTools?: () => Promise<{ id: string; name: string; installed: boolean; version?: string; path?: string }[]>
    clipboardPasteAvailable?: () => Promise<boolean>
    clipboardPastePermission?: () => Promise<boolean>
    clipboardRequestPermission?: () => Promise<boolean>
    clipboardOpenAccessibility?: () => Promise<void>
    /** 释放可回收内存（macOS：/usr/sbin/purge，清文件缓存；用户在管理员密码框取消时 cancelled=true） */
    memoryRelease?: () => Promise<{ ok: boolean; message: string; cancelled?: boolean }>
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

/** Speedtest® CLI 推送给渲染层的事件（带运行 id） */
type SpeedtestIpcEvent =
  | { id: number; kind: 'status'; status: 'checking' | 'downloading' | 'ready' | 'starting' }
  | {
      id: number
      kind: 'progress'
      phase: 'ping' | 'download' | 'upload'
      progress: number
      mbps: number | null
      pingMs: number | null
      jitterMs: number | null
      serverName?: string
      serverLocation?: string
      isp?: string
    }
  | {
      id: number
      kind: 'result'
      downloadMbps: number
      uploadMbps: number
      pingMs: number
      jitterMs: number
      packetLoss: number | null
      isp: string
      serverName: string
      serverLocation: string
      serverId: number | null
      resultUrl: string | null
      externalIp: string | null
    }
  | { id: number; kind: 'error'; message: string }
  | { id: number; kind: 'done'; code: number | null }

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
  /**
   * type='image' 时的 PNG dataURL —— 只在「采集瞬间 → 主进程落盘」这一内存
   * 通道里存在；持久化历史里不再内嵌 base64（图片已改为文件态存储）。
   */
  imageDataUrl?: string
  /**
   * type='image' 时磁盘上的原图文件指针（clipboard-images/<imageId>.png）。
   * 面板缩略图用 dnclip://thumb/<imageId> 直读，粘贴走 clipboardPasteImage。
   */
  imageId?: string
  /** type='image' 时原图字节数（不经解码即可显示大小） */
  imageBytes?: number
  /** type='file' 时的绝对路径 */
  filePath?: string
  /** 采集时刻（毫秒时间戳） */
  at: number
  /** 原文超长被截断 */
  truncated?: boolean
}
