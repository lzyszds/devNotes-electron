/**
 * 笔记与媒体图片的客户端极速 WebP 压缩与格式转换。
 *
 * 核心目标：
 * 1. 把剪贴板截图（通常为高清 Retina PNG，动辄 3~8MB）转换为 WebP 格式（通常仅 100~200KB），节约 90%+ 云端硬盘；
 * 2. 限制超大图片长边不超过 1920px，保证在笔记阅读与预览时的清晰度，同时彻底防止 4K/8K 巨图撑爆服务器；
 * 3. 矢量图（SVG）自动跳过转换，保留矢量无损；
 * 4. 纯本地 Canvas 运算，0 服务器 CPU/内存消耗，上传即是极限压缩后的 WebP。
 */

export interface CompressResult {
  blob: Blob
  width: number
  height: number
  originalSize: number
  compressedSize: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })
}

export async function compressImageToWebp(
  fileOrBase64: File | Blob | string,
  options?: {
    maxEdge?: number
    quality?: number
  }
): Promise<CompressResult> {
  const maxEdge = options?.maxEdge ?? 1920
  const quality = options?.quality ?? 0.82

  let objectUrl = ''
  let originalSize = 0

  if (fileOrBase64 instanceof Blob) {
    originalSize = fileOrBase64.size
    // SVG 属于矢量文本，保留原样不转位图
    if (fileOrBase64.type === 'image/svg+xml') {
      return {
        blob: fileOrBase64,
        width: 0,
        height: 0,
        originalSize,
        compressedSize: originalSize,
      }
    }
    objectUrl = URL.createObjectURL(fileOrBase64)
  } else if (typeof fileOrBase64 === 'string') {
    originalSize = fileOrBase64.length
    if (fileOrBase64.startsWith('data:image/svg+xml')) {
      const blob = new Blob([fileOrBase64], { type: 'image/svg+xml' })
      return {
        blob,
        width: 0,
        height: 0,
        originalSize,
        compressedSize: blob.size,
      }
    }
    objectUrl = fileOrBase64
  } else {
    throw new Error('不支持的图片输入类型')
  }

  try {
    const img = await loadImage(objectUrl)
    let { naturalWidth: width, naturalHeight: height } = img

    // 限制最大长边不超过指定尺寸（默认 1920px）
    if (Math.max(width, height) > maxEdge) {
      const scale = maxEdge / Math.max(width, height)
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('无法创建 2D 画布上下文')
    }

    // 开启高精度双线性平滑缩放
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b)
          else reject(new Error('Canvas 导出 WebP 失败'))
        },
        'image/webp',
        quality
      )
    })

    return {
      blob,
      width,
      height,
      originalSize,
      compressedSize: blob.size,
    }
  } finally {
    if (fileOrBase64 instanceof Blob && objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}
