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
  /** 真空闲。macOS 上几乎恒为零（空闲页全被文件缓存/压缩池借走），只当诊断数据 */
  freeMemBytes: number
  /** 可用内存 = 真空闲 + 可随时回收的文件缓存。判断「还装不装得下」看它 */
  availableMemBytes: number
  usedMemBytes: number
  /** used = total - available，macOS 上与活动监视器「内存已使用」口径一致 */
  memUsagePercent: number
  /** 内核内存压力等级（仅 macOS，1=正常 2=警告 ≥3=临界），系统紧张的最终裁判 */
  memoryPressureLevel?: number
  /** 以下细分仅 macOS 有值（活动监视器口径） */
  wiredBytes?: number
  appActiveBytes?: number
  compressedBytes?: number
  cachedFilesBytes?: number
  swapUsedBytes?: number
  /** 是否支持「释放内存」动作（当前仅 macOS：/usr/sbin/purge） */
  memoryReleaseSupported?: boolean
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
