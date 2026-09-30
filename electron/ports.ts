/**
 * 端口占用排查：查「谁占了这个端口」，以及把它干掉。
 *
 * 全平台都不引第三方依赖，靠系统自带命令：
 *  - macOS / Linux：lsof 列端口 -> ps 补命令行 -> kill
 *  - Windows：netstat -ano 列端口 -> tasklist 补进程名 -> taskkill
 *
 * 命令一律用 execFile 而不是 exec：参数以数组传入，不经过 shell，
 * 用户输入的端口号再怎么填也拼不进命令行里。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

/** 一条端口占用记录 */
export interface PortListener {
  /** 监听该端口的进程 PID */
  pid: number
  /** 进程名，如 node、java、nginx */
  processName: string
  /** 完整命令行，用于辨认到底是哪个项目的 node */
  command: string
  /** 端口号 */
  port: number
  /** 监听地址：* / 127.0.0.1 / ::1 等 */
  address: string
  /** 协议，目前只会是 TCP */
  protocol: 'TCP'
  /**
   * 是否本进程（devNotes 自己）占用。
   * 干掉自己会让界面当场消失，所以列表里要标出来、并禁止强杀。
   */
  self: boolean
}

export interface KillResult {
  ok: boolean
  pid: number
  /** 失败原因，成功时为空 */
  error?: string
}

/**
 * 常见开发端口。用来在界面上给一排「一键扫」的快捷入口 ——
 * 这几个是前后端开发里最常撞车的，逐个手输太慢。
 */
export const COMMON_PORTS = [3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888]

/** 端口号的合法范围校验。查与杀都要过一遍，防止把奇怪的东西塞给系统命令 */
export function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/** 本进程（主进程及其子进程）的 PID，用来标记「这是 devNotes 自己」 */
function selfPids(): Set<number> {
  const pids = new Set<number>()
  if (typeof process.pid === 'number') pids.add(process.pid)
  // Electron 下 process.pid 是主进程，渲染进程是它的子进程，
  // 用 ppid 链再兜一层过于绕，这里只按主进程判断即可（渲染进程不会监听端口）
  return pids
}

/**
 * 用 `ps` 批量补全进程名与命令行。
 *
 * lsof 只给 PID，没有进程名 —— 而用户真正想看到的是「哦，是个 node 占着」。
 * 一次 ps 拿全表再按 PID 查，比每个 PID 各 fork 一次 ps 快得多。
 */
async function readProcessTable(): Promise<Map<number, { name: string; command: string }>> {
  const table = new Map<number, { name: string; command: string }>()
  try {
    const { stdout } = await run('ps', ['-axo', 'pid=,comm=,args='], {
      maxBuffer: 8 * 1024 * 1024,
    })
    for (const line of stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(\S+)\s*(.*)$/.exec(line)
      if (!match) continue
      const pid = Number(match[1])
      if (!Number.isInteger(pid)) continue
      const name = match[2].split('/').pop() || match[2]
      table.set(pid, { name, command: match[3].trim() || name })
    }
  } catch {
    // ps 挂了就退化成「只有 PID」，不影响主流程
  }
  return table
}

/**
 * 解析 lsof 的输出（已按端口查询，每行一个监听者）。
 *
 * processName 先用 argv[0]，回头由调用方用 ps 表覆写成真正的进程名 ——
 * lsof 的 COMMAND 列被截断到 9 个字符，直接显示会得到 "node (li" 这种东西。
 */
function parseLsof(stdout: string, port: number): PortListener[] {
  const listeners: PortListener[] = []
  const seen = new Set<number>()

  for (const line of stdout.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 9) continue
    // NAME 列可能带 "(LISTEN)" 后缀，但它含空格、位置不固定 —— 判状态要在整行上做
    if (!/\(LISTEN\)/.test(line)) continue
    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME —— 下标 1 是 PID
    const pid = Number(cols[1])
    if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) continue
    seen.add(pid)

    const name = cols[8] || ''
    listeners.push({
      pid,
      processName: cols[0],
      command: '',
      port,
      // 去掉 host 只留监听地址：*:8080 / 127.0.0.1:8080 / [::1]:8080
      address: name.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') || '*',
      protocol: 'TCP',
      self: false,
    })
  }
  return listeners
}

/**
 * 解析 Windows netstat -ano 的输出，只取本地地址确实是该端口、且处于 LISTENING 的行。
 *
 * 必须逐行比对端口号，不能只看行里出现过这个数字：`netstat -ano -p TCP`
 * 输出的是**全部** TCP 连接，18080 的监听行里也含 "8080" 字样，
 * 不过滤就会把不相干的进程列进来。
 */
function parseNetstat(stdout: string, port: number): { pid: number; address: string }[] {
  const rows: { pid: number; address: string }[] = []
  const seen = new Set<number>()
  for (const line of stdout.split('\n')) {
    const cols = line.trim().split(/\s+/)
    // 协议 本地地址 外部地址 状态 PID
    if (cols.length < 5) continue
    if (!/^TCP$/i.test(cols[0])) continue
    if (!/LISTENING/i.test(cols[3])) continue

    // 本地地址形如 0.0.0.0:8080 / [::]:8080，只认端口段完全相等
    const local = cols[1]
    const portPart = local.slice(local.lastIndexOf(':') + 1)
    if (Number(portPart) !== port) continue

    const pid = Number(cols[4])
    if (!Number.isInteger(pid) || seen.has(pid)) continue
    seen.add(pid)
    rows.push({ pid, address: local.replace(/^.*:/, '').replace(/^\[|\]$/g, '') || '*' })
  }
  return rows
}

/** Windows：用 tasklist 批量取进程名，一次问完所有 PID */
async function readWindowsProcessNames(pids: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>()
  if (!pids.length) return names
  try {
    const { stdout } = await run('tasklist', ['/FO', 'CSV', '/NH'], {
      maxBuffer: 8 * 1024 * 1024,
    })
    for (const line of stdout.split('\n')) {
      // CSV 且带引号，进程名里可能有逗号，所以只取前两个字段
      const match = /^"([^"]+)","(\d+)"/.exec(line.trim())
      if (!match) continue
      const pid = Number(match[2])
      if (pids.includes(pid)) names.set(pid, match[1])
    }
  } catch {
    // 忽略：退化到没有进程名
  }
  return names
}

/**
 * 查一个端口上都有谁在监听。
 *
 * 返回数组是因为同一端口可能被多个进程占用（IPv4 一个、IPv6 一个，
 * 或者设了 SO_REUSEPORT）。杀的时候要按条目逐个杀，不能只处理第一个。
 */
export async function inspectPort(port: number): Promise<PortListener[]> {
  if (!isValidPort(port)) return []
  const self = selfPids()

  if (process.platform === 'win32') {
    const { stdout } = await run('netstat', ['-ano', '-p', 'TCP'], {
      maxBuffer: 8 * 1024 * 1024,
    })
    const rows = parseNetstat(stdout, port)
    const names = await readWindowsProcessNames(rows.map((r) => r.pid))
    return rows.map((row) => ({
      pid: row.pid,
      processName: names.get(row.pid) || '未知进程',
      command: '',
      port,
      address: row.address,
      protocol: 'TCP' as const,
      self: self.has(row.pid),
    }))
  }

  // macOS / Linux：-n 不解析主机名（快）、-P 不解析端口名、-iTCP 只看 TCP、-sTCP:LISTEN 只看监听态
  const { stdout } = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
    maxBuffer: 8 * 1024 * 1024,
  })

  const table = await readProcessTable()
  const listeners = parseLsof(stdout, port)
  return listeners.map((item) => {
    const info = table.get(item.pid)
    return {
      ...item,
      processName: info?.name || item.processName,
      command: info?.command || '',
      self: self.has(item.pid),
    }
  })
}

/**
 * 强杀一个进程。
 *
 * 用 SIGKILL / taskkill /F：端口占用的场景要的就是「立刻腾出来」，
 * 发 SIGTERM 让进程自己收尾往往会卡住不退，用户还得再点一次。
 *
 * 杀之前会拒绝掉本进程 —— 那是 devNotes 自己，杀掉等于把界面关了。
 */
export async function killProcess(pid: number): Promise<KillResult> {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return { ok: false, pid, error: '这个进程不能被终止' }
  }

  try {
    if (process.platform === 'win32') {
      await run('taskkill', ['/F', '/PID', String(pid)])
    } else {
      process.kill(pid, 'SIGKILL')
    }
    return { ok: true, pid }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ESRCH') {
      // 查完到点杀之间进程自己退了，这不是失败
      return { ok: true, pid }
    }
    if (code === 'EPERM') {
      return { ok: false, pid, error: '权限不足，请用管理员身份运行 devNotes' }
    }
    return {
      ok: false,
      pid,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
