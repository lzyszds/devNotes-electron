import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/*
 * Windows 原生截图助手（native/win-capture）。
 *
 * 为什么不在 Electron 里画选区：每次截图都要拉起 React、把整张 4K 截图解码后
 * 画在全屏窗口上，入口慢，关闭时还容易露出一帧背景色。这个小 exe 只做
 * “抓快照 → 画选区 → 裁剪编码”三件事，用完退出，不留常驻内存。
 *
 * 用户取消（退出码 2）和失败是两种结果：取消不再弹回退遮罩；
 * 助手缺失、抓不到桌面、输出不是 PNG 时返回 failed，调用方回退到
 * Electron 遮罩，截图功能不因缺一个 exe 就整个不可用。
 */

export interface WindowsNativeResult {
  image: Buffer
  /** 本次临时目录，交给 releaseWindowsNativeResult 幂等删除 */
  directory: string
}

/**
 * 一次原生截图的结果。
 *
 * cancelled（用户按了取消）必须和 failed（助手没跑起来 / 出错）分开：
 * 取消时再去弹一层 Electron 遮罩，用户会觉得“我明明取消了”。
 */
export type WindowsCaptureOutcome =
  | { status: 'ok'; result: WindowsNativeResult }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string }

/** 与 package.json 的 build.win.extraResources 对应 */
const HELPER_RELATIVE = path.join('native', 'devnotes-capture.exe')

function helperPath(): string | null {
  if (process.platform !== 'win32') return null
  // 打包后从 extraResources 找；开发态 resourcesPath 指向 Electron 自己的目录，
  // 所以回退到仓库里的构建产物，方便在 Windows 上直接 dev 验证。
  const candidates = [
    path.join(process.resourcesPath, HELPER_RELATIVE),
    // __dirname 是 dist-electron/，仓库根在上一级
    path.join(__dirname, '..', 'native', 'win-capture', 'build', 'Release', 'devnotes-capture.exe'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  // 都找不到时仍返回打包路径：调用方 isWindowsNativeAvailable 会拦下并回退
  return candidates[0]
}

export function isWindowsNativeAvailable(): boolean {
  const exe = helperPath()
  if (!exe) return false
  try {
    return existsSync(exe)
  } catch {
    return false
  }
}

/**
 * 启动助手并等它退出。
 *
 * 退出码：0 = 已写出 PNG；2 = 用户取消；其它 = 失败。
 * 用户取消返回 2；失败时若助手写了 stderr，把原始原因带上。
 */
export function runWindowsHelper(
  exe: string,
  outputFile: string,
  signal?: AbortSignal,
  launch: typeof spawn = spawn,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = launch(exe, ['--output', outputFile], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      // 只保留末尾一段，异常情况下也不至于把日志撑爆
      stderr = (stderr + chunk.toString('utf8')).slice(-4096)
    })

    const onAbort = () => child.kill()
    signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) {
        resolve(2)
        return
      }
      if (code !== 0 && code !== 2 && stderr.trim()) {
        // 助手能跑但报了具体错误：把原因带上，别只说“截图失败”
        reject(new Error(stderr.trim()))
        return
      }
      resolve(code ?? 1)
    })
  })
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * 完整的一次原生截图：临时目录 → 启动助手 → 读 PNG。
 *
 * 只有“用户主动取消”才返回 cancelled；其余拿不到图的情况一律 failed，
 * 由调用方决定回退到 Electron 遮罩，保证截图功能不会因为缺 exe、杀软拦截、
 * 驱动抓不到桌面而彻底不可用。
 */
export async function captureWindowsRegion(
  signal?: AbortSignal,
  helper: string | null = helperPath(),
  launch: typeof spawn = spawn,
): Promise<WindowsCaptureOutcome> {
  // 调用方的 signal 只在退出应用时被 abort，不是“用户取消”，所以这里不当作 cancelled
  if (!helper) return { status: 'failed', reason: '未找到原生截图助手' }
  if (signal?.aborted) return { status: 'failed', reason: '截图已中止' }

  const directory = await mkdtemp(path.join(tmpdir(), 'devnotes-capture-'))
  const outputFile = path.join(directory, 'selection.png')
  try {
    let code: number
    try {
      code = await runWindowsHelper(helper, outputFile, signal, launch)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn('[capture] Windows 原生助手失败：', reason)
      return { status: 'failed', reason }
    }
    if (signal?.aborted) return { status: 'failed', reason: '截图已中止' }
    // 退出码 2 是助手侧的“用户取消”（Esc / 右键）
    if (code === 2) return { status: 'cancelled' }
    if (code !== 0) return { status: 'failed', reason: `截图助手退出码 ${code}` }

    const image = await readFile(outputFile)
    if (image.length < PNG_SIGNATURE.length || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return { status: 'failed', reason: '截图助手输出不是 PNG' }
    }
    return { status: 'ok', result: { image, directory } }
  } finally {
    // Buffer 已经读进内存，目录可以立刻删
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 兼容“先交付再释放”的调用顺序；目录多半已删，重复删除是幂等的。 */
export async function releaseWindowsNativeResult(
  result: WindowsNativeResult | null,
): Promise<void> {
  if (!result) return
  await rm(result.directory, { recursive: true, force: true }).catch(() => undefined)
}
