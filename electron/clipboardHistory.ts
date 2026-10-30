/*
 * 剪贴板历史采集。
 *
 * 为什么不走事件：Electron 在 macOS 上没有剪贴板变化事件，只能轮询读。
 * 系统剪贴板是一次只能读一份的全局资源，多读几次没有额外代价。
 *
 * 全部存本地，绝不进云同步白名单。所有内容原样保留，不做任何过滤
 * （用户明确要求：密钥、Token 之类也照存）。
 */

import { clipboard, nativeImage } from 'electron'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'

export interface ClipboardEntry {
  id: string
  /** 'text' 文本，'image' 图片，'file' 文件 */
  type: 'text' | 'image' | 'file'
  /** type='text' 时的正文。超长的会截断，见 MAX_TEXT_LENGTH */
  text?: string
  /*
   * type='image' 时的 PNG dataURL —— 仅作为「采集 → 落盘」之间的内存传输通道。
   * 落盘后即被摘除（见 clipboardImages.saveImageEntryToDisk），持久化的 History
   * JSON 里图片只有 imageId 指针。历史上它曾随 entry 直接入库，是历史库膨胀到
   * 74MB + 每次复制全量重写 110MB config 的直接原因。
   */
  imageDataUrl?: string
  /** type='image' 时磁盘上的原图文件指针（clipboard-images/<imageId>.png） */
  imageId?: string
  /** type='image' 时原图字节数（展示尺寸时可直接用，不用解码 PNG） */
  imageBytes?: number
  /** type='file' 时的绝对路径。只记路径引用，文件被移动/删除后即失效 */
  filePath?: string
  /** 采集时刻 */
  at: number
  /** 文本原文是否被截断 */
  truncated?: boolean
}

/** 文本单条上限。再长的多半是整篇文档，存进去既占地方又没检索价值 */
const MAX_TEXT_LENGTH = 2000

/**
 * 图片单条上限（PNG 字节数）。图片已改为独立文件存储，JSON 里只有指针，
 * 这里的上限从旧的 2MB 提到 12MB：拦截的是「某次复制塞进来一张离谱大图」，
 * 正常截图（包括 3x Retina）都能入库，而旧版本这种图直接被丢弃。
 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

/**
 * 保留条数上限。
 *
 * 曾经设「接近无限」的 10000 条，那是图片走 JSON 的时代为「能留下来就算赢」
 * 定的；现在图片已外置成文件，限制变成 JSON 体积本身 —— 每条文本最多 2KB
 * （MAX_TEXT_LENGTH），10000 条 ≈ 20MB 的历史 JSON，读写都要全量序列化。
 * 3000 条（按每条 ~1KB 实际均量约 3MB）对「翻一个月前的复制记录」仍然绰绰
 * 有余，超出部分被淘汰时图片文件会连同清理（见 appendClipboardEntry）。
 */
export const MAX_ENTRIES = 3000

/**
 * 采集一条。
 *
 * 去重策略是「和最近一条相同就跳过」，不是全局去重：同一段文本隔了很久
 * 再复制一次，用户多半正需要它重新出现在最上面。
 */
export function shouldCapture(
  text: unknown,
  latest: ClipboardEntry | undefined
): boolean {
  // 入参类型放宽到 unknown：这个函数在定时器回调链上，一旦收到非字符串，
  // 抛异常会一路冒到主进程未捕获异常。宁可在这里静默跳过一条。
  if (typeof text !== 'string') return false
  if (!text.trim()) return false
  if (latest && latest.text === text) return false
  return true
}

/** 造一条文本记录。超长截断，并标记出来 */
export function buildEntry(text: string): ClipboardEntry {
  const truncated = text.length > MAX_TEXT_LENGTH
  return {
    id: `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'text',
    text: truncated ? text.slice(0, MAX_TEXT_LENGTH) : text,
    at: Date.now(),
    truncated: truncated || undefined,
  }
}

/** 造一条图片记录。imageDataUrl 只是内存传输，落盘由 main 侧转换（见 clipboardImages） */
export function buildImageEntry(imageDataUrl: string): ClipboardEntry {
  return {
    id: `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'image',
    imageDataUrl,
    at: Date.now(),
  }
}

/** 字节指纹，给「同一张图反复在剪贴板」去重用（先对原始字节做，省掉解码开销） */
export function hashImagePng(png: Buffer): string {
  return createHash('md5').update(png).digest('hex')
}

/** 造一条文件记录 */
export function buildFileEntry(filePath: string): ClipboardEntry {
  return {
    id: `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'file',
    filePath,
    at: Date.now(),
  }
}

/**
 * 启动轮询。
 *
 * 间隔 700ms：再密没有意义（人手速跟不上），再疏会在「复制完立刻唤出面板」
 * 时读到上一次的内容。写盘不在这里做 —— 调用方攒够一批再落盘。
 */
export function startClipboardWatch(
  onCapture: (entry: ClipboardEntry) => void,
  intervalMs = 700
): () => void {
  let lastText = ''
  let lastImageHash = ''
  let lastFilePath = ''
  /** 上一轮还没读完就跳过这一轮，避免慢读时请求堆积 */
  let reading = false

  const tick = async () => {
    if (reading) return
    reading = true
    /*
     * 整个 tick 走 try/finally 释放 reading：图片分支要 await 多次（read /
     * getType / arrayBuffer），中途一旦抛异常且没释放，reading 会永久卡在
     * true —— 剪贴板采集从此彻底停摆，而且不报任何错。
     */
    try {
      let text: string
      try {
        /*
         * 必须 await：Electron 44 把 readText() 改成了异步（返回 Promise<string>），
         * 33 时代它是同步返回字符串。不 await 拿到的是 Promise 对象本身 ——
         * 那正是之前两个 bug 的来源：
         *  - 传给 buildEntry 后取 .length 不报错、调用 .trim() 崩掉主进程
         *  - 每次都是新 Promise，去重判断 current === lastText 永不成立，
         *    于是每 700ms 重复处理一次同一个剪贴板，日志刷屏
         */
        text = await clipboard.readText()
      } catch {
        // 某些平台在特定时刻读剪贴板会抛（如刚被别的程序锁住），跳过这一轮即可
        return
      }

      // 文本优先：剪贴板里有文本就记文本，不再看图片
      if (typeof text === 'string' && text) {
        if (text === lastText) return
        lastText = text
        onCapture(buildEntry(text))
        return
      }

      // 文本为空，检查图片和文件。Electron 44 把 readImage 移除了，改用 read() 按 MIME 读
      try {
        const items = await clipboard.read()
        for (const item of items) {
          /*
           * 找图片类型。不能只认 image/*：Electron 44 在 macOS 上把系统原始
           * 格式包装成 `electron application/osclipboard;format="..."`，QQ/微信
           * 截图进来的是 "NeXT TIFF v4.0 pasteboard type"，标准 MIME 反而没有。
           * 所以两路都认：标准 image/*，或 osclipboard 里带 tiff/png/jpeg 的。
           */
          const imageType = item.types.find((type) => {
            if (type.startsWith('image/')) return true
            if (type.includes('osclipboard') && /tiff|png|jpe?g|image/i.test(type)) return true
            return false
          })
          if (!imageType) continue

          // 图片类型必然返回 Blob（bookmark 只对应 bookmark 类型）
          const blob = (await item.getType(imageType)) as Blob
          const buffer = Buffer.from(await blob.arrayBuffer())

          /*
           * 先去重再重编码。图片停在剪贴板里时每 700ms 都会走到这里，而
           * createFromBuffer + toPNG 是纯 CPU 的几 MB 级解码/重编码 ——
           * 原来放在去重之前，等于「截图放着不动」就持续烧主进程。
           * 用原始字节的指纹先挡掉绝大多数 tick，只有真的换了图才付这份成本。
           */
          const rawHash = hashImagePng(buffer)
          if (rawHash === lastImageHash) return
          lastImageHash = rawHash

          const image = nativeImage.createFromBuffer(buffer)
          if (image.isEmpty()) continue // 拿到的不是能解码的图片，跳过

          const png = image.toPNG()
          if (png.length > MAX_IMAGE_BYTES) return // 离谱大图，跳过
          onCapture(buildImageEntry(`data:image/png;base64,${png.toString('base64')}`))
          return
        }

        // 没有图片，检查文件。macOS 在 Finder 复制的文件是 bookmark 类型，
        // getType('electron application/bookmark') 返回 { title, url }。
        // 目前只记第一个文件，多选文件复制时其余文件暂不入库。
        for (const item of items) {
          if (!item.types.includes('electron application/bookmark')) continue
          const bookmark = await item.getType('electron application/bookmark')
          let filePath: string
          try {
            filePath = fileURLToPath(bookmark.url)
          } catch {
            continue // url 不是合法 file:// 就跳过
          }
          if (!filePath) continue
          if (filePath === lastFilePath) return // 同一文件，去重
          lastFilePath = filePath
          onCapture(buildFileEntry(filePath))
          return
        }
      } catch {
        // 读图片/文件失败（剪贴板里没有可读的内容等），静默跳过
      }
    } finally {
      reading = false
    }
  }

  const timer = setInterval(() => void tick(), intervalMs)
  return () => clearInterval(timer)
}
