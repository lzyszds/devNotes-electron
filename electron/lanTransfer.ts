import { app, clipboard, ClipboardItem, nativeImage, shell } from 'electron'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { LAN_TRANSFER_PAGE } from './lanTransferPage'

/*
 * 局域网中转台：一个二维码，手机扫一次就能双向传。
 * - 手机 → 电脑：图片、文件、文字。文件落到应用数据目录，图片 / 文字可以自动复制到剪贴板。
 * - 电脑 → 手机：电脑添加的文件和文字，手机页面上列出来点击下载或复制。
 * 服务只在工具打开期间运行；每次开启换新令牌，关闭时清空发出去的列表。
 */

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const MAX_TEXT_CHARS = 100_000

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
}

export type InboxEntry =
  | { kind: 'file'; id: string; name: string; size: number; mime: string; receivedAt: number }
  | { kind: 'text'; id: string; text: string; receivedAt: number }

export type OutboxEntry =
  | { kind: 'file'; id: string; name: string; size: number; path: string; addedAt: number }
  | { kind: 'text'; id: string; text: string; addedAt: number }

export interface LanStatus {
  running: boolean
  url: string | null
}

export type InboxEvent = { entry: InboxEntry }

const dataDir = () => path.join(app.getPath('userData'), 'lan-transfer')
const filesDir = () => {
  const dir = path.join(dataDir(), 'files')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
const indexFile = () => path.join(dataDir(), 'inbox.json')

let inbox: InboxEntry[] = []
let inboxLoaded = false
let outbox: OutboxEntry[] = []
let server: http.Server | null = null
let port = 0
let token = ''
let autoCopy = true
let onInbox: ((event: InboxEvent) => void) | null = null

function loadInbox() {
  if (inboxLoaded) return
  inboxLoaded = true
  try {
    const parsed = JSON.parse(fs.readFileSync(indexFile(), 'utf8')) as InboxEntry[]
    if (Array.isArray(parsed)) inbox = parsed
  } catch {
    inbox = []
  }
}

function saveInbox() {
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(indexFile(), JSON.stringify(inbox))
}

function newId() {
  return crypto.randomBytes(8).toString('hex')
}

/** 只认纯文件名，防止通过 IPC 传 ../ 之类的路径 */
function safeName(name: string) {
  return path.basename(name) === name && !name.startsWith('.') ? name : null
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('内容太长'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function receiveFile(req: http.IncomingMessage, res: http.ServerResponse) {
  const mime = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim().toLowerCase()
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > MAX_UPLOAD_BYTES) {
    sendJson(res, 413, { ok: false, error: '文件超过 200 MB' })
    req.resume()
    return
  }

  const rawName = decodeURIComponent(String(req.headers['x-filename'] ?? 'file'))
  const origExt = path.extname(rawName).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '')
  const ext = EXT_BY_MIME[mime] ?? (origExt || 'bin')
  const id = newId()
  const storedName = `${id}.${ext}`
  const target = path.join(filesDir(), storedName)
  const tmp = `${target}.part`

  let written = 0
  let aborted = false
  const out = fs.createWriteStream(tmp)

  const fail = (status: number, error: string) => {
    if (aborted) return
    aborted = true
    req.unpipe(out)
    req.resume()
    out.destroy()
    fs.rm(tmp, { force: true }, () => {})
    sendJson(res, status, { ok: false, error })
  }

  req.on('data', (chunk: Buffer) => {
    written += chunk.length
    if (written > MAX_UPLOAD_BYTES) fail(413, '文件超过 200 MB')
  })
  req.on('error', () => fail(400, '上传中断'))
  req.pipe(out)
  out.on('error', () => fail(500, '写入电脑失败'))
  out.on('finish', () => {
    if (aborted) return
    fs.rename(tmp, target, (err) => {
      if (err) return fail(500, '保存失败')
      const entry: InboxEntry = { kind: 'file', id, name: rawName || storedName, size: written, mime, receivedAt: Date.now() }
      inbox = [entry, ...inbox]
      saveInbox()
      if (autoCopy && mime.startsWith('image/')) void copyImageFile(target).catch(() => {})
      onInbox?.({ entry })
      sendJson(res, 200, { ok: true, id })
    })
  })
}

async function receiveText(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = await readBody(req, MAX_TEXT_CHARS * 4)
    const text = String((JSON.parse(body) as { text?: unknown }).text ?? '')
    if (!text.trim()) return sendJson(res, 400, { ok: false, error: '内容为空' })
    if (text.length > MAX_TEXT_CHARS) return sendJson(res, 413, { ok: false, error: '文字太长' })
    const entry: InboxEntry = { kind: 'text', id: newId(), text, receivedAt: Date.now() }
    inbox = [entry, ...inbox]
    saveInbox()
    if (autoCopy) void clipboard.writeText(text)
    onInbox?.({ entry })
    sendJson(res, 200, { ok: true, id: entry.id })
  } catch {
    sendJson(res, 400, { ok: false, error: '发送失败' })
  }
}

function sendDownload(id: string, res: http.ServerResponse, method: string) {
  const item = outbox.find((entry) => entry.id === id && entry.kind === 'file')
  if (!item || item.kind !== 'file') return notFound(res)
  fs.stat(item.path, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res)
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    if (method === 'HEAD') return res.end()
    const stream = fs.createReadStream(item.path)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  })
}

function notFound(res: http.ServerResponse) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found')
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '')
  const base = `/u/${token}`
  if (!token || !pathname.startsWith(base)) return notFound(res)
  const rest = pathname.slice(base.length)
  if (rest !== '' && !rest.startsWith('/')) return notFound(res)

  if (req.method === 'GET' && rest === '') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(LAN_TRANSFER_PAGE)
    return
  }
  if (req.method === 'GET' && rest === '/state') {
    sendJson(res, 200, {
      outbox: outbox.map((item) =>
        item.kind === 'file'
          ? { kind: 'file', id: item.id, name: item.name, size: item.size }
          : { kind: 'text', id: item.id, text: item.text },
      ),
    })
    return
  }
  if (req.method === 'POST' && rest === '/upload') return receiveFile(req, res)
  if (req.method === 'POST' && rest === '/text') return void receiveText(req, res)
  const download = /^\/download\/([a-f0-9]{16})$/.exec(rest)
  if (download && (req.method === 'GET' || req.method === 'HEAD')) return sendDownload(download[1], res, req.method)
  notFound(res)
}

/* ---------------- 剪贴板 ---------------- */

async function copyImageFile(filePath: string): Promise<boolean> {
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) return false
  const blob = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' })
  await clipboard.write([new ClipboardItem({ 'image/png': blob })])
  return true
}

/* ---------------- 服务生命周期 ---------------- */

function getLanAddress(): string | null {
  const candidates: string[] = []
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) candidates.push(info.address)
    }
  }
  const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
  return candidates.find(isPrivate) ?? candidates[0] ?? null
}

/** 开启服务。每次开启换一个新令牌，旧二维码立即失效 */
export function startLanTransfer(): Promise<LanStatus> {
  loadInbox()
  if (server) return Promise.resolve(status())
  token = crypto.randomBytes(16).toString('hex')
  return new Promise((resolve, reject) => {
    const next = http.createServer(handleRequest)
    next.once('error', reject)
    next.listen(0, '0.0.0.0', () => {
      server = next
      port = (next.address() as AddressInfo).port
      resolve(status())
    })
  })
}

/** 停止服务，并清空电脑发出去的列表（它只属于这一次会话） */
export function stopLanTransfer() {
  outbox = []
  if (!server) return
  server.close()
  server.closeAllConnections()
  server = null
  port = 0
  token = ''
}

export function status(): LanStatus {
  const lan = getLanAddress()
  return { running: !!server, url: server && lan ? `http://${lan}:${port}/u/${token}` : null }
}

export function setAutoCopy(on: boolean) {
  autoCopy = on
}

export function setInboxListener(listener: (event: InboxEvent) => void) {
  onInbox = listener
}

/* ---------------- 收件箱（手机 → 电脑） ---------------- */

export function listInbox(): InboxEntry[] {
  loadInbox()
  return inbox
}

export function readInboxThumb(id: string): string | null {
  const entry = inbox.find((item) => item.id === id && item.kind === 'file')
  if (!entry || entry.kind !== 'file' || !entry.mime.startsWith('image/')) return null
  const file = findStoredFile(id)
  if (!file) return null
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return null
  return image.resize({ width: 160, quality: 'good' }).toDataURL()
}

function findStoredFile(id: string): string | null {
  const dir = filesDir()
  const match = fs.readdirSync(dir).find((name) => name.startsWith(`${id}.`) && !name.endsWith('.part'))
  return match ? path.join(dir, match) : null
}

export async function copyInboxItem(id: string): Promise<boolean> {
  const entry = inbox.find((item) => item.id === id)
  if (!entry) return false
  if (entry.kind === 'text') {
    await clipboard.writeText(entry.text)
    return true
  }
  const file = findStoredFile(id)
  if (!file || !entry.mime.startsWith('image/')) return false
  return copyImageFile(file).catch(() => false)
}

export function revealInboxItem(id: string) {
  const file = findStoredFile(id)
  if (file) shell.showItemInFolder(file)
}

export function deleteInboxItem(id: string): boolean {
  const entry = inbox.find((item) => item.id === id)
  if (!entry) return false
  if (entry.kind === 'file') {
    const file = findStoredFile(id)
    if (file) fs.rmSync(file, { force: true })
  }
  inbox = inbox.filter((item) => item.id !== id)
  saveInbox()
  return true
}

export function clearInbox() {
  for (const entry of inbox) {
    if (entry.kind === 'file') {
      const file = findStoredFile(entry.id)
      if (file) fs.rmSync(file, { force: true })
    }
  }
  inbox = []
  saveInbox()
}

/* ---------------- 发件箱（电脑 → 手机） ---------------- */

export function listOutbox(): OutboxEntry[] {
  return outbox
}

export function addOutboxFiles(paths: string[]): OutboxEntry[] {
  const now = Date.now()
  for (const filePath of paths) {
    if (typeof filePath !== 'string' || !filePath) continue
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) continue
      outbox = [{ kind: 'file', id: newId(), name: path.basename(filePath), size: stat.size, path: filePath, addedAt: now }, ...outbox]
    } catch {
      // 文件已经不在了，跳过
    }
  }
  return outbox
}

export function addOutboxText(text: string): OutboxEntry[] {
  const value = String(text ?? '')
  if (!value.trim()) return outbox
  outbox = [{ kind: 'text', id: newId(), text: value.slice(0, MAX_TEXT_CHARS), addedAt: Date.now() }, ...outbox]
  return outbox
}

export function removeOutbox(id: string): OutboxEntry[] {
  outbox = outbox.filter((item) => item.id !== id)
  return outbox
}

export function clearOutbox(): OutboxEntry[] {
  outbox = []
  return outbox
}
