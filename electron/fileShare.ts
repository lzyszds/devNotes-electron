import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import type { AddressInfo } from 'net'

export interface FileShareItem {
  id: string
  name: string
  path: string
  size: number
  addedAt: number
  /** 局域网下载地址；本机没有可用的 IPv4 网卡时为 null */
  url: string | null
}

interface SharedFile {
  id: string
  name: string
  path: string
  size: number
  addedAt: number
}

const CONTENT_TYPES: Record<string, string> = {
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
}

const files = new Map<string, SharedFile>()
let server: http.Server | null = null
let port = 0

function isPrivateIPv4(ip: string) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
}

/** 优先取内网段地址，避开 VPN / 虚拟网卡之类的 */
function getLanAddress(): string | null {
  const candidates: string[] = []
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) candidates.push(info.address)
    }
  }
  return candidates.find(isPrivateIPv4) ?? candidates[0] ?? null
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end()
    return
  }

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const match = /^\/f\/([a-f0-9]{24})\//.exec(pathname)
  const file = match ? files.get(match[1]) : undefined
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found')
    return
  }

  fs.stat(file.path, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('File Not Found')
      return
    }

    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file.name).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    const stream = fs.createReadStream(file.path)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  })
}

function ensureServer(): Promise<void> {
  if (server) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const next = http.createServer(handleRequest)
    next.once('error', reject)
    next.listen(0, '0.0.0.0', () => {
      server = next
      port = (next.address() as AddressInfo).port
      resolve()
    })
  })
}

function stopServer() {
  if (!server) return
  server.close()
  server.closeAllConnections()
  server = null
  port = 0
}

function toItem(file: SharedFile): FileShareItem {
  const lan = getLanAddress()
  const url = lan && server
    ? `http://${lan}:${port}/f/${file.id}/${encodeURIComponent(file.name)}`
    : null
  return { ...file, url }
}

export function listSharedFiles(): FileShareItem[] {
  return Array.from(files.values()).sort((a, b) => b.addedAt - a.addedAt).map(toItem)
}

export async function shareFile(filePath: string): Promise<FileShareItem[]> {
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile()) throw new Error('所选路径不是文件')

  await ensureServer()
  const id = crypto.randomBytes(12).toString('hex')
  files.set(id, {
    id,
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    addedAt: Date.now(),
  })
  return listSharedFiles()
}

export function unshareFile(id: string): FileShareItem[] {
  files.delete(id)
  // 没有任何文件在分享时就关掉端口，别一直对局域网开着
  if (files.size === 0) stopServer()
  return listSharedFiles()
}

export function stopFileShare() {
  files.clear()
  stopServer()
}
