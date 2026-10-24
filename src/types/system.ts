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
