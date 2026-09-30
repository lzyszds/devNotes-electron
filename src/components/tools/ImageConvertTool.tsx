import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  FileImage,
  FileWarning,
  Frame,
  Globe,
  Image as ImageIcon,
  Layers,
  Link2,
  Link2Off,
  Loader2,
  Move,
  Palette,
  RefreshCw,
  Scaling,
  Smartphone,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react'
import {
  BTN,
  META,
  SECTION_LABEL,
  Segmented,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolEmpty,
  ToolNotice,
  ToolShell,
  ToolTag,
  CopyButton,
  CopyImageButton,
  CountUp,
  iconButtonClass,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { ICO_SIZES, canvasToIco } from '../../utils/icoEncoder'
import { blobToDataUrl, bundleZip, downloadBlob, type BundleEntry } from '../../utils/zipBundle'

/** 多倍图导出的倍率。1x/2x 覆盖普通与视网膜屏，3x 给部分安卓 */
const MULTI_SCALES = [1, 2, 3] as const

/*
 * 图片格式转换 + 尺寸工作台（对标腾讯鲁班）。
 *
 * 编解码全走浏览器自带的 canvas（Chromium 原生支持 PNG / JPEG / WebP），
 * 不引第三方 wasm、也不上传到任何服务端 —— 纯本地，离线也能用。
 * 以后要加 AVIF、BMP 这类格式，只需在 FORMATS 里补一行；canvas 编不了的
 * 再单独接 wasm 编码器，其余逻辑不用动。
 *
 * 尺寸有两条入口，都改同一份「输出尺寸」状态：宽高像素输入框与预设按钮
 * （外加一条等比滑杆，它算完也写回同一份状态）。所以尺寸不能拆开存 ——
 * 想改这里的同步逻辑，先看清楚下面尺寸状态那一节的注释。
 */

type FormatValue = 'webp' | 'avif' | 'jpeg' | 'png'

interface Size {
  width: number
  height: number
}

/** 常用尺寸预设。长边取值，手机竖图与横图都能对上；over 为真时只缩小不放大 */
interface SizePreset {
  label: string
  long: number
  over?: boolean
}

const SIZE_PRESETS: SizePreset[] = [
  { label: '原尺寸', long: 0 },
  { label: '80%', long: 0 },
  { label: '1920', long: 1920, over: true },
  { label: '1280', long: 1280, over: true },
  { label: '1080', long: 1080, over: true },
  { label: '750', long: 750, over: true },
  { label: '512', long: 512, over: true },
]

/** 按长边缩放，结果不小于 1px */
function fitToLongEdge(source: Size, long: number): Size {
  const factor = long / Math.max(source.width, source.height)
  return {
    width: Math.max(1, Math.round(source.width * factor)),
    height: Math.max(1, Math.round(source.height * factor)),
  }
}

/** 用二分法把体积压到目标以下。不依赖任何编码质量模型，直接试真实的编码结果 */
async function encodeUnderTarget(
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

interface ImageFormat {
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

const FORMATS: ImageFormat[] = [
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

interface SourceImage {
  file: File
  /** 原图的 object URL */
  url: string
  width: number
  height: number
  size: number
  /** SVG 是矢量的，放大导出不会糊 —— 预览区据此换文案 */
  isVector?: boolean
}

interface ResultImage {
  blob: Blob
  url: string
  width: number
  height: number
  size: number
  /** 实际使用的画质，指定目标体积时会被自动降低 */
  quality: number
}

/** 解码图片。object URL 要等 onload 才能拿到尺寸，只能包成 Promise */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`当前环境不支持导出 ${mime}`))),
      mime,
      quality,
    )
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function ImageConvertTool() {
  const [source, setSource] = useState<SourceImage | null>(null)
  const [format, setFormat] = useState<FormatValue>('webp')
  const [quality, setQuality] = useState(90)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [lockRatio, setLockRatio] = useState(true)
  const [bgColor, setBgColor] = useState('#ffffff')
  const [targetKb, setTargetKb] = useState('')
  const [result, setResult] = useState<ResultImage | null>(null)
  const [converting, setConverting] = useState(false)
  /** 导出 ICO / 多倍图 / zip 期间为真，用来禁用按钮防重复点击 */
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 预览看的是原图还是转换结果 */
  const [view, setView] = useState<'before' | 'after'>('after')
  const [dragging, setDragging] = useState(false)
  /** 松手那一瞬的「落入」反馈，只亮一帧，动画跑完就撤 */
  const [landing, setLanding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  const activeFormat = useMemo(
    () => FORMATS.find((item) => item.value === format) ?? FORMATS[0],
    [format],
  )

  // 当前环境编得动哪些格式（Chromium 三种全支持，个别 WebView 可能缺 WebP）
  const encodable = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    return FORMATS.filter((item) => canvas.toDataURL(item.mime).startsWith(`data:${item.mime}`)).map(
      (item) => item.value,
    )
  }, [])

  const formatOptions = useMemo(
    () =>
      FORMATS.filter((item) => encodable.includes(item.value)).map((item) => ({
        value: item.value,
        label: item.label,
      })),
    [encodable],
  )

  // 选中的格式万一编不了，退回到第一个可用格式
  useEffect(() => {
    if (encodable.length && !encodable.includes(format)) setFormat(encodable[0])
  }, [encodable, format])

  // object URL 用完要还回去：url 变化或组件卸载时释放上一张
  useEffect(() => {
    const url = source?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [source?.url])

  useEffect(() => {
    const url = result?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [result?.url])

  /*
   * 「落入」震颤：放下文件后让拖放区快速内缩再弹回，像东西落进盒底。
   * 连续两次导入时要先清掉上一次的定时器，否则第二次的收起会把第一次的
   * 动画打断在半路（data-landing 在中途被摘掉，看起来像抽搐一下）。
   */
  const landingTimerRef = useRef<number | null>(null)
  const playLanding = useCallback(() => {
    if (landingTimerRef.current !== null) window.clearTimeout(landingTimerRef.current)
    setLanding(true)
    landingTimerRef.current = window.setTimeout(() => {
      setLanding(false)
      landingTimerRef.current = null
    }, 360)
  }, [])

  useEffect(
    () => () => {
      if (landingTimerRef.current !== null) window.clearTimeout(landingTimerRef.current)
    },
    [],
  )

  const applyFile = useCallback(
    async (file: File) => {
      // SVG 常常没有 MIME（拖拽进来的尤其如此），按扩展名兜一层
      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
      if (!file.type.startsWith('image/') && !isSvg) {
        showToast('只能处理图片文件', 'error')
        return
      }
      playLanding()
      const url = URL.createObjectURL(file)
      try {
        const img = await loadImage(url)
        // SVG 没有固有像素尺寸时 naturalWidth 会是 0，退回一个默认画布
        const naturalWidth = img.naturalWidth || 1024
        const naturalHeight = img.naturalHeight || 1024
        setSource({
          file,
          url,
          width: naturalWidth,
          height: naturalHeight,
          size: file.size,
          isVector: isSvg,
        })
        setTargetKb('')
        // 换图时尺寸回到「原图」，否则会拿上一张的尺寸去套新图
        setWidth(naturalWidth)
        setHeight(naturalHeight)
        setView('after')
        setError('')
      } catch {
        URL.revokeObjectURL(url)
        setError(
          isSvg
            ? '这个 SVG 解析失败：可能引用了外部图片/字体，或文件里没有合法的 SVG 根节点'
            : '这张图解码失败，换一个文件试试',
        )
      }
    },
    [showToast],
  )

  // 支持 Ctrl/⌘ + V 直接粘贴剪贴板里的图
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
        entry.type.startsWith('image/'),
      )
      const file = item?.getAsFile()
      if (!file) return
      event.preventDefault()
      void applyFile(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [applyFile])

  /* ---------------- 尺寸状态 ----------------
   * 输出尺寸以 width / height 两个像素数为准（不是百分比）。两条入口最终都落到
   * 这里：输入框给的是单边像素、预设按钮算完也是像素。所以「原图」在这里没有
   * 专属状态，回到原图只是把这两个数写回源图尺寸。下面从 width / height 反推
   * 一份百分比，只用于显示与那条等比滑杆。 */
  const targetWidth = source ? Math.max(1, Math.round(width || source.width)) : 0
  const targetHeight = source ? Math.max(1, Math.round(height || source.height)) : 0
  const scalePercent =
    source && source.width > 0 ? Math.round((targetWidth / source.width) * 100) : 100

  const setSize = (nextW: number, nextH: number) => {
    setWidth(Math.max(1, Math.round(nextW)))
    setHeight(Math.max(1, Math.round(nextH)))
  }

  /** 单边输入：锁比例时另一边跟着等比走 */
  const changeWidth = (value: number) => {
    if (!source) return
    if (!lockRatio) {
      setWidth(Math.max(1, Math.round(value)))
      return
    }
    const nextW = Math.max(1, Math.round(value))
    setSize(nextW, (nextW * source.height) / source.width)
  }

  const changeHeight = (value: number) => {
    if (!source) return
    if (!lockRatio) {
      setHeight(Math.max(1, Math.round(value)))
      return
    }
    const nextH = Math.max(1, Math.round(value))
    setSize((nextH * source.width) / source.height, nextH)
  }

  /** 按滑块百分比缩放，基准是原图尺寸 */
  const applyScale = (percent: number) => {
    if (!source) return
    setSize((source.width * percent) / 100, (source.height * percent) / 100)
  }

  const applyPreset = (preset: SizePreset) => {
    if (!source) return
    const origin: Size = { width: source.width, height: source.height }
    if (preset.label === '原尺寸') return setSize(origin.width, origin.height)
    if (preset.label === '80%') return applyScale(80)
    const fitted = fitToLongEdge(origin, preset.long)
    // 「≤ 某长边」的预设只缩不放，比它还小的图保持原样
    const isShrinking = fitted.width < origin.width || fitted.height < origin.height
    if (preset.over && !isShrinking) return setSize(origin.width, origin.height)
    setSize(fitted.width, fitted.height)
  }

  /** 当前尺寸命中了哪个预设（用于高亮） */
  const activePreset = useMemo(() => {
    if (!source) return ''
    const same = (w: number, h: number) => w === targetWidth && h === targetHeight
    if (same(source.width, source.height)) return '原尺寸'
    if (same(Math.round(source.width * 0.8), Math.round(source.height * 0.8))) return '80%'
    return (
      SIZE_PRESETS.find((preset) => {
        if (!preset.over) return false
        const fitted = fitToLongEdge({ width: source.width, height: source.height }, preset.long)
        const isShrinking = fitted.width < source.width || fitted.height < source.height
        return isShrinking && same(fitted.width, fitted.height)
      })?.label ?? ''
    )
    // activePreset 只用来看谁该高亮，两个数变化本身不改变高亮结果，
    // 所以刻意不放进依赖，免得拖滑杆时白白重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  /* ---------------- 转换：尺寸 / 画质 / 格式一变就重算 ---------------- */
  useEffect(() => {
    if (!source) {
      setResult(null)
      return
    }
    let cancelled = false
    // 防抖：拖滑杆时会连发多次，等停稳再算，省得每帧都跑一遍编码
    const delay = 160
    const timer = window.setTimeout(async () => {
      setConverting(true)
      try {
        const img = await loadImage(source.url)
        const width = Math.max(1, Math.round(targetWidth))
        const height = Math.max(1, Math.round(targetHeight))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('当前环境拿不到画布')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        // JPEG 没有透明通道，先铺底色，否则透明区域会变成黑块
        if (!activeFormat.alpha) {
          ctx.fillStyle = bgColor
          ctx.fillRect(0, 0, width, height)
        }
        ctx.drawImage(img, 0, 0, width, height)

        const wantedKb = Number(targetKb)
        let blob: Blob
        let usedQuality = quality
        if (activeFormat.lossy && wantedKb > 0) {
          // 指定目标体积：画质和尺寸都让位给体积，压缩后尺寸可能小于上面填的值
          const hit = await encodeUnderTarget(canvas, activeFormat.mime, wantedKb * 1024, quality)
          blob = hit.blob
          usedQuality = hit.quality
        } else {
          blob = await canvasToBlob(canvas, activeFormat.mime, activeFormat.lossy ? quality / 100 : undefined)
        }

        if (cancelled) return
        // 压缩目标还会把画布再缩过，所以结果尺寸以画布实际尺寸为准
        setResult({
          blob,
          url: URL.createObjectURL(blob),
          width: canvas.width,
          height: canvas.height,
          size: blob.size,
          quality: usedQuality,
        })
        setError('')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '转换失败')
      } finally {
        if (!cancelled) setConverting(false)
      }
    }, delay)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [source, format, quality, targetWidth, targetHeight, bgColor, targetKb, activeFormat])

  const clearSource = () => {
    setSource(null)
    setResult(null)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const resetParams = () => {
    setQuality(90)
    setBgColor('#ffffff')
    setTargetKb('')
    if (source) setSize(source.width, source.height)
  }

  const download = () => {
    if (!result || !source) return
    const name = source.file.name.replace(/\.[^.]+$/, '') || 'image'
    const link = document.createElement('a')
    link.href = result.url
    link.download = `${name}.${activeFormat.ext}`
    link.click()
    showToast(`已导出 ${name}.${activeFormat.ext}`)
  }

  const copyImage = async () => {
    if (!result) return
    try {
      // 剪贴板只认 PNG，把结果再画一遍转成 PNG 写进去
      const img = await loadImage(result.url)
      const canvas = document.createElement('canvas')
      canvas.width = result.width
      canvas.height = result.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('当前环境拿不到画布')
      ctx.drawImage(img, 0, 0)
      const png = await canvasToBlob(canvas, 'image/png')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      showToast('已复制转换后的图片（PNG）')
    } catch {
      showToast('复制失败', 'error')
    }
  }

  /** 源图的去扩展名文件名，导出时复用 */
  const baseName = source ? source.file.name.replace(/\.[^.]+$/, '') || 'image' : 'image'

  /* ---------------- 多倍图导出 ---------------- */

  /** 把源图按倍率重绘成 PNG。矢量源放到多大都不糊，位图源放大会失真 */
  const renderSizedPng = async (scale: number) => {
    if (!source) throw new Error('没有源图')
    const img = await loadImage(source.url)
    const width = Math.max(1, Math.round(source.width * scale))
    const height = Math.max(1, Math.round(source.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前环境拿不到画布')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // 多倍图一律出 PNG：透明要保住，且这类资源通常给 retina 用
    if (!activeFormat.alpha) {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(img, 0, 0, width, height)
    return { blob: await canvasToBlob(canvas, 'image/png'), width, height }
  }

  const exportMultiScale = async () => {
    if (!source) return
    setBusy(true)
    try {
      const entries: BundleEntry[] = []
      for (const scale of MULTI_SCALES) {
        const { blob } = await renderSizedPng(scale)
        entries.push({ name: `${baseName}@${scale}x.png`, blob })
      }
      downloadBlob(await bundleZip(entries), `${baseName}@multi.zip`)
      showToast(`已导出 ${MULTI_SCALES.length} 个倍率（zip）`)
    } catch (e) {
      setError('多倍图导出失败：' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- 站点图标 ---------------- */

  const exportIco = async () => {
    if (!source) return
    setBusy(true)
    try {
      const img = await loadImage(source.url)
      const ico = await canvasToIco(img, ICO_SIZES, (canvas) => canvasToBlob(canvas, 'image/png'))
      downloadBlob(ico, 'favicon.ico')
      showToast(`favicon.ico 已导出（${ICO_SIZES.join('/')}）`)
    } catch (e) {
      setError('ICO 导出失败：' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const exportTouchIcon = async () => {
    if (!source) return
    setBusy(true)
    try {
      const img = await loadImage(source.url)
      const size = 180
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('当前环境拿不到画布')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      // apple-touch-icon 不支持透明，透明区会变黑，所以先铺白底
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      const box = Math.min(source.width, source.height)
      ctx.drawImage(img, (source.width - box) / 2, (source.height - box) / 2, box, box, 0, 0, size, size)
      downloadBlob(await canvasToBlob(canvas, 'image/png'), 'apple-touch-icon.png')
      showToast('apple-touch-icon.png 已导出（180×180）')
    } catch (e) {
      setError('触屏图标导出失败：' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- 内联用：DataURL ---------------- */

  /*
   * DataURL 是同步取值（CopyButton 点下去就要拿到字符串），而 base64 生成是异步的。
   * 所以这里改成「结果一变就先算好、存进 ref」，点击时只做一次性读取 ——
   * 既是同步的，也避免了每次点击都把几十 KB 的字符串重算一遍。
   */
  const dataUrlCache = useRef<{ raw: string; css: string } | null>(null)
  useEffect(() => {
    dataUrlCache.current = null
    if (!result) return
    let cancelled = false
    void (async () => {
      try {
        const dataUrl = await blobToDataUrl(result.blob)
        if (cancelled) return
        dataUrlCache.current = {
          raw: dataUrl,
          css: `background-image: url("${dataUrl}");`,
        }
      } catch (e) {
        if (!cancelled) setError('生成 DataURL 失败：' + (e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [result])

  // 正数是变小，负数是变大
  const savedRatio = source && result ? Math.round((1 - result.size / source.size) * 100) : null

  return (
    // 外层 flex 承托：ToolShell 占满剩余高度，动作条作为兄弟节点在它下面独占一条，
    // 两者不可能互相覆盖（放进 ToolShell 的 children 会被滚动容器吞掉高度）。
    <div className="flex flex-col h-full min-h-0">
    <ToolShell
      icon={FileImage}
      title="图片转换"
      subtitle="PNG / JPEG / WebP / AVIF 互转，画质与尺寸随手调"
      scroll={false}
      badge={<ToolBadge tone="brand">{activeFormat.label}</ToolBadge>}
      actions={
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void applyFile(file)
              // 清掉 value，否则连续选同一个文件不会再触发 change
              event.target.value = ''
            }}
          />
          <button onClick={() => inputRef.current?.click()} className="tool-button-secondary h-8">
            <Upload size={15} />
            <span>{source ? '更换图片' : '选择图片'}</span>
          </button>
          <button onClick={download} disabled={!result} className="tool-button-primary h-8 px-5">
            <Download size={15} />
            <span>导出 {activeFormat.label}</span>
          </button>
        </>
      }
    >
      {/* scroll={false} 时 ToolShell 不会给内容加内边距，这里自己包一层 */}
      <div className="flex-1 min-h-0 flex flex-col gap-3.5 p-4 md:p-6 md:pr-0">
      {error && (
        <ToolNotice tone="error" icon={FileWarning}>
          {error}
        </ToolNotice>
      )}

      <div
        className="tool-cascade grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 pr-4 items-start lg:flex-1 lg:min-h-0 lg:overflow-y-auto"
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          // 拖过子元素时也会连着触发 dragleave，只有真正离开容器才收起高亮，
          // 否则鼠标划过卡片边缘会看到高亮一闪一闪
          if (event.currentTarget.contains(event.relatedTarget as Node)) return
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files?.[0]
          if (file) void applyFile(file)
        }}
      >
        {/* ---------------- 源图与参数 ---------------- */}
        <div className="space-y-4">
          <ToolCard fill={false}>
            <ToolCardHeader
              title="源图片"
              icon={ImageIcon}
              meta={source ? `${source.width} × ${source.height}` : '未选择'}
              actions={
                source ? (
                  <Tooltip content="移除图片">
                    <button onClick={clearSource} className={iconButtonClass('danger')}>
                      <Trash2 size={15} />
                    </button>
                  </Tooltip>
                ) : null
              }
            />

            {source ? (
              <div className="p-4 flex gap-4 items-center">
                <div className="w-24 h-24 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-slate-50 dark:bg-dark-bg/40 ring-1 ring-slate-200/60 dark:ring-dark-border">
                  <img src={source.url} alt="源图" className="max-w-full max-h-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {source.file.name}
                  </p>
                  <p className={`${META} mt-1.5`}>
                    原图 {source.width} × {source.height} px · {formatBytes(source.size)}
                  </p>
                  <p className={`${META} mt-1`}>
                    输出 {targetWidth} × {targetHeight} px · {activeFormat.label}
                    {scalePercent !== 100 && ` · ${scalePercent}%`}
                  </p>
                  {source.isVector && (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                      矢量源：放大导出不会失真，可放心拉大尺寸
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                data-drag={dragging || undefined}
                data-landing={landing || undefined}
                className={`drop-zone m-4 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-10 px-6 ${
                  dragging
                    ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/50 dark:bg-brand-500/10'
                    : 'border-slate-200 dark:border-dark-border hover:border-brand-300 hover:bg-slate-50/60 dark:hover:bg-dark-hover/40'
                }`}
              >
                <span className="drop-zone-icon w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center">
                  <Upload size={20} />
                </span>
                <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                  把图片拖进来，或点击选择
                </span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  也可以直接 Ctrl / ⌘ + V 粘贴剪贴板里的图片
                </span>
              </button>
            )}
          </ToolCard>

          {/* ---------------- 转换结果 ---------------- */}
          <ToolCard fill={false}>
          <ToolCardHeader
            title="转换结果"
            icon={Move}
            meta={
              result
                ? `${result.width} × ${result.height}${
                    activeFormat.lossy && result.quality !== quality ? ` · 画质 ${result.quality}%` : ''
                  }`
                : undefined
            }
            actions={
              source ? (
                <>
                  {/* 切换看原图 / 转换结果，方便肉眼对比画质损失 */}
                  <Segmented
                    value={view}
                    options={[
                      { value: 'before', label: '原图' },
                      { value: 'after', label: '转换后' },
                    ]}
                    onChange={(next) => {
                      if (next !== 'after') return
                      setView('after')
                    }}
                    className="mr-1"
                  />
                  <CopyImageButton onClick={() => void copyImage()} disabled={!result} />
                </>
              ) : null
            }
          />

          <div className="relative p-6 min-h-[240px] flex items-center justify-center bg-slate-50/50 dark:bg-dark-bg/30">
            {converting && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 dark:bg-dark-bg/50">
                <Loader2 size={20} className="animate-spin text-brand-500" />
              </div>
            )}

            {source ? (
              view === 'before' ? (
                <div className="relative inline-flex">
                  {/* 「原图」是参照系，不放手柄，免得误以为拖它也能改尺寸 */}
                  <img
                    src={source.url}
                    alt="原图"
                    className="max-w-full max-h-[340px] object-contain rounded-lg shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/60"
                  />
                  <span className="absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded-md bg-slate-900/70 text-white text-[10px] font-medium tabular-nums">
                    {source.width} × {source.height} · 原图
                  </span>
                </div>
              ) : result ? (
                /* key 绑结果地址：换一张图/换一次参数就重挂载，fe-rise 重播 —— 
                   结果「融化」出来而不是原地换像素 */
                <div key={result.url} className="fe-rise relative inline-flex">
                  <img
                    src={result.url}
                    alt="转换结果"
                    draggable={false}
                    className="max-w-full max-h-[340px] object-contain rounded-lg shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/60 select-none"
                  />
                  <span className="absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded-md bg-slate-900/70 text-white text-[10px] font-medium tabular-nums">
                    {result.width} × {result.height}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-slate-400 dark:text-slate-500">正在转换…</span>
              )
            ) : (
              <ToolEmpty
                icon={Palette}
                title="还没有选择图片"
                hint="左侧拖入或选择一张图片，这里会显示转换后的效果"
              />
            )}
          </div>

          {source && (
            <ToolCardFooter>
              <span className="font-mono">
                {formatBytes(source.size)} →{' '}
                {result ? (
                  /* 结果体积从上一张图的数值滚过来，让「省了多少」有体感 */
                  <CountUp value={result.size} format={formatBytes} />
                ) : (
                  '…'
                )}
              </span>
              <span className="flex items-center gap-1.5">
                {Number(targetKb) > 0 && result && result.size > Number(targetKb) * 1024 ? (
                  <ToolTag tone="amber">已压到极限，未达目标</ToolTag>
                ) : savedRatio !== null ? (
                  <ToolTag tone={savedRatio >= 0 ? 'emerald' : 'amber'} className="fe-pop">
                    {savedRatio >= 0 ? `体积 -${savedRatio}%` : `体积 +${Math.abs(savedRatio)}%`}
                  </ToolTag>
                ) : null}
                {/* 小图标惯用内联写法，省得再跑一趟 Base64 工具 */}
                <CopyButton
                  value={() => dataUrlCache.current?.raw ?? ''}
                  disabled={!result}
                  tone="neutral"
                  size={13}
                  label="复制为 DataURL"
                  className="opacity-100"
                />
                <CopyButton
                  value={() => dataUrlCache.current?.css ?? ''}
                  disabled={!result}
                  tone="neutral"
                  size={13}
                  label="复制为 CSS background"
                  className="opacity-100"
                />
              </span>
            </ToolCardFooter>
          )}
        </ToolCard>
        </div>

        {/* ---------------- 右列：输出设置 ---------------- */}
        <div className="space-y-4 min-w-0">
          <ToolCard fill={false}>
            <ToolCardHeader
              title="输出设置"
              icon={Scaling}
              meta={source ? `${targetWidth} × ${targetHeight}` : undefined}
            />

            <div className="p-4 flex flex-col gap-5">
              {/* 目标格式 */}
              <div className="flex flex-col gap-2">
                <span className={SECTION_LABEL}>目标格式</span>
                <Segmented value={format} options={formatOptions} onChange={setFormat} />
                <p className="text-[11px] text-slate-400 dark:text-slate-500">{activeFormat.hint}</p>
              </div>

              {/* 目标体积：只对有损格式有意义，PNG 无损压不到指定大小 */}
              {activeFormat.lossy && (
                <div className="flex flex-col gap-2">
                  <span className={SECTION_LABEL}>目标体积</span>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 pl-3 pr-2.5 py-2 cursor-text">
                    <Zap
                      size={15}
                      className={`shrink-0 ${
                        Number(targetKb) > 0
                          ? 'text-brand-600 dark:text-brand-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    />
                    <input
                      type="number"
                      min="1"
                      value={targetKb}
                      disabled={!source}
                      onChange={(event) => setTargetKb(event.target.value)}
                      placeholder="留空表示不限制"
                      className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 tabular-nums disabled:cursor-not-allowed"
                    />
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                      KB
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    填了数值就自动帮你压到这个大小：先降画质，还不够再等比缩尺寸
                  </p>
                </div>
              )}

              {/* 输出尺寸：三个入口改的是同一份状态 */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className={SECTION_LABEL}>输出尺寸</span>
                  <Tooltip content={lockRatio ? '已锁定宽高比' : '宽高独立'}>
                    <button
                      onClick={() => setLockRatio(!lockRatio)}
                      className={`inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold transition-colors ${
                        lockRatio
                          ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-dark-hover dark:text-slate-400'
                      }`}
                    >
                      {lockRatio ? <Link2 size={11} /> : <Link2Off size={11} />}
                      <span>{lockRatio ? '锁比例' : '自由'}</span>
                    </button>
                  </Tooltip>
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex-1 flex items-center gap-2 rounded-lg border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 pl-2.5 pr-2 py-1.5 min-w-0">
                    <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 shrink-0">
                      宽
                    </span>
                    <input
                      type="number"
                      min="1"
                      value={targetWidth || ''}
                      disabled={!source}
                      onChange={(event) => changeWidth(Number(event.target.value))}
                      className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-medium text-slate-800 dark:text-slate-100 tabular-nums disabled:cursor-not-allowed"
                    />
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">px</span>
                  </label>
                  <span className="text-slate-300 dark:text-slate-600 text-xs shrink-0">×</span>
                  <label className="flex-1 flex items-center gap-2 rounded-lg border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 pl-2.5 pr-2 py-1.5 min-w-0">
                    <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 shrink-0">
                      高
                    </span>
                    <input
                      type="number"
                      min="1"
                      value={targetHeight || ''}
                      disabled={!source}
                      onChange={(event) => changeHeight(Number(event.target.value))}
                      className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-medium text-slate-800 dark:text-slate-100 tabular-nums disabled:cursor-not-allowed"
                    />
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">px</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {SIZE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => applyPreset(preset)}
                      disabled={!source}
                      className={`inline-flex items-center h-6 px-2 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                        activePreset === preset.label
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-dark-hover dark:text-slate-300 dark:hover:bg-dark-border'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-2 pt-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      等比缩放
                    </span>
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                      {scalePercent}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="1"
                    value={Math.min(100, scalePercent)}
                    disabled={!source}
                    onChange={(event) => applyScale(Number(event.target.value))}
                    className="tool-range"
                  />
                </div>
              </div>

              {/* 画质：只有有损格式才有 */}
              {activeFormat.lossy && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className={SECTION_LABEL}>画质</span>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                      {quality}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={quality}
                    onChange={(event) => setQuality(Number(event.target.value))}
                    className="tool-range"
                  />
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    80 ~ 90 通常看不出差别，体积却能小一大截
                    {Number(targetKb) > 0 && '；已指定目标体积，压缩时会自动下调'}
                  </p>
                </div>
              )}

              {/* 背景色：不支持透明的格式才有意义 */}
              {!activeFormat.alpha && (
                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 pl-2.5 pr-3 py-2 cursor-pointer">
                  <span className="flex items-center gap-2.5">
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(event) => setBgColor(event.target.value)}
                      className="w-7 h-7 rounded-lg border-0 bg-transparent cursor-pointer p-0"
                    />
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      背景填充色
                    </span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                    {bgColor}
                  </span>
                </label>
              )}
            </div>
          </ToolCard>

        </div>
      </div>
      </div>
      </ToolShell>

      {/* 底部动作条：ToolShell 之外、外层 flex 的兄弟节点，独占一条高度 */}
      <div className="shrink-0 px-4 md:px-6 py-3">
      <ToolActionBar
        info={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Scaling size={13} className="text-brand-500" />
              改尺寸用右侧「输出尺寸」的输入框或滑杆
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <Frame size={13} className="text-brand-500" />
              转换全在本机完成，不上传
            </span>
          </>
        }
      >
        <button onClick={resetParams} disabled={!source} className={BTN.secondary}>
          <RefreshCw size={14} />
          <span>重置参数</span>
        </button>

        {/* 站点图标三件套：ICO 与触屏图标都从原图重绘，不受右侧尺寸设置影响 */}
        <Tooltip content="导出 16/32/48/64/128/256 多尺寸 favicon.ico">
          <button onClick={exportIco} disabled={!source || busy} className={BTN.secondary}>
            <Globe size={14} />
            <span>favicon.ico</span>
          </button>
        </Tooltip>
        <Tooltip content="导出 180×180 的 apple-touch-icon.png（白底，iOS 不支持透明）">
          <button onClick={exportTouchIcon} disabled={!source || busy} className={BTN.secondary}>
            <Smartphone size={14} />
            <span>触屏图标</span>
          </button>
        </Tooltip>
        <Tooltip content="按 @1x/@2x/@3x 导出并打成 zip">
          <button onClick={exportMultiScale} disabled={!source || busy} className={BTN.secondary}>
            <Layers size={14} />
            <span>多倍图</span>
          </button>
        </Tooltip>
        <button onClick={download} disabled={!result} className={BTN.primary}>
          <Download size={14} />
          <span>导出图片</span>
        </button>
      </ToolActionBar>
      </div>
    </div>
  )
}
