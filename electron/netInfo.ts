import https from 'https'
import os from 'os'
import { fetchViaNet } from './proxy'

/*
 * 本机网络信息：网卡地址（读系统接口，不联网）与公网出口 IP（需要请求外部服务）。
 * 公网 IP 分两种：直连走 Node 的 https，不经过应用代理；代理则复用 session 的代理配置。
 */

export type InterfaceKind = 'wifi' | 'ethernet' | 'virtual'

export interface LocalInterface {
  name: string
  kind: InterfaceKind
  address: string
  netmask: string
  cidr: string
  mac: string
}

const VIRTUAL_RE =
  /utun|tun|tap|vmnet|vmware|vboxnet|docker|br-|bridge|veth|virbr|vethernet|hyper-v|tailscale|zerotier|wg\d|bond|awdl|llw|anpi|lo\d?$/i
const WIFI_RE = /wi-?fi|wlan|wireless|无线/i

function classify(name: string): InterfaceKind {
  if (VIRTUAL_RE.test(name)) return 'virtual'
  // macOS 上 en0 通常是 Wi-Fi，其他 en 口多为以太网或雷雳网卡
  if (WIFI_RE.test(name) || name === 'en0') return 'wifi'
  return 'ethernet'
}

/** 子网掩码 → CIDR 位数，如 255.255.255.0 → 24 */
function maskToPrefix(mask: string): number {
  return mask
    .split('.')
    .map((part) => Number(part).toString(2).padStart(8, '0'))
    .join('')
    .split('')
    .filter((bit) => bit === '1').length
}

export function listLocalInterfaces(): LocalInterface[] {
  const result: LocalInterface[] = []
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      result.push({
        name,
        kind: classify(name),
        address: info.address,
        netmask: info.netmask,
        cidr: `${info.address}/${maskToPrefix(info.netmask)}`,
        mac: info.mac,
      })
    }
  }
  // 物理网卡排前面，虚拟网卡沉到后面
  const order: Record<InterfaceKind, number> = { wifi: 0, ethernet: 1, virtual: 2 }
  return result.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
}

const IP_SERVICES = ['https://api.ipify.org?format=json', 'https://api64.ipify.org?format=json']
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6_RE = /^[0-9a-fA-F:]+$/

function parseIp(text: string): string | null {
  const trimmed = text.trim()
  try {
    const json = JSON.parse(trimmed) as { ip?: unknown }
    if (typeof json.ip === 'string') return json.ip
  } catch {
    // 不是 JSON 就当纯文本处理
  }
  if (IPV4_RE.test(trimmed) || (IPV6_RE.test(trimmed) && trimmed.includes(':'))) return trimmed
  return null
}

function fetchDirect(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'devNotes' } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () => (res.statusCode && res.statusCode < 300 ? resolve(body) : reject(new Error(`HTTP ${res.statusCode}`))))
    })
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
  })
}

export interface PublicIpResult {
  ok: boolean
  ip: string | null
  via: string | null
  error?: string
}

/**
 * 查询公网出口 IP。mode 为 direct 时不走应用代理，proxy 时走应用当前的代理设置。
 * 依次尝试多个服务，任一成功即返回。
 */
export async function queryPublicIp(mode: 'direct' | 'proxy'): Promise<PublicIpResult> {
  let lastError = '查询失败'
  for (const url of IP_SERVICES) {
    try {
      const text =
        mode === 'proxy'
          ? (await fetchViaNet({ url, timeout: 6000 })).text
          : await fetchDirect(url, 6000)
      const ip = parseIp(text)
      if (ip) return { ok: true, ip, via: url }
      lastError = '服务返回的内容无法识别'
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  return { ok: false, ip: null, via: null, error: lastError }
}
