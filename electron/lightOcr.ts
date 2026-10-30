import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/*
 * light-ocr（@arcships/light-ocr，PP-OCRv6 small）主引擎桥接。
 *
 * 常驻方式：第一次识别时用 process.execPath 加 ELECTRON_RUN_AS_NODE=1 起一个
 * 纯 Node 子进程跑 `serve` 模式，之后每张图走 stdin/stdout 的一个 JSON 行，
 * 引擎（含 det/rec 模型）全程只创建一次。
 *
 * 为什么不再「一图一进程」：那是之前的写法，实测每张图要额外付一次
 * process 启动 + native 加载 + createEngine（约 0.7s）的开销，而且每次都是
 * 冷启动；现在这 0.7s 只在应用第一次用 OCR 时付一次。
 *
 * 为什么不开在 Electron 主进程里 require：det+rec 常驻是一两百 MB 的内存底线，
 * 挂在主进程里等于让整个应用背着它。子进程还能在闲置 / 超时后整个收掉
 * （见 main.ts 的 registerLightOcr），主进程零常驻。
 *
 * 打包注意：这组 node_modules 包必须 asarUnpack —— 子进程里的 plain Node
 * 读不了 asar（native .node 也一样）， Hence package.json 的 asarUnpack 配置。
 * asar 内的 require.resolve 会指向 app.asar/...，统一替换成
 * app.asar.unpacked 后再 existsSync。
 */

export type LightOcrOutcome =
  | { status: 'ok'; text: string }
  | { status: 'unsupported' }
  | { status: 'failed'; reason: string }

const CLI_RELATIVE = path.join('@arcships', 'light-ocr', 'src', 'cli.cjs')

function cliFile(): string | null {
  // 打包后：resourcesPath/app.asar.unpacked/node_modules/@arcships/light-ocr/src/cli.cjs
  const packaged = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    CLI_RELATIVE,
  )
  if (existsSync(packaged)) return packaged
  // 开发态：dist-electron 的上一级就是仓库根
  const dev = path.join(__dirname, '..', 'node_modules', CLI_RELATIVE)
  if (existsSync(dev)) return dev
  return null
}

function extractPng(dataUrl: string): Buffer | null {
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl)
  if (!match) return null
  try {
    return Buffer.from(match[1], 'base64')
  } catch {
    return null
  }
}

/** 单张图的识别超时。PP-OCRv6 small 在 CPU 上跑 124 行约 6s，长截图留足余量 */
const RECOGNIZE_TIMEOUT_MS = 90_000
/** 引擎启动（进程 + native + 建 engine）的超时，实测约 0.7s，给宽的 */
const BOOT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/** 只取 JSON 里关心的字段：所有行文本按识别顺序拼接 */
function linesToText(result: { lines?: Array<{ text?: unknown }> }): string {
  const lines = Array.isArray(result.lines) ? result.lines : []
  return lines.map((line) => (typeof line.text === 'string' ? line.text : '')).join('\n')
}

/*
 * 引擎开关。渲染层传 execution.provider 时优先听它的：`auto` 在 macOS 上会挑
 * Apple CoreML，实测同一张 125 行的截图 CoreML 要比 CPU 慢一倍（rec 段
 * 10.7s vs 6.1s），所以默认钉死 CPU。
 */
export interface LightOcrOptions {
  provider?: 'auto' | 'cpu' | 'apple'
  /** 分阶段进度回调（起引擎 / 排版分析 / 逐行识别），见 makeLightProgress */
  onProgress?: (progress: { progress: number; status: string; weight: number }) => void
}

interface Pending {
  resolve: (value: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let child: ChildProcess | null = null
let booting: Promise<void> | null = null
let seq = 0
const pending = new Map<number, Pending>()
/** 引擎在忙（不可并发：native 侧 maxConcurrentCalls = 1） */
let busy = false
let idleTimer: ReturnType<typeof setTimeout> | null = null

/** 闲置多久把子进程整个收掉。再识别会重新付一次 0.7s 的启动，这个取舍是值的 */
const IDLE_SHUTDOWN_MS = 3 * 60_000

function stderrTail(line: string): void {
  const text = line.trim()
  if (text) console.warn('[lightOcr]', text.slice(0, 400))
}

function dispose(reason: string): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  busy = false
  const current = child
  child = null
  booting = null
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
    pending.delete(id)
  }
  if (current && !current.killed) current.kill()
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => dispose('引擎闲置关闭'), IDLE_SHUTDOWN_MS)
}

/**
 * 起引擎并等它报 ready。
 *
 * 子进程脚本写在临时的 .cjs 里而不是用 `-e` 内联：命令行长度有限
 * （Windows 约 8KB），内联脚本一长就起不来，而且崩溃时堆栈指向 [eval]
 * 看不出行号。requireresolve 失败（包没装全）就在这里一眼能看出来。
 */
async function ensureEngine(
  provider: 'auto' | 'cpu' | 'apple',
  onProgress?: LightOcrOptions['onProgress']
): Promise<void> {
  if (child && !child.killed) return
  if (booting) return booting

  const cli = cliFile()
  if (!cli) throw new Error('unsupported')

  // 起引擎要 0.7s 左右：先给个「正在启动」的起点，之后由 server 的 ready 推进
  onProgress?.({ progress: 0, status: '准备识别引擎', weight: 6 })
  const script = path.join(path.dirname(cli), 'serve.cjs')
  booting = new Promise<void>((resolve, reject) => {
    const proc = spawn(process.execPath, [script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LIGHT_OCR_PROVIDER: provider },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child = proc

    let ready = false
    const bootTimer = setTimeout(() => {
      if (!ready) {
        dispose('引擎启动超时')
        reject(new Error('引擎启动超时'))
      }
    }, BOOT_TIMEOUT_MS)

    let buffer = ''
    let stderrBuffer = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (!line) continue
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }
        if (message.type === 'ready') {
          ready = true
          clearTimeout(bootTimer)
          onProgress?.({ progress: 1, status: '准备识别引擎', weight: 6 })
          resolve()
          continue
        }
        if (message.type === 'progress' && message.stage === 'detect') {
          // 排版分析（检测框）推两条：开始 / 结束。占比很小，但能让进度条动起来
          onProgress?.({ progress: Number(message.value) || 0, status: '分析排版', weight: 10 })
          continue
        }
        if (message.type === 'progress') continue
        const id = Number(message.id)
        const entry = pending.get(id)
        if (!entry) continue
        pending.delete(id)
        clearTimeout(entry.timer)
        busy = false
        if (typeof message.text === 'string') {
          entry.resolve(message.text)
          scheduleIdleShutdown()
        } else {
          entry.reject(new Error(String(message.error ?? '识别失败')))
        }
      }
    })
    // stderr 只是诊断信息，按行收集避免刷屏；同时拿它做启动失败的线索
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk
      const lines = stderrBuffer.split('\n')
      stderrBuffer = lines.pop() ?? ''
      lines.forEach(stderrTail)
    })

    proc.on('error', (error) => {
      clearTimeout(bootTimer)
      if (!ready) reject(error)
      dispose(`引擎进程异常：${error.message}`)
    })
    proc.on('exit', (code) => {
      clearTimeout(bootTimer)
      // 启动阶段就退出：多半是包缺失 / native 加载失败，把 stderr 尾巴带上
      if (!ready) {
        reject(new Error(`引擎启动失败（exit ${code ?? 'null'}）${stderrBuffer.slice(-300)}`))
      }
      dispose('引擎进程退出')
    })
  }).finally(() => {
    booting = null
  })

  return booting
}

/**
 * 识别一张 PNG（dataURL）。
 *
 * 同一个引擎串行处理请求：native 侧本来就不支持并发（maxConcurrentCalls = 1），
 * 这里排队等待而不是直接报错 —— 用户连截几张图时应该是「第二张等第一张」。
 */
export async function lightOcrRecognize(
  dataUrl: string,
  options: LightOcrOptions = {}
): Promise<LightOcrOutcome> {
  if (!cliFile()) return { status: 'unsupported' }

  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl)
  if (!match) return { status: 'failed', reason: '不是 PNG dataURL' }
  const base64 = match[1]

  const provider = options.provider ?? 'cpu'
  try {
    await ensureEngine(provider, options.onProgress)
  } catch (error) {
    if (String((error as Error).message) === 'unsupported') return { status: 'unsupported' }
    return { status: 'failed', reason: (error as Error).message }
  }

  if (busy) {
    // 上一张还在跑：不并发，等它出结果再发（渲染层本来也是一次一张）
    await new Promise<void>((resolve) => {
      const tick = () => (busy ? setTimeout(tick, 50) : resolve())
      tick()
    })
  }

  const proc = child
  if (!proc || proc.killed || !proc.stdin?.writable) {
    // 引擎刚被闲置回收 / 崩掉的竞态：重建一次再发
    try {
      await ensureEngine(provider, options.onProgress)
    } catch (error) {
      return { status: 'failed', reason: (error as Error).message }
    }
  }
  const target = child
  if (!target || target.killed || !target.stdin?.writable) {
    return { status: 'failed', reason: '引擎不可用' }
  }

  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  busy = true
  seq += 1
  const id = seq

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        busy = false
        // 超时的请求会把引擎拖在「处理中」，直接收掉整个子进程，下次重建
        dispose('识别超时')
        reject(new Error('识别超时'))
      }, RECOGNIZE_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      target.stdin?.write(`${JSON.stringify({ id, png: base64 })}\n`, 'utf8', (error) => {
        if (!error) return
        clearTimeout(timer)
        pending.delete(id)
        busy = false
        dispose('写入引擎失败')
        reject(error)
      })
    })
    return { status: 'ok', text }
  } catch (error) {
    return { status: 'failed', reason: (error as Error).message }
  }
}

/** 应用退出时由 main.ts 调用：别留下一个占着模型内存的孤儿进程 */
export function shutdownLightOcr(): void {
  dispose('应用退出')
}

/** 供 IPC 层报「引擎当前是否在跑」（诊断用） */
export function isLightOcrRunning(): boolean {
  return !!child && !child.killed
}
