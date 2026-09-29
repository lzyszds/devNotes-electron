/*
 * ICO 文件封装。
 *
 * 为什么手写而不是引库：png-to-ico 那几个包都依赖 node:fs，在 Vite 打包的
 * 渲染进程里导入即报错；而且它们输出的是 BMP/DIB 格式，256×256 单张就要
 * 262KB。PNG 压缩的 ICO 从 Vista 起全平台都认，体积小一个数量级。
 *
 * 格式本身很简单 —— 6 字节文件头 + 每张图一条 16 字节目录项 + 图片数据。
 * 详见 https://en.wikipedia.org/wiki/ICO_(file_format)
 */

/** ICO 目录项里宽度/高度是单字节，256 要写 0（这是规范里的特例） */
const MAX_DIMENSION = 256

export interface IcoSize {
  /** 边长，正方形 */
  size: number
}

/** 常用尺寸：16/32 给浏览器标签页，48 给 Windows 任务栏，256 给高清屏 */
export const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const

/** 必须按 BMP 里的小端序写 */
class ByteWriter {
  private bytes: number[] = []

  u8(value: number) {
    this.bytes.push(value & 0xff)
    return this
  }

  u16(value: number) {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff)
    return this
  }

  u32(value: number) {
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    )
    return this
  }

  raw(data: Uint8Array) {
    for (const byte of data) this.bytes.push(byte)
    return this
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

/**
 * 把若干张 PNG 合成一个多尺寸 .ico。
 *
 * 每张 PNG 都必须是正方形（调用方保证），尺寸不同没关系 ——
 * 系统会按需挑最合适的那张。传入顺序不影响解析，但按从小到大排更好读。
 */
export async function encodeIco(pngs: { size: number; blob: Blob }[]): Promise<Blob> {
  if (!pngs.length) throw new Error('至少要有一张图片')

  const images = await Promise.all(
    pngs.map(async (png) => {
      if (png.size > MAX_DIMENSION) {
        throw new Error(`ICO 单张最大 ${MAX_DIMENSION}×${MAX_DIMENSION}，收到 ${png.size}`)
      }
      return { size: png.size, data: new Uint8Array(await png.blob.arrayBuffer()) }
    }),
  )

  // 文件头 6 字节 + 每张图目录项 16 字节，之后才是图片数据
  const headerSize = 6 + images.length * 16

  const head = new ByteWriter()
  head.u16(0) // 保留位，必须为 0
  head.u16(1) // 1 表示这是图标（2 是光标）
  head.u16(images.length)

  let offset = headerSize
  for (const image of images) {
    // 256 在单字节字段里写 0：256 存不进 8 位，规范约定用 0 表示
    const dimension = image.size >= MAX_DIMENSION ? 0 : image.size
    head.u8(dimension) // 宽
    head.u8(dimension) // 高
    head.u8(0) // 调色板数量，无调色板为 0
    head.u8(0) // 保留位
    head.u16(1) // 色彩平面数
    head.u16(32) // 位深
    head.u32(image.data.length) // 该图数据的字节数
    head.u32(offset) // 数据在文件里的偏移
    offset += image.data.length
  }

  const chunks: Uint8Array[] = [head.toBytes(), ...images.map((image) => image.data)]
  return new Blob(chunks as BlobPart[], { type: 'image/x-icon' })
}

/**
 * 从一张已绘制的画布导出 ICO。
 *
 * 各尺寸都用高质量重采样单独画一遍 —— 直接拿 256 的那张缩小成 16 会让
 * 小图标发糊，逐级重绘的线条更干净。
 */
export async function canvasToIco(
  source: HTMLImageElement | HTMLCanvasElement,
  sizes: readonly number[],
  toPng: (canvas: HTMLCanvasElement) => Promise<Blob>,
  /** 不支持透明的格式（其实 ICO 都支持，留个口子） */
  background?: string,
): Promise<Blob> {
  const sourceWidth = 'naturalWidth' in source ? source.naturalWidth : source.width
  const sourceHeight = 'naturalHeight' in source ? source.naturalHeight : source.height
  const box = Math.min(sourceWidth, sourceHeight)

  const pngs: { size: number; blob: Blob }[] = []
  for (const size of sizes) {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前环境拿不到画布')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (background) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, size, size)
    }
    // 居中裁成正方形：图标必须是方的，非方图直接拉伸会变形
    const sx = (sourceWidth - box) / 2
    const sy = (sourceHeight - box) / 2
    ctx.drawImage(source, sx, sy, box, box, 0, 0, size, size)
    pngs.push({ size, blob: await toPng(canvas) })
  }

  return encodeIco(pngs)
}
