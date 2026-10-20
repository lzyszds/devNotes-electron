/*
 * 图片转换的编码核心：格式表、尺寸换算、体积压缩、解码与导出。
 *
 * 单张转换（ImageConvertTool）与批量转换（ImageBatchPanel）共用这里，
 * 两边的编码结果保持一致。全部走浏览器 canvas，纯本地运行。
 */

export type FormatValue = 'webp' | 'avif' | 'jpeg' | 'png'

export interface Size {
  width: number
  height: number
}

/** 按长边缩放，结果不小于 1px */
export function fitToLongEdge(source: Size, long: number): Size {
  const factor = long / Math.max(source.width, source.height)
  return {
    width: Math.max(1, Math.round(source.width * factor)),
    height: Math.max(1, Math.round(source.height * factor)),
  }
}

/** 用二分法把体积压到目标以下。不依赖任何编码质量模型，直接试真实的编码结果 */
export async function encodeUnderTarget(
  canvas: HTMLCanvasElement,
  mime: string,
  targetBytes: number,
  startQuality: number,
): Promise<{ blob: Blob; quality: number }> {
  let size = { width: canvas.width, height: canvas.height }
  let fallback: { blob: Blob; quality: number } | null = null

  for (let attempt = 0; attempt < 5; attempt++) {
    let best = await canvasToBlob(canvas, mime, startQuality / 100)
    if (best.size <= targetBytes) return { blob: best, quality: startQuality }

    // 画质下限还压不下去，就折一半尺寸再来一轮
    let low = 10
    let high = startQuality
    for (let step = 0; step < 7 && high - low > 2; step++) {
      const mid = Math.round((low + high) / 2)
      const blob = await canvasToBlob(canvas, mime, mid / 100)
      if (blob.size <= targetBytes) {
        best = blob
        low = mid
      } else {
        high = mid
        fallback = { blob, quality: mid }
      }
    }
    if (best.size <= targetBytes) return { blob: best, quality: low }

    if (size.width <= 1 || size.height <= 1) break
    const next: Size = {
      width: Math.max(1, Math.round(size.width * 0.75)),
      height: Math.max(1, Math.round(size.height * 0.75)),
    }
    const scaled = shrinkCanvas(canvas, size)
    if (!scaled) break
    size = next
    canvas.width = next.width
    canvas.height = next.height
    const ctx = canvas.getContext('2d')
    if (!ctx) break
    ctx.drawImage(scaled, 0, 0)
  }

  // 目标实在够不着，交出最接近的一次，别让用户空手
  if (fallback) return fallback
  return { blob: await canvasToBlob(canvas, mime, 10 / 100), quality: 10 }
}

/**
 * 先把当前画布内容拷进一张等大的临时画布，再把原画布改小重绘。
 * 必须这么绕：改 canvas.width 会连带清空内容，直接缩就是一张白图。
 */
function shrinkCanvas(canvas: HTMLCanvasElement, from: Size): HTMLCanvasElement | null {
  const tmp = document.createElement('canvas')
  tmp.width = from.width
  tmp.height = from.height
  const ctx = tmp.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(canvas, 0, 0)
  return tmp
}

export interface ImageFormat {
  value: FormatValue
  label: string
  mime: string
  /** 导出文件名用的扩展名 */
  ext: string
  /** 有损格式才有画质参数；也是「目标体积」能不能自动压的依据 */
  lossy: boolean
  /** 是否带透明通道；不带的话导出前要铺一层背景色 */
  alpha: boolean
  hint: string
}

export const FORMATS: ImageFormat[] = [
  {
    value: 'webp',
    label: 'WebP',
    mime: 'image/webp',
    ext: 'webp',
    lossy: true,
    alpha: true,
    hint: '同画质下体积最小，支持透明；旧版软件可能打不开',
  },
  {
    value: 'avif',
    label: 'AVIF',
    mime: 'image/avif',
    ext: 'avif',
    lossy: true,
    alpha: true,
    hint: '压缩率比 WebP 更高，Next-gen 格式；编码慢，且老浏览器不支持',
  },
  {
    value: 'jpeg',
    label: 'JPEG',
    mime: 'image/jpeg',
    ext: 'jpg',
    lossy: true,
    alpha: false,
    hint: '兼容性最好，不支持透明，透明区域会填成背景色',
  },
  {
    value: 'png',
    label: 'PNG',
    mime: 'image/png',
    ext: 'png',
    lossy: false,
    alpha: true,
    hint: '无损且支持透明，适合图标与截图，体积偏大',
  },
]

/** 解码图片。object URL 要等 onload 才能拿到尺寸，只能包成 Promise */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = url
  })
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`当前环境不支持导出 ${mime}`))),
      mime,
      quality,
    )
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 当前环境编得动的格式（Chromium 三种全支持，个别 WebView 可能缺 WebP） */
export function listEncodableFormats(): ImageFormat[] {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return FORMATS.filter((item) => canvas.toDataURL(item.mime).startsWith(`data:${item.mime}`))
}
