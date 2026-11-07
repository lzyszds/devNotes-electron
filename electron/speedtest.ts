import { app } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, promises as fs } from 'fs'
import https from 'https'
import path from 'path'
import { spawn, execFile, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { pipeline } from 'stream/promises'

/*
 * 用官方 Ookla Speedtest® CLI 跑测速。
 *
 * 为什么不继续用渲染层 fetch 拉 Cloudflare / httpbin：
 * - 浏览器测速受同源、并发连接数、代理、CDN 缓存影响，数值经常偏低或飘
 * - 旧实现出错时还会用假数据兜底（Math.max(12.5, …)），等于自欺欺人
 *
 * CLI 走 Ookla 全球节点，协议和网页版 Speedtest 一致；`--format=json --progress=yes`
 * 会按行吐 NDJSON 进度事件，主进程解析后推给渲染层即可做实时表盘。
 *
 * 二进制优先用系统已装的 `speedtest`（需是 Ookla 官方版，不是 Python 的
 * speedtest-cli）；找不到就从 install.speedtest.net 下到 userData 缓存，
 * 免去用户自己 brew / apt 的门槛。
 */

const run = promisify(execFile)

const CLI_VERSION = '1.2.0'

type CliPackage = {
  pkg: string
  sha256: string
  binary: string
}

/** 各平台官方包；sha256 与 Raycast Speedtest 扩展对齐，下载后校验防串改 */
const CLI_PACKAGES: Partial<Record<NodeJS.Platform, CliPackage>> & {
  'linux-x64': CliPackage
  'linux-arm64': CliPackage
} = {
  darwin: {
    pkg: 'macosx-universal.tgz',
    sha256: 'c9f8192149ebc88f8699998cecab1ce144144045907ece6f53cf50877f4de66f',
    binary: 'speedtest',
  },
  win32: {
    pkg: 'win64.zip',
    sha256: '13e3d888b845d301a556419e31f14ab9bff57e3f06089ef2fd3bdc9ba6841efa',
    binary: 'speedtest.exe',
  },
  'linux-x64': {
    pkg: 'linux-x86_64.tgz',
    sha256: '5690596c54ff9bed63fa3732f818a05dbc2db19ad36ed68f21ca5f64d5cfeeb7',
    binary: 'speedtest',
  },
  'linux-arm64': {
    pkg: 'linux-aarch64.tgz',
    sha256: '3953d231da3783e2bf8904b6dd72767c5c6e533e163d3742fd0437affa431bd3',
    binary: 'speedtest',
  },
}

function resolveCliPackage(): CliPackage | null {
  if (process.platform === 'darwin') return CLI_PACKAGES.darwin!
  if (process.platform === 'win32') return CLI_PACKAGES.win32!
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') return CLI_PACKAGES['linux-arm64']
    if (process.arch === 'x64') return CLI_PACKAGES['linux-x64']
  }
  return null
}

function cliDir(): string {
  return path.join(app.getPath('userData'), 'speedtest-cli')
}

function cachedBinaryPath(pkg: CliPackage): string {
  return path.join(cliDir(), pkg.binary)
}

/** 给 GUI 应用补上常见 brew / 本地 bin，Electron 启动时 PATH 经常缺它们 */
function augmentedPath(): string {
  const extras =
    process.platform === 'win32'
      ? []
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  const current = process.env.PATH || ''
  return [...extras, ...current.split(path.delimiter).filter(Boolean)].join(path.delimiter)
}

/** 确认是 Ookla 官方 CLI，而不是 PyPI 的 speedtest-cli（参数/输出完全不同） */
async function isOoklaBinary(bin: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await run(bin, ['--version'], {
      timeout: 4000,
      env: { ...process.env, PATH: augmentedPath() },
      windowsHide: true,
    })
    const text = `${stdout}\n${stderr}`
    return /Speedtest by Ookla|Ookla/i.test(text) || /speedtest\s+1\.\d+/i.test(text)
  } catch {
    return false
  }
}

async function findSystemSpeedtest(): Promise<string | null> {
  const name = process.platform === 'win32' ? 'speedtest.exe' : 'speedtest'
  const candidates = [
    process.platform === 'darwin' ? '/opt/homebrew/bin/speedtest' : '',
    process.platform === 'darwin' ? '/usr/local/bin/speedtest' : '',
    process.platform === 'linux' ? '/usr/bin/speedtest' : '',
  ].filter(Boolean)

  for (const cand of candidates) {
    if (existsSync(cand) && (await isOoklaBinary(cand))) return cand
  }

  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await run(whichCmd, [name.replace(/\.exe$/i, '')], {
      timeout: 3000,
      env: { ...process.env, PATH: augmentedPath() },
      windowsHide: true,
    })
    const first = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean)
    if (first && (await isOoklaBinary(first))) return first
  } catch {
    /* which 找不到就算了，走下载 */
  }
  return null
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = (target: string, redirectsLeft: number) => {
      const req = https.get(
        target,
        {
          headers: {
            /* install.speedtest.net 对默认 Node UA 会 403 */
            'User-Agent': 'devNotes-Speedtest/1.0',
            Accept: '*/*',
          },
        },
        (res) => {
          const code = res.statusCode ?? 0
          if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
            res.resume()
            if (redirectsLeft <= 0) {
              reject(new Error('下载 Speedtest CLI 时重定向过多'))
              return
            }
            request(res.headers.location, redirectsLeft - 1)
            return
          }
          if (code !== 200) {
            res.resume()
            reject(new Error(`下载 Speedtest CLI 失败（HTTP ${code}）`))
            return
          }
          const file = createWriteStream(dest)
          pipeline(res, file).then(resolve).catch(reject)
        },
      )
      req.on('error', reject)
      req.setTimeout(60_000, () => {
        req.destroy(new Error('下载 Speedtest CLI 超时'))
      })
    }
    request(url, 5)
  })
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const data = await fs.readFile(filePath)
  hash.update(data)
  return hash.digest('hex')
}

async function extractArchive(archive: string, destDir: string, pkg: CliPackage): Promise<void> {
  if (process.platform === 'win32') {
    /*
     * Windows 自带 Expand-Archive；不引入 extract-zip 依赖。
     * -Force 覆盖同名文件，避免上次半截解压残留。
     */
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { timeout: 60_000, windowsHide: true },
    )
  } else {
    await run('tar', ['-xzf', archive, '-C', destDir, pkg.binary], { timeout: 60_000 })
  }
  const binary = path.join(destDir, pkg.binary)
  if (!existsSync(binary)) throw new Error('解压后未找到 speedtest 可执行文件')
  if (process.platform !== 'win32') await fs.chmod(binary, 0o755)
}

let ensurePromise: Promise<string> | null = null

/**
 * 返回可用的 Ookla CLI 路径。首次可能下载几十 MB，调用方应在 UI 上提示「准备中」。
 * 并发调用会合并成同一次 ensure，避免重复下载。
 */
export async function ensureSpeedtestCli(
  onStatus?: (status: 'checking' | 'downloading' | 'ready') => void,
): Promise<string> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      onStatus?.('checking')
      const system = await findSystemSpeedtest()
      if (system) {
        onStatus?.('ready')
        return system
      }

      const pkg = resolveCliPackage()
      if (!pkg) throw new Error('当前平台暂不支持自动安装 Speedtest CLI')

      const binary = cachedBinaryPath(pkg)
      if (existsSync(binary) && (await isOoklaBinary(binary))) {
        onStatus?.('ready')
        return binary
      }

      onStatus?.('downloading')
      const dir = cliDir()
      const tmp = path.join(dir, '.tmp')
      await fs.mkdir(tmp, { recursive: true })
      const archivePath = path.join(tmp, pkg.pkg)
      const url = `https://install.speedtest.net/app/cli/ookla-speedtest-${CLI_VERSION}-${pkg.pkg}`

      try {
        await downloadFile(url, archivePath)
        const digest = await sha256File(archivePath)
        if (digest !== pkg.sha256) {
          throw new Error('Speedtest CLI 校验失败，请稍后重试')
        }
        await fs.mkdir(dir, { recursive: true })
        await extractArchive(archivePath, dir, pkg)
      } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      }

      if (!(await isOoklaBinary(binary))) {
        throw new Error('Speedtest CLI 安装后无法运行')
      }
      onStatus?.('ready')
      return binary
    })().finally(() => {
      ensurePromise = null
    })
  }
  return ensurePromise
}

export type SpeedtestPhase = 'preparing' | 'ping' | 'download' | 'upload' | 'completed' | 'error'

export type SpeedtestEvent =
  | { kind: 'status'; status: 'checking' | 'downloading' | 'ready' | 'starting' }
  | {
      kind: 'progress'
      phase: 'ping' | 'download' | 'upload'
      /** 当前阶段 0~1 */
      progress: number
      /** 瞬时带宽（Mbps）；ping 阶段为 null */
      mbps: number | null
      pingMs: number | null
      jitterMs: number | null
      serverName?: string
      serverLocation?: string
      isp?: string
    }
  | {
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
  | { kind: 'error'; message: string }
  | { kind: 'done'; code: number | null }

/** bytes/s → Mbps（十进制兆比特，与 Speedtest 网页默认单位一致） */
export function bytesPerSecToMbps(bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0) return 0
  return Math.round((bps / 125_000) * 100) / 100
}

function describeCliFailure(stderr: string, code: number | null): string {
  if (/NoNetworkConnection|offline/i.test(stderr)) return '看起来没有可用的网络连接'
  if (/Too many requests|Limit reached/i.test(stderr)) {
    return '测速过于频繁，Ookla 暂时限流，请稍后再试'
  }
  const line = stderr
    .split(/\r?\n/)
    .map((l) => {
      try {
        const obj = JSON.parse(l) as { message?: string; level?: string }
        if (obj.level === 'error' && obj.message) return obj.message
      } catch {
        /* 非 JSON 行 */
      }
      return l.replace(/^\[[^\]]*]\s*\[error]\s*/i, '').trim()
    })
    .find((l) => l.length > 0)
  return line ? `测速失败：${line}` : `测速失败（退出码 ${code ?? '未知'}）`
}

type RawEvent = {
  type?: string
  isp?: string
  packetLoss?: number
  ping?: { jitter?: number; latency?: number; progress?: number }
  download?: { bandwidth?: number; progress?: number }
  upload?: { bandwidth?: number; progress?: number }
  server?: { id?: number; name?: string; location?: string; country?: string }
  interface?: { externalIp?: string }
  result?: { url?: string; id?: string }
}

/**
 * 启动一次测速。返回 stop() 可中途杀掉子进程。
 * onEvent 会收到准备状态、阶段进度、最终结果与结束信号。
 */
export function startSpeedtest(onEvent: (event: SpeedtestEvent) => void): () => void {
  let child: ChildProcess | null = null
  let cancelled = false
  let stderr = ''
  let stdoutBuffer = ''
  /** 已经推过 result 或 error，close 时就别再二次报错 */
  let settled = false

  const finish = (event?: SpeedtestEvent) => {
    if (settled) return
    settled = true
    if (event) onEvent(event)
  }

  const handleLine = (raw: string) => {
    const line = raw.trim()
    if (!line) return
    let data: RawEvent
    try {
      data = JSON.parse(line) as RawEvent
    } catch {
      return
    }
    const type = data.type
    if (!type || type === 'log') return

    if (type === 'testStart') {
      onEvent({
        kind: 'progress',
        phase: 'ping',
        progress: 0,
        mbps: null,
        pingMs: null,
        jitterMs: null,
        serverName: data.server?.name,
        serverLocation: [data.server?.location, data.server?.country].filter(Boolean).join(', '),
        isp: data.isp,
      })
      return
    }

    if (type === 'ping' && data.ping) {
      onEvent({
        kind: 'progress',
        phase: 'ping',
        progress: data.ping.progress ?? 0,
        mbps: null,
        pingMs: data.ping.latency ?? null,
        jitterMs: data.ping.jitter ?? null,
      })
      return
    }

    if (type === 'download' && data.download) {
      onEvent({
        kind: 'progress',
        phase: 'download',
        progress: data.download.progress ?? 0,
        mbps: bytesPerSecToMbps(data.download.bandwidth ?? 0),
        pingMs: null,
        jitterMs: null,
      })
      return
    }

    if (type === 'upload' && data.upload) {
      onEvent({
        kind: 'progress',
        phase: 'upload',
        progress: data.upload.progress ?? 0,
        mbps: bytesPerSecToMbps(data.upload.bandwidth ?? 0),
        pingMs: null,
        jitterMs: null,
      })
      return
    }

    if (type === 'result') {
      settled = true
      onEvent({
        kind: 'result',
        downloadMbps: bytesPerSecToMbps(data.download?.bandwidth ?? 0),
        uploadMbps: bytesPerSecToMbps(data.upload?.bandwidth ?? 0),
        pingMs: Math.round((data.ping?.latency ?? 0) * 100) / 100,
        jitterMs: Math.round((data.ping?.jitter ?? 0) * 100) / 100,
        packetLoss: typeof data.packetLoss === 'number' ? data.packetLoss : null,
        isp: data.isp ?? '',
        serverName: data.server?.name ?? '',
        serverLocation: [data.server?.location, data.server?.country].filter(Boolean).join(', '),
        serverId: data.server?.id ?? null,
        resultUrl: data.result?.url ?? null,
        externalIp: data.interface?.externalIp ?? null,
      })
    }
  }

  const onStdout = (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''
    lines.forEach(handleLine)
  }

  void (async () => {
    try {
      const binary = await ensureSpeedtestCli((status) => {
        if (!cancelled) onEvent({ kind: 'status', status })
      })
      if (cancelled) return

      onEvent({ kind: 'status', status: 'starting' })
      child = spawn(
        binary,
        [
          '--format=json',
          '--progress=yes',
          '--progress-update-interval=200',
          '--accept-license',
          '--accept-gdpr',
        ],
        {
          windowsHide: true,
          env: { ...process.env, PATH: augmentedPath() },
        },
      )

      child.stdout?.on('data', onStdout)
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', (err) => {
        finish({
          kind: 'error',
          message: err.message.includes('ENOENT') ? '找不到 Speedtest CLI' : err.message,
        })
        onEvent({ kind: 'done', code: null })
      })
      child.on('close', (code) => {
        if (stdoutBuffer.trim()) handleLine(stdoutBuffer)
        stdoutBuffer = ''
        if (cancelled) {
          onEvent({ kind: 'done', code })
          return
        }
        if (code !== 0 && !settled) {
          finish({ kind: 'error', message: describeCliFailure(stderr, code) })
        } else if (code === 0 && !settled) {
          finish({ kind: 'error', message: '测速已结束，但没有拿到结果' })
        }
        onEvent({ kind: 'done', code })
      })
    } catch (err) {
      if (cancelled) {
        onEvent({ kind: 'done', code: null })
        return
      }
      finish({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
      onEvent({ kind: 'done', code: null })
    }
  })()

  return () => {
    cancelled = true
    if (child && !child.killed) {
      child.kill()
      child = null
    }
  }
}
