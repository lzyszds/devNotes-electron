import { spawn, type ChildProcess } from 'child_process'
import dns from 'dns'
import http from 'http'
import https from 'https'
import net from 'net'

/*
 * 网络探测：三种方式互相补充。
 * - ICMP ping：调系统 ping，看链路通不通、延迟和丢包（需要系统 ping 命令）
 * - TCP 端口：只测能不能连上某个端口，服务是否在监听，比 ping 更贴近真实业务
 * - HTTP(S)：DNS 解析 + 响应首字节时间 + 状态码，能看出是网络慢还是服务慢
 *
 * 目标地址会被校验，命令一律用参数数组调用，不经过 shell，防止注入。
 */

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

/** 允许的主机名 / IPv4 / IPv6 */
export function validateHost(input: string): string | null {
  const host = input.trim()
  if (!host || host.length > 253) return null
  if (host.includes(':') && /^[0-9a-fA-F:.]+$/.test(host)) return host
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) return host
  return null
}

export function validatePort(port: number): number | null {
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

/* ---------------- ICMP ping ---------------- */

export interface PingOptions {
  count: number
  intervalSec: number
  timeoutSec: number
  size: number
}

export type PingEvent =
  | { kind: 'reply'; seq: number; ms: number; ttl: number | null }
  | { kind: 'timeout'; seq: number }
  | { kind: 'error'; message: string }
  | { kind: 'done'; code: number | null }

const REPLY_TIME_RE = /(?:time|时间)\s*[=<]\s*([\d.]+)\s*ms/i
const LESS_THAN_1MS_RE = /(?:time|时间)\s*<\s*1\s*ms/i
const TTL_RE = /ttl\s*=\s*(\d+)/i
const TIMEOUT_RE = /timeout|timed out|超时|unreachable|无法访问/i

/** 解析一行 ping 输出；不是逐包结果的行（统计、表头）返回 null */
export function parsePingLine(line: string): { kind: 'reply'; ms: number; ttl: number | null } | { kind: 'timeout' } | null {
  if (LESS_THAN_1MS_RE.test(line)) {
    const ttl = TTL_RE.exec(line)
    return { kind: 'reply', ms: 0.5, ttl: ttl ? Number(ttl[1]) : null }
  }
  const time = REPLY_TIME_RE.exec(line)
  if (time) {
    const ttl = TTL_RE.exec(line)
    return { kind: 'reply', ms: Number(time[1]), ttl: ttl ? Number(ttl[1]) : null }
  }
  if (TIMEOUT_RE.test(line) && /icmp|seq|请求|request|reply|回复|Destination/i.test(line)) {
    return { kind: 'timeout' }
  }
  return null
}

/** 启动一次 ping。返回的 stop 可以中途结束 */
export function startPing(
  host: string,
  opts: PingOptions,
  onEvent: (event: PingEvent) => void,
): () => void {
  const timeoutMs = Math.round(opts.timeoutSec * 1000)
  let child: ChildProcess | null = null
  let seq = 0
  let buffer = ''

  const handleLine = (raw: string) => {
    const line = raw.trim()
    if (!line) return
    const parsed = parsePingLine(line)
    if (!parsed) return
    seq += 1
    if (parsed.kind === 'reply') onEvent({ kind: 'reply', seq, ms: parsed.ms, ttl: parsed.ttl })
    else onEvent({ kind: 'timeout', seq })
  }

  const onData = (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    lines.forEach(handleLine)
  }

  if (IS_WIN) {
    // Windows 下 ping 的输出编码跟控制台代码页走（中文系统是 GBK），先切到 UTF-8 再执行
    const cmd = `chcp 65001>nul && ping -n ${opts.count} -w ${timeoutMs} -l ${opts.size} ${host}`
    child = spawn('cmd', ['/d', '/s', '/c', cmd], { windowsHide: true })
  } else {
    // macOS 的 -W 单位是毫秒，Linux 的 -W 是秒
    const waitArg = IS_MAC ? String(timeoutMs) : String(opts.timeoutSec)
    const args = ['-c', String(opts.count), '-i', String(opts.intervalSec), '-W', waitArg, '-s', String(opts.size), host]
    child = spawn('ping', args, { windowsHide: true })
  }

  child.stdout?.on('data', onData)
  child.stderr?.on('data', (chunk: Buffer) => {
    const message = chunk.toString('utf8').trim()
    if (message) onEvent({ kind: 'error', message })
  })
  child.on('error', (err) => {
    onEvent({ kind: 'error', message: err.message.includes('ENOENT') ? '系统没有 ping 命令' : err.message })
    onEvent({ kind: 'done', code: null })
  })
  child.on('close', (code) => {
    if (buffer) handleLine(buffer)
    buffer = ''
    onEvent({ kind: 'done', code })
  })

  return () => {
    if (child && !child.killed) child.kill()
  }
}

/* ---------------- TCP 端口 ---------------- */

export interface TcpResult {
  ok: boolean
  ms: number | null
  error?: string
}

function friendlyNetError(err: NodeJS.ErrnoException): string {
  switch (err.code) {
    case 'ECONNREFUSED':
      return '端口未开放（连接被拒绝）'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return '域名解析失败'
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return '主机不可达'
    case 'ETIMEDOUT':
      return '连接超时'
    default:
      return err.message
  }
}

export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<TcpResult> {
  return new Promise((resolve) => {
    const started = performance.now()
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (result: TcpResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ ok: true, ms: performance.now() - started }))
    socket.once('timeout', () => finish({ ok: false, ms: null, error: '连接超时' }))
    socket.once('error', (err) => finish({ ok: false, ms: null, error: friendlyNetError(err as NodeJS.ErrnoException) }))
  })
}

/* ---------------- HTTP(S) ---------------- */

export interface HttpResult {
  ok: boolean
  status: number | null
  dnsMs: number | null
  ttfbMs: number | null
  server: string | null
  error?: string
}

export async function httpProbe(url: string, timeoutMs: number): Promise<HttpResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, status: null, dnsMs: null, ttfbMs: null, server: null, error: '地址格式不对' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, status: null, dnsMs: null, ttfbMs: null, server: null, error: '只支持 http / https' }
  }

  // DNS 单独计时，方便区分是解析慢还是服务慢
  let dnsMs: number | null = null
  const dnsStart = performance.now()
  try {
    await dns.promises.lookup(parsed.hostname)
    dnsMs = performance.now() - dnsStart
  } catch {
    return { ok: false, status: null, dnsMs: null, ttfbMs: null, server: null, error: '域名解析失败' }
  }

  const mod = parsed.protocol === 'https:' ? https : http
  return new Promise((resolve) => {
    const started = performance.now()
    let settled = false
    const finish = (result: HttpResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const req = mod.request(parsed, { method: 'GET', timeout: timeoutMs, headers: { 'User-Agent': 'devNotes-probe' } }, (res) => {
      const ttfbMs = performance.now() - started
      const status = res.statusCode ?? null
      const server = typeof res.headers.server === 'string' ? res.headers.server : null
      res.destroy()
      finish({ ok: status !== null && status < 500, status, dnsMs, ttfbMs, server })
    })
    req.on('timeout', () => {
      req.destroy()
      finish({ ok: false, status: null, dnsMs, ttfbMs: null, server: null, error: '请求超时' })
    })
    req.on('error', (err) => {
      finish({ ok: false, status: null, dnsMs, ttfbMs: null, server: null, error: friendlyNetError(err as NodeJS.ErrnoException) })
    })
    req.end()
  })
}
