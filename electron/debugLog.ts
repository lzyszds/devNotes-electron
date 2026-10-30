/**
 * 统一的本地日志落盘。
 *
 * 为什么要有这个：排查「截图有时能用、有时要等很久」这类竞态问题时，靠用户
 * 手动复制控制台既慢又容易漏（崩溃、重载、切窗口时日志就没了）。这里把渲染层
 * 和主进程的日志都写进同一个文件，排查时直接读文件即可：
 *
 *   macOS:  ~/Library/Application Support/devNotes/logs/dn-debug.log
 *
 * 只在开发构建（!app.isPackaged）下写文件，正式版不产生额外磁盘 IO —— 但
 * 页面内 console 照常输出，两者内容一致。
 *
 * 文件按启动轮次分隔（每次启动写一行 LIKE ---- 分隔线 + 时间），
 * 超过 2MB 自动轮转成 .1，避免长期开发把磁盘写满。
 */

import fs from 'fs'
import path from 'path'

let logFilePath: string | null = null
let mainConsolePatched = false

const MAX_BYTES = 2 * 1024 * 1024

/** 由 main.ts 在 ready 之后调用一次，把当前 userData 目录定下来 */
export function initDebugLog(userDataDir: string): void {
  try {
    const dir = path.join(userDataDir, 'logs')
    fs.mkdirSync(dir, { recursive: true })
    logFilePath = path.join(dir, 'dn-debug.log')
    // 超过上限就轮转一次：只留上一轮，够排查用
    try {
      const stat = fs.statSync(logFilePath)
      if (stat.size > MAX_BYTES) fs.renameSync(logFilePath, `${logFilePath}.1`)
    } catch {
      // 文件不存在是正常的
    }
    write(`\n===== 应用启动 ${new Date().toISOString()} =====\n`)
  } catch (error) {
    // 日志系统自身不能把应用弄挂
    console.warn('[debugLog] 初始化失败', error)
  }
}

function write(line: string): void {
  if (!logFilePath) return
  try {
    fs.appendFileSync(logFilePath, line)
  } catch {
    // 忽略：日志失败不影响功能
  }
}

/** 主进程侧记录一行（带 [main] 前缀，便于和渲染层区分） */
export function mainLog(...args: unknown[]): void {
  const text = args
    .map((arg) => (typeof arg === 'string' ? arg : safeJson(arg)))
    .join(' ')
  write(`${new Date().toISOString()} [main] ${text}\n`)
  console.log(text)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 给渲染层开一个写日志的 IPC 通道。
 *
 * 渲染层自己写不了文件（contextIsolation 下没有 fs），走这条通道；
 * 用 send 而不是 invoke：日志是高频、即发即忘的，不需要回执。
 */
export function registerRendererLogIpc(ipcMain: Electron.IpcMain, isPackaged: boolean): void {
  if (mainConsolePatched) return
  mainConsolePatched = true

  ipcMain.on('debug-log', (_event, line: string) => {
    if (typeof line !== 'string') return
    write(line.endsWith('\n') ? line : `${line}\n`)
  })

  // 把主进程里散落的 console.log 也收进同一个文件，避免两处各写一份口径不一
  if (!isPackaged) {
    const original = console.log.bind(console)
    console.log = (...args: unknown[]) => {
      original(...args)
      if (!logFilePath) return
      const text = args
        .map((arg) => (typeof arg === 'string' ? arg : safeJson(arg)))
        .join(' ')
      // 已经由 mainLog 写过的不重复落盘
      if (text.startsWith('[capture]') || text.startsWith('[lightOcr]')) return
      write(`${new Date().toISOString()} [main:console] ${text}\n`)
    }
  }
}
