import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

export interface SystemHardwareInfo {
  platform: string
  platformName: string
  arch: string
  osRelease: string
  hostname: string
  cpuModel: string
  cpuCores: number
  cpuSpeedMhz: number
  totalMemBytes: number
  freeMemBytes: number
  usedMemBytes: number
  memUsagePercent: number
  uptimeSeconds: number
}

export interface AppProcessMemory {
  name: string
  displayName: string
  pids: number[]
  rssBytes: number
  memPercent: number
  isCurrentApp: boolean
}

/** 友好化系统平台名称 */
function getPlatformName(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

/** 获取硬件与系统基础配置概览 */
export function getSystemHardwareInfo(): SystemHardwareInfo {
  const total = os.totalmem()
  const free = os.freemem()
  const used = Math.max(0, total - free)
  const cpus = os.cpus() || []
  const firstCpu = cpus[0] || { model: 'Unknown CPU', speed: 0 }

  return {
    platform: os.platform(),
    platformName: getPlatformName(os.platform()),
    arch: os.arch(),
    osRelease: os.release(),
    hostname: os.hostname(),
    cpuModel: firstCpu.model.trim(),
    cpuCores: cpus.length,
    cpuSpeedMhz: firstCpu.speed,
    totalMemBytes: total,
    freeMemBytes: free,
    usedMemBytes: used,
    memUsagePercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    uptimeSeconds: os.uptime(),
  }
}

/**
 * 获取当前所有应用进程的内存占用列表（按内存占用降序排列）
 */
export async function getProcessMemoryList(): Promise<AppProcessMemory[]> {
  const platform = os.platform()
  const totalMem = os.totalmem()
  const currentPid = process.pid

  if (platform === 'darwin' || platform === 'linux') {
    try {
      // ps -axo pid,rss,comm
      // rss 为常驻物理内存大小 (单位 KB)
      const { stdout } = await run('ps', ['-axo', 'pid,rss,comm'])
      const lines = stdout.split('\n').slice(1) // 去掉表头

      const appMap = new Map<string, { pids: number[]; rssBytes: number; isCurrentApp: boolean }>()

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/)
        if (!match) continue

        const pid = parseInt(match[1], 10)
        const rssKb = parseInt(match[2], 10)
        const fullPath = match[3]

        if (isNaN(pid) || isNaN(rssKb) || rssKb <= 0) continue

        // 提取友好的应用名
        let name = fullPath
        if (platform === 'darwin') {
          // 尝试从 .app 目录提取应用名称，如 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
          const appMatch = fullPath.match(/([^/]+)\.app\//)
          if (appMatch) {
            name = appMatch[1]
          } else {
            name = fullPath.split('/').pop() || fullPath
          }
        } else {
          name = fullPath.split('/').pop() || fullPath
        }

        const rssBytes = rssKb * 1024
        const isCurrent = pid === currentPid

        const existing = appMap.get(name)
        if (existing) {
          existing.pids.push(pid)
          existing.rssBytes += rssBytes
          if (isCurrent) existing.isCurrentApp = true
        } else {
          appMap.set(name, {
            pids: [pid],
            rssBytes,
            isCurrentApp: isCurrent,
          })
        }
      }

      const results: AppProcessMemory[] = []
      for (const [name, data] of appMap.entries()) {
        results.push({
          name,
          displayName: name,
          pids: data.pids,
          rssBytes: data.rssBytes,
          memPercent: totalMem > 0 ? Math.round((data.rssBytes / totalMem) * 1000) / 10 : 0,
          isCurrentApp: data.isCurrentApp,
        })
      }

      // 按内存占用倒序排列
      results.sort((a, b) => b.rssBytes - a.rssBytes)
      return results.slice(0, 50) // 取前 50 个高占用应用/进程
    } catch (err) {
      console.error('获取 macOS/Linux 进程内存失败:', err)
      return []
    }
  } else if (platform === 'win32') {
    try {
      // Windows 使用 tasklist /fo csv /nh
      const { stdout } = await run('tasklist', ['/fo', 'csv', '/nh'])
      const lines = stdout.split('\r\n')
      const appMap = new Map<string, { pids: number[]; rssBytes: number; isCurrentApp: boolean }>()

      for (const line of lines) {
        if (!line.trim()) continue
        // CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
        // 例如: "chrome.exe","1234","Console","1","123,456 K"
        const parts = line.split('","').map((p) => p.replace(/"/g, ''))
        if (parts.length < 5) continue

        const name = parts[0]
        const pid = parseInt(parts[1], 10)
        const memStr = parts[4].replace(/[^\d]/g, '')
        const memKb = parseInt(memStr, 10)

        if (isNaN(pid) || isNaN(memKb) || memKb <= 0) continue
        const rssBytes = memKb * 1024
        const isCurrent = pid === currentPid

        const existing = appMap.get(name)
        if (existing) {
          existing.pids.push(pid)
          existing.rssBytes += rssBytes
          if (isCurrent) existing.isCurrentApp = true
        } else {
          appMap.set(name, {
            pids: [pid],
            rssBytes,
            isCurrentApp: isCurrent,
          })
        }
      }

      const results: AppProcessMemory[] = []
      for (const [name, data] of appMap.entries()) {
        results.push({
          name,
          displayName: name.replace(/\.exe$/i, ''),
          pids: data.pids,
          rssBytes: data.rssBytes,
          memPercent: totalMem > 0 ? Math.round((data.rssBytes / totalMem) * 1000) / 10 : 0,
          isCurrentApp: data.isCurrentApp,
        })
      }

      results.sort((a, b) => b.rssBytes - a.rssBytes)
      return results.slice(0, 50)
    } catch (err) {
      console.error('获取 Windows 进程内存失败:', err)
      return []
    }
  }

  return []
}
