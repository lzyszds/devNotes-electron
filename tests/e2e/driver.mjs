/**
 * E2E 驱动器：启动真实打包产物（Electron + dist/），用 CDP 把 checks/*.js 注入渲染进程执行。
 *
 * ─── 三条安全底线，改这个文件时一条都不能松 ──────────────────────────────
 * 这里出过事故：夹具里的测试笔记被自动同步推到了用户真实的 Cloudflare KV
 * （键 fehelper_notes_backup）。起因是一个想当然的假设——「夹具里不放
 * fehelper-cf-sync-config，没有凭据就不会联网」。它是错的：
 *
 *   · src/utils/cloudflareSync.ts 的 DEFAULT_CF_CONFIG 硬编码了真实的 workerUrl，
 *     且 enabled / autoSync / autoSyncOnStartup 全是 true。配置缺失不等于同步关闭，
 *     而是退回默认值去连真实云端。
 *   · loadCloudflareConfig() 末尾还有个分支：只要 workerUrl 为空，就强制
 *     enabled = true、填回真实 workerUrl，再写进 store。所以一份「enabled: false
 *     但没写 workerUrl」的配置，会在启动时被就地改写成开启状态。
 *
 * 于是有下面三条：
 *   1. 必须带 --user-data-dir 指向隔离目录，绝不能沿用真实 userData。
 *   2. 夹具里的 fehelper-cf-sync-config 必须显式写、workerUrl 必须非空（绕开上面那个
 *      强制开启分支）、enabled 必须为 false；workerUrl 指向本地黑洞端口，逻辑被绕过
 *      也打不出去。
 *   3. 每次启动后用 CDP 回读 store 与 localStorage 里的真实配置做断言
 *      （assertSyncBlocked），任一处显示同步开着就当场杀进程退出——最后一道闸。
 *
 * 另有网络层兜底：启动参数里的 --host-resolver-rules 把真实 worker 域名解析到 127.0.0.1。
 *
 * ─── 隔离 ──────────────────────────────────────────────────────────────
 * 每个 check 都**重启一次应用**、从夹具重新起跑。检查之间共享同一个页面会互相污染
 * （前一个 check 留下的正文改动会让后一个的撤销基线错位），而笔记是落盘的，只有重启才真
 * 回到同一起点；顺带也让上面第 3 条每次启动都被验证一遍。
 *
 * 用法：
 *   node tests/e2e/driver.mjs                # 跑全部检查
 *   node tests/e2e/driver.mjs editor-menu    # 只跑指定的检查
 *   node tests/e2e/driver.mjs --verbose      # 通过的断言也逐条打印
 *   node tests/e2e/driver.mjs --keep         # 保留隔离目录，便于事后排查
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const HERE = path.join(ROOT, 'tests', 'e2e')
const USER_DATA = path.join(HERE, '.userdata')
const HARNESS = path.join(HERE, 'lib', 'harness.js')
const CHECK_DIR = path.join(HERE, 'checks')

const CF_KEY = 'fehelper-cf-sync-config'
const NOTES_KEY = 'fehelper-markdown-notes'
/** 真实 worker 域名：夹具里绝不允许出现它 */
const REAL_WORKER_HOST = 'fehelper.1024327189.workers.dev'
/** 黑洞地址：127.0.0.1:9 是 discard 端口，本机不可能有服务在听 */
const BLOCKED_WORKER_URL = 'http://127.0.0.1:9/blocked-by-e2e'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------- 合成夹具 ----------
 * updatedAt 故意给两个不同的值：列表不排序，但万一将来加了排序，夹具仍然稳定。 */
const FIXTURE = {
  [NOTES_KEY]: {
    notes: [
      {
        id: 'e2e-note-1',
        title: 'E2E 测试笔记',
        content: '### E2E 测试笔记\n\n这是端到端测试用的夹具文档，可以随便改。\n',
        createdAt: 1700000000000,
        updatedAt: 1700000200000,
      },
      {
        id: 'e2e-note-2',
        title: '第二篇',
        content: '# 第二篇\n\n内容\n',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ],
    activeId: 'e2e-note-1',
  },
  [CF_KEY]: {
    enabled: false,
    mode: 'worker',
    // 非空是关键：空了就会踩中 loadCloudflareConfig() 的强制开启分支
    workerUrl: BLOCKED_WORKER_URL,
    workerToken: '',
    autoSync: false,
    autoSyncOnStartup: false,
    autoBackupEnabled: false,
    autoBackupOnEdit: false,
    enableE2EE: false,
  },
}

const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const keep = args.includes('--keep')
const only = args.filter((a) => !a.startsWith('--'))

/* ---------- 前置检查 ---------- */
function requireBuild() {
  const needed = ['dist-electron/main.js', 'dist/index.html']
  const missing = needed.filter((f) => !fs.existsSync(path.join(ROOT, f)))
  if (missing.length) {
    console.error('缺少构建产物：' + missing.join('、') + '\n先执行 npm run build:web（或 npm run test:e2e）')
    process.exit(2)
  }
}

function seedUserData() {
  // 整个 profile 目录清掉再建。只重写 config.json 是不够的：Chromium 自己的 Local Storage
  // 会跟着留在同一个目录里，而 loadCloudflareConfig() 在 store 读不到东西时会回退去读
  // localStorage 的 fehelper-cf-sync-config —— 一份上一轮遗留的「enabled: true + 真实
  // workerUrl」就藏在那儿，等于给同步留了后门。要的是全新 profile，不是回收的 profile。
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  const config = path.join(USER_DATA, 'config.json')
  fs.writeFileSync(config, JSON.stringify(FIXTURE, null, 2), 'utf8')

  // 关键断言：写不进去就绝不能启动。只要 config.json 不存在，
  // electron/main.ts 的 migrateUserDataIfNeeded() 就会把用户真实目录的配置
  // （含 CF 凭据）整个搬进来。
  if (!fs.existsSync(config)) throw new Error('夹具写入失败: ' + config)

  const written = JSON.parse(fs.readFileSync(config, 'utf8'))
  const keys = Object.keys(written)
  if (!keys.includes(NOTES_KEY)) throw new Error('夹具缺少 ' + NOTES_KEY + '：' + keys.join(','))

  const cf = written[CF_KEY]
  if (!cf || typeof cf !== 'object') {
    // 绝不能省掉这项：省掉不是「没有凭据」，而是让应用退回 DEFAULT_CF_CONFIG 去连真实 worker
    throw new Error('夹具缺少 ' + CF_KEY + '：留空会让应用退回默认配置连真实云端')
  }
  if (cf.enabled !== false) throw new Error('夹具的 ' + CF_KEY + '.enabled 必须是 false，实际 ' + cf.enabled)
  if (!cf.workerUrl) throw new Error('夹具的 ' + CF_KEY + '.workerUrl 不能为空，空值会触发强制开启分支')
  if (String(cf.workerUrl).includes(REAL_WORKER_HOST)) throw new Error('夹具的 workerUrl 指向了真实地址: ' + cf.workerUrl)
  for (const k of ['autoSync', 'autoSyncOnStartup', 'autoBackupEnabled', 'autoBackupOnEdit']) {
    if (cf[k] !== false) throw new Error('夹具的 ' + CF_KEY + '.' + k + ' 必须是 false，实际 ' + cf[k])
  }
}

function resolveElectron() {
  // electron 包的 main 导出的就是可执行文件路径，天然跨平台（electron.exe / Electron.app/...）
  const exe = require('electron')
  if (typeof exe !== 'string' || !fs.existsSync(exe)) throw new Error('解析不到 electron 可执行文件: ' + exe)
  return exe
}

async function pickPort(start = 9223) {
  for (let p = start; p < start + 10; p++) {
    try {
      await fetch(`http://127.0.0.1:${p}/json/version`)
    } catch {
      return p // 连不上 = 端口空着
    }
  }
  throw new Error('找不到空闲的调试端口')
}

/* ---------- CDP ---------- */
let child = null
let ws = null
let wsId = 0
let pending = new Map()
let pageErrors = []
let appLog = []

function send(method, params, timeout = 120000) {
  const id = ++wsId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(method + ' 超时'))
      }
    }, timeout)
  })
}

async function findTarget(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const page = (await res.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await sleep(500)
  }
  throw new Error('等不到调试目标（应用没起来？）')
}

/** 求值一段页内表达式，返回它的值；页内抛异常会变成 JS 异常 */
async function evaluate(expression, timeout = 120000) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout)
  const result = res.result || {}
  if (result.exceptionDetails) {
    const d = result.exceptionDetails
    throw new Error('页内求值抛异常: ' + ((d.exception && d.exception.description) || d.text))
  }
  return result.result ? result.result.value : undefined
}

/* ---------- 启动 / 关闭 ---------- */
async function startApp(electron) {
  seedUserData()
  const port = await pickPort()

  pageErrors = []
  appLog = []

  child = spawn(
    electron,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${USER_DATA}`,
      '--no-first-run',
      '--no-default-browser-check',
      // 网络层兜底：就算同步逻辑被绕过，真实 worker 域名也解析不到
      `--host-resolver-rules=MAP ${REAL_WORKER_HOST} 127.0.0.1`,
      path.join(ROOT, 'dist-electron', 'main.js'),
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  child.stdout.on('data', (d) => appLog.push('[out] ' + d.toString().trim()))
  child.stderr.on('data', (d) => appLog.push('[err] ' + d.toString().trim()))

  const target = await findTarget(port)
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('WebSocket 连接失败'))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      p.resolve(msg)
      return
    }
    // 页面自己抛的异常 / console.error，一律算失败
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {}
      pageErrors.push('未捕获异常: ' + ((d.exception && d.exception.description) || d.text))
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      pageErrors.push('console.error: ' + msg.params.args.map((a) => a.value || a.description || a.type).join(' '))
    }
  }
  await send('Runtime.enable', {})

  // 等界面起来：编辑器挂载意味着启动流程已经跑过一轮，配置该写的都写了
  for (let i = 0; i < 100; i++) {
    let ready = false
    try {
      ready = await evaluate('!!document.querySelector(".cm-content")', 15000)
    } catch {}
    if (ready) break
    await sleep(200)
  }

  await assertSyncBlocked()
}

/**
 * 最后一道闸：回读应用**自己**认到的同步配置。
 * 夹具写得对不对是一回事，应用有没有把它改回去是另一回事——必须问应用本体。
 */
async function assertSyncBlocked() {
  const read = () =>
    evaluate(`(async () => {
      const out = { store: null, local: null }
      try { out.store = await window.electronAPI.storeGet(${JSON.stringify(CF_KEY)}) } catch (e) { out.store = 'ERR ' + e }
      try { out.local = JSON.parse(localStorage.getItem(${JSON.stringify(CF_KEY)}) || 'null') } catch (e) { out.local = 'ERR ' + e }
      return out
    })()`)

  let seen = null
  // loadCloudflareConfig 是异步的，给它几轮机会把配置写坏
  for (let i = 0; i < 10; i++) {
    seen = await read()
    if (seen && seen.store && seen.store.enabled !== false) break
    await sleep(300)
  }

  const problems = []
  for (const pair of [['electron-store', seen && seen.store], ['localStorage', seen && seen.local]]) {
    const where = pair[0]
    const cfg = pair[1]
    if (!cfg || typeof cfg !== 'object') {
      if (where === 'localStorage') continue // profile 每轮全新，没写就是没写，不算问题
      problems.push(where + ' 里读不到 ' + CF_KEY)
      continue
    }
    if (cfg.enabled !== false) problems.push(where + ' 里 enabled = ' + JSON.stringify(cfg.enabled) + '（应为 false）')
    if (!cfg.workerUrl) problems.push(where + ' 里 workerUrl 为空')
    else if (String(cfg.workerUrl).includes(REAL_WORKER_HOST)) problems.push(where + ' 里 workerUrl 指向真实地址: ' + cfg.workerUrl)
    if (cfg.autoSync || cfg.autoSyncOnStartup) problems.push(where + ' 里 autoSync/autoSyncOnStartup 仍为真')
  }

  if (problems.length) {
    console.error('\n✗ 同步没有被真正关掉，立即终止（继续跑下去会写到用户真实的 Cloudflare KV）：')
    for (const p of problems) console.error('    · ' + p)
    console.error('  应用回读到的配置：' + JSON.stringify(seen))
    await stopApp()
    if (!keep) {
      try {
        fs.rmSync(USER_DATA, { recursive: true, force: true })
      } catch {}
    }
    process.exit(3)
  }
}

async function stopApp() {
  try {
    if (ws) ws.close()
  } catch {}
  ws = null
  const proc = child
  child = null
  if (!proc) return
  await new Promise((res) => {
    const done = setTimeout(res, 5000)
    proc.once('exit', () => {
      clearTimeout(done)
      res()
    })
    try {
      proc.kill()
    } catch {
      clearTimeout(done)
      res()
    }
  })
  pending = new Map()
}

function cleanup(code) {
  try {
    if (ws) ws.close()
  } catch {}
  try {
    if (child) child.kill()
  } catch {}
  if (!keep) {
    try {
      fs.rmSync(USER_DATA, { recursive: true, force: true })
    } catch {}
  }
  setTimeout(() => process.exit(code), 300)
}

/* ---------- 单个检查 ---------- */
async function runCheck(name) {
  const file = path.join(CHECK_DIR, name + '.js')
  const source = [
    '(async () => {',
    fs.readFileSync(HARNESS, 'utf8'),
    fs.readFileSync(file, 'utf8'),
    '})()',
  ].join('\n')

  const errorsBefore = pageErrors.length
  const res = await send('Runtime.evaluate', {
    expression: source,
    awaitPromise: true,
    returnByValue: true,
  })

  const result = res.result || {}
  if (result.exceptionDetails) {
    const d = result.exceptionDetails
    return {
      name,
      checks: [],
      notes: [],
      errors: ['脚本抛异常: ' + (d.exception && d.exception.description ? d.exception.description : d.text)],
    }
  }

  const value = result.result && result.result.value
  if (!value || !Array.isArray(value.checks)) {
    return { name, checks: [], notes: [], errors: ['检查脚本没有返回断言数组: ' + JSON.stringify(result).slice(0, 400)] }
  }
  return { name, checks: value.checks, notes: value.notes || [], errors: value.errors || [], pageErrors: pageErrors.slice(errorsBefore) }
}

/* ---------- 主流程 ---------- */
async function main() {
  requireBuild()
  const electron = resolveElectron()

  const names = only.length
    ? only
    : fs
        .readdirSync(CHECK_DIR)
        .filter((f) => f.endsWith('.js'))
        .map((f) => f.replace(/\.js$/, ''))
        .sort()

  const results = []
  for (const name of names) {
    console.log('\n▶ ' + name)
    // 每个检查都重启一次：笔记是落盘的，只有重启才真正回到夹具那个起点
    await startApp(electron)
    const r = await runCheck(name)
    results.push(r)
    for (const c of r.checks) {
      if (!c.ok || verbose) console.log('  ' + (c.ok ? '✓' : '✗') + ' ' + c.label + (!c.ok && c.detail ? '\n      ' + c.detail : ''))
    }
    for (const e of r.errors) console.log('  ✗ ' + e)
    for (const e of r.pageErrors || []) console.log('  ✗ ' + e)
    const failed = r.checks.filter((c) => !c.ok).length + r.errors.length + (r.pageErrors || []).length
    console.log('  通过 ' + (r.checks.length - r.checks.filter((c) => !c.ok).length) + ' / 失败 ' + failed)
    await stopApp()
  }

  const allNotes = results.flatMap((r) => r.notes)
  if (allNotes.length) {
    console.log('\n环境快照')
    for (const n of allNotes) console.log('  ' + n)
  }

  const total = results.reduce((s, r) => s + r.checks.length, 0)
  const failed = results.reduce(
    (s, r) => s + r.checks.filter((c) => !c.ok).length + r.errors.length + (r.pageErrors || []).length,
    0
  )
  console.log('\n合计：' + names.length + ' 个检查，' + total + ' 条断言，失败 ' + failed + ' 条')

  if (failed) {
    console.log('\n--- 主进程输出 ---')
    console.log(appLog.slice(-40).join('\n') || '(无)')
  }
  cleanup(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('驱动失败: ' + (e && e.stack ? e.stack : String(e)))
  cleanup(2)
})
