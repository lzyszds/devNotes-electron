/*
 * 剪贴板图片的文件态存储（图片文件 + 缩略图文件 + 自定义协议提供器）。
 *
 * 为什么不能把 base64 继续存在 clipboard-history JSON 里：
 * 截图动辄几百 KB、高清图几 MB，打包进 JSON 后历史库迅速膨胀到几十 MB，
 * 每次高频写入都要全量序列化/克隆它，面板一开就卡 —— 实测该 key 曾膨胀到 74MB。
 *
 * 现在的结构：
 *  - 原图：userData/clipboard-images/<id>.png（只在粘贴/复制时按需读)
 *  - 缩略图：userData/clipboard-thumbs/<id>.png（面板 <img> 通过 dnclip:// 直接加载)
 *  - JSON 里只留 imageId 指针 + 原始字节数，单条恒定 ~100 字节
 *
 * `dnclip://` 协议让缩略图不经过任何 IPC/JSON —— <img src="dnclip://thumb/<id>">
 * 由主进程直接回文件字节，面板滚动多快都不产生数据搬运。
 *
 * 粘贴能力不变：粘贴时主进程读原图文件 → base64 → 走既有 pasteImageToFocusedApp，
 * 「贴出 base64」链路完好，只是数据不再常驻 JSON。
 */

import { app, nativeImage, protocol } from 'electron'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import type { ClipboardEntry } from './clipboardHistory'

const IMAGES_DIR = 'clipboard-images'
const THUMBS_DIR = 'clipboard-thumbs'
/** 缩略图宽。面板行高固定 41px 内的 36px 方块，96px 足够清晰且字节可控 */
const THUMB_WIDTH = 96
/** 落盘原图的单文件 sanity 上限，防极端情况把磁盘写爆（曾经内存态是 2MB 上限） */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024

export const CLIP_PROTOCOL_SCHEME = 'dnclip'

const imagesDir = () => path.join(app.getPath('userData'), IMAGES_DIR)
const thumbsDir = () => path.join(app.getPath('userData'), THUMBS_DIR)

const imageFile = (id: string) => path.join(imagesDir(), `${id}.png`)
const thumbFile = (id: string) => path.join(thumbsDir(), `${id}.png`)

/** entry id 由本模块自己生成，但仍按防御性校验防路径注入 */
function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`非法剪贴板图片 id: ${id}`)
  }
}

function ensureDirs(): void {
  fs.mkdirSync(imagesDir(), { recursive: true })
  fs.mkdirSync(thumbsDir(), { recursive: true })
}

/** 原子写：临时文件 + rename，写一半崩溃不会留下半个 PNG */
async function atomicWrite(file: string, buffer: Buffer): Promise<void> {
  const tmp = `${file}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await fsPromises.writeFile(tmp, buffer)
  await fsPromises.rename(tmp, file)
}

/**
 * 把带 inline base64 的图片条目落盘为文件态条目。
 *
 * 返回新 entry（imageId 指针 + 字节数，imageDataUrl 摘除）。失败时原样返回，
 * 调用方继续用 inline 数据兜底，宁可内存贵一点也不能把图片弄丢。
 */
export async function saveImageEntryToDisk(entry: ClipboardEntry): Promise<ClipboardEntry> {
  const dataUrl = entry.imageDataUrl
  if (!dataUrl || entry.imageId) return entry

  const base64 = dataUrl.split(',')[1] ?? ''
  const png = Buffer.from(base64, 'base64')
  if (png.length === 0 || png.length > MAX_IMAGE_BYTES) return entry

  assertSafeId(entry.id)
  ensureDirs()

  await atomicWrite(imageFile(entry.id), png)

  // 缩略图失败不致命：面板展示降级为「图片」文本占位，原图与粘贴不受影响
  let thumbOk = false
  try {
    const image = nativeImage.createFromBuffer(png)
    if (!image.isEmpty()) {
      const thumb = image.resize({ width: THUMB_WIDTH })
      if (!thumb.isEmpty()) {
        await atomicWrite(thumbFile(entry.id), thumb.toPNG())
        thumbOk = true
      }
    }
  } catch {
    // 忽略，走降级
  }

  return {
    ...entry,
    imageId: thumbOk ? entry.id : undefined,
    imageBytes: png.length,
    imageDataUrl: undefined,
  }
}

/** 读原图回 base64 dataURL（粘贴/复制链路用） */
export async function loadImageDataUrl(imageId: string): Promise<string | null> {
  assertSafeId(imageId)
  try {
    const png = await fsPromises.readFile(imageFile(imageId))
    if (png.length === 0) return null
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

/** 删除一张图片的原图与缩略图（条目被删除/清空/淘汰时调用） */
export function deleteImageFiles(imageId: string): void {
  try {
    assertSafeId(imageId)
  } catch {
    return
  }
  void fsPromises.unlink(imageFile(imageId)).catch(() => {})
  void fsPromises.unlink(thumbFile(imageId)).catch(() => {})
}

/**
 * 孤儿清理：磁盘上存在、但历史里没有对应条目的图片文件。
 * 历史上没有清理机制，删条目只删 JSON —— 文件残留只能在这里兜底。
 * 在迁移完成后跑一次即可，不去追求实时精确。
 */
export function removeOrphanImageFiles(list: ClipboardEntry[]): void {
  const referenced = new Set(
    list
      .filter((entry) => entry.imageId)
      .map((entry) => entry.imageId as string)
  )
  for (const dir of [imagesDir(), thumbsDir()]) {
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.png')) continue
      const id = name.slice(0, -4)
      if (!referenced.has(id)) {
        void fsPromises.unlink(path.join(dir, name)).catch(() => {})
      }
    }
  }
}

/**
 * 注册 dnclip 协议**必须在 app ready 之前**（Electron 硬性要求 privileged
 * scheme 在 ready 前登记），由 main.ts 模块顶层调用。
 */
export function registerClipProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CLIP_PROTOCOL_SCHEME,
      privileges: {
        stream: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ])
}

/** app ready 后安装协议处理器。只回本模块 Metals 目录内的文件，杜绝越权读文件 */
export function installClipProtocolHandler(): void {
  const resolveFileFor = (url: URL): string | null => {
    // dnclip://thumb/<id> 与 dnclip://image/<id>
    const kind = url.hostname
    const id = url.pathname.length > 1 ? url.pathname.slice(1) : ''
    if (kind !== 'thumb' && kind !== 'image') return null
    try {
      assertSafeId(id)
    } catch {
      return null
    }
    return kind === 'thumb' ? thumbFile(id) : imageFile(id)
  }

  protocol.handle(CLIP_PROTOCOL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const file = resolveFileFor(url)
      if (!file) {
        return new Response('bad request', { status: 400 })
      }
      const png = await fsPromises.readFile(file)
      return new Response(new Uint8Array(png), {
        headers: { 'content-type': 'image/png' },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
