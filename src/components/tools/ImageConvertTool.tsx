import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  Copy,
  Download,
  FileImage,
  FileWarning,
  Frame,
  Image as ImageIcon,
  Link2,
  Link2Off,
  Loader2,
  Maximize2,
  Move,
  Palette,
  RefreshCw,
  Scaling,
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
  iconButtonClass,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'

/*
 * 图片格式转换 + 尺寸工作台（对标腾讯鲁班）。
 *
 * 编解码全走浏览器自带的 canvas（Chromium 原生支持 PNG / JPEG / WebP），
 * 不引第三方 wasm、也不上传到任何服务端 —— 纯本地，离线也能用。
 * 以后要加 AVIF、BMP 这类格式，只需在 FORMATS 里补一行；canvas 编不了的
 * 再单独接 wasm 编码器，其余逻辑不用动。
 *
 * 尺寸有三条入口，都改同一份「输出尺寸」状态：预览图上的拖拽手柄、
 * 宽高像素输入框、预设按钮。三者谁动都算数，所以状态不能拆开存 ——
 * 想改这里的尺寸同步逻辑，先看清楚下面尺寸状态那一节的注释。
 */

type FormatValue = 'webp' | 'jpeg' | 'png'

interface Size {
  width: number
  height: number
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** 预览图上八个拖拽手柄的位置与光标 */
const HANDLES: { key: ResizeHandle; className: string; cursor: string }[] = [
  { key: 'nw', className: '-top-1 -left-1', cursor: 'nwse-resize' },
  { key: 'n', className: '-top-1 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { key: 'ne', className: '-top-1 -right-1', cursor: 'nesw-resize' },
  { key: 'e', className: '-right-1 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { key: 'se', className: '-bottom-1 -right-1', cursor: 'nwse-resize' },
  { key: 's', className: '-bottom-1 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { key: 'sw', className: '-bottom-1 -left-1', cursor: 'nesw-resize' },
  { key: 'w', className: '-left-1 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
]

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

/** 按拖动中点等比缩放，用来保持宽高比 */
function fitAroundPoint(source: Size, targetW: number, targetH: number): Size {
  const byW: Size = { width: targetW, height: Math.max(1, Math.round((targetW * source.height) / source.width)) }
  const byH: Size = { width: Math.max(1, Math.round((targetH * source.width) / source.height)), height: targetH }
  // 取面积较大的那个，避免在极端比例下缩过头
  return byW.width * byW.height >= byH.width * byH.height ? byW : byH
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
  const [error, setError] = useState('')
  /** 预览看的是原图还是转换结果 */
  const [view, setView] = useState<'before' | 'after'>('after')
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 转换效果的预览容器，拖拽手柄按它的尺寸换算 */
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    handle: ResizeHandle
    startX: number
    startY: number
    startW: number
    startH: number
    scale: number
  } | null>(null)
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

  const applyFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        showToast('只能处理图片文件', 'error')
        return
      }
      const url = URL.createObjectURL(file)
      try {
        const img = await loadImage(url)
        setSource({
          file,
          url,
          width: img.naturalWidth,
          height: img.naturalHeight,
          size: file.size,
        })
        setTargetKb('')
        // 换图时尺寸回到「原图」，否则会拿上一张的尺寸去套新图
        setWidth(img.naturalWidth)
        setHeight(img.naturalHeight)
        setView('after')
        setError('')
      } catch {
        URL.revokeObjectURL(url)
        setError('这张图解码失败，换一个文件试试')
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
   * 输出尺寸以 width / height 两个像素数为准（不是百分比），上面三条入口
   * 最终都落到这里：拖拽手柄给的是绝对像素、输入框给的是单边像素、
   * 预设按钮算完也是像素。所以「原图」在这里没有专属状态，回到原图只是
   * 把这两个数写回源图尺寸。下面从 width / height 反推一份百分比，只用于显示。 */
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
    // 所以刻意不放进依赖 —— 否则拖拽时每一帧都要重算一遍
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // 起手和收尾都记一下，中途参数变化不会污染拖拽基准
  useEffect(() => {
    if (resizing) dragRef.current = null
  }, [resizing])

  const onHandleDown = (handle: ResizeHandle) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!source) return
    const box = stageRef.current
    const img = box?.querySelector('img') as HTMLImageElement | null
    if (!img) return
    event.preventDefault()
    event.stopPropagation()
    // 预览图被 max-width / max-height 缩过，手柄走的是显示像素，得换算回真实像素。
    // 用 src 比对而不是取第一张图：切到「原图」时页面上第一张是源图，比例不一样
    const rect = img.getBoundingClientRect()
    const displayScale = rect.width / Math.max(1, targetWidth) || 1
    dragRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startW: targetWidth,
      startH: targetHeight,
      scale: displayScale,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }

  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || !source) return
    const dx = (event.clientX - drag.startX) / drag.scale
    const dy = (event.clientY - drag.startY) / drag.scale
    const origin: Size = { width: source.width, height: source.height }
    // 东西向手柄不动高度，南北向不动宽度，再按锁比例决定另一边跟不跟
    const wantsWidth = drag.handle !== 'n' && drag.handle !== 's'
    const wantsHeight = drag.handle !== 'e' && drag.handle !== 'w'
    const wSign = drag.handle.includes('w') ? -1 : 1
    const hSign = drag.handle.includes('n') ? -1 : 1
    const nextW = wantsWidth ? Math.max(1, drag.startW + dx * wSign) : drag.startW
    const nextH = wantsHeight ? Math.max(1, drag.startH + dy * hSign) : drag.startH

    if (lockRatio) {
      // 保持比例时给一个偏斜：单边手柄按那一边定，角手柄取位移更明显的那个方向
      let target: Size
      if (!wantsWidth) target = fitAroundPoint(origin, 0, nextH)
      else if (!wantsHeight) target = fitAroundPoint(origin, nextW, 0)
      else if (Math.abs(dx) >= Math.abs(dy)) target = fitAroundPoint(origin, nextW, 0)
      else target = fitAroundPoint(origin, 0, nextH)
      setSize(target.width, target.height)
      return
    }
    setSize(nextW, nextH)
  }

  const onHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /* ---------------- 转换：尺寸 / 画质 / 格式一变就重算 ---------------- */
  useEffect(() => {
    if (!source) {
      setResult(null)
      return
    }
    let cancelled = false
    // 拖拽手柄时不防抖，交给 requestAnimationFrame 节流，手感才跟手
    const delay = resizing ? 0 : 160
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
  }, [source, format, quality, targetWidth, targetHeight, bgColor, targetKb, resizing, activeFormat])

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

  // 正数是变小，负数是变大
  const savedRatio = source && result ? Math.round((1 - result.size / source.size) * 100) : null

  return (
    <ToolShell
      icon={FileImage}
      title="图片转换"
      subtitle="PNG / JPEG / WebP 互转，画质与尺寸随手调"
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
      {error && (
        <ToolNotice tone="error" icon={FileWarning}>
          {error}
        </ToolNotice>
      )}

      <div
        className="tool-cascade flex-1 grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-4 items-start"
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
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
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className={`m-4 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-10 px-6 transition-colors ${
                  dragging
                    ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/50 dark:bg-brand-500/10'
                    : 'border-slate-200 dark:border-dark-border hover:border-brand-300 hover:bg-slate-50/60 dark:hover:bg-dark-hover/40'
                }`}
              >
                <span className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center">
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

        {/* ---------------- 预览与体积对比 ---------------- */}
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
                  {/* 拖拽手柄挂在「转换后」这层，切到原图时顺手切回来，免得手柄消失让人以为坏了 */}
                  <Segmented
                    value={view}
                    options={[
                      { value: 'before', label: '原图' },
                      { value: 'after', label: '拖拽改尺寸' },
                    ]}
                    onChange={(next) => {
                      if (next !== 'after') return
                      setView('after')
                    }}
                    className="mr-1"
                  />
                  <Tooltip content="复制图片（PNG）">
                    <button
                      onClick={() => void copyImage()}
                      disabled={!result}
                      className={iconButtonClass('brand')}
                    >
                      <Copy size={15} />
                    </button>
                  </Tooltip>
                </>
              ) : null
            }
          />

          <div
            ref={stageRef}
            className="relative p-6 min-h-[280px] flex items-center justify-center bg-slate-50/50 dark:bg-dark-bg/30"
          >
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
                <div className="relative inline-flex">
                  <img
                    src={result.url}
                    alt="转换结果"
                    draggable={false}
                    className="max-w-full max-h-[340px] object-contain rounded-lg shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/60 select-none"
                  />
                  {/* 拖四角四边改尺寸，改的是输出尺寸 */}
                  <div className="absolute inset-0">
                    <span className="absolute inset-0 rounded-lg ring-2 ring-brand-500/60 pointer-events-none" />
                    {HANDLES.map((handle) => (
                      <div
                        key={handle.key}
                        onPointerDown={onHandleDown(handle.key)}
                        onPointerMove={onHandleMove}
                        onPointerUp={onHandleUp}
                        onPointerCancel={onHandleUp}
                        style={{ cursor: handle.cursor, touchAction: 'none' }}
                        className={`absolute w-2.5 h-2.5 rounded-full bg-white border-2 border-brand-500 shadow-sm ${handle.className}`}
                      />
                    ))}
                    <span className="absolute left-1/2 -translate-x-1/2 -top-8 px-2 py-0.5 rounded-md bg-slate-900/85 text-white text-[11px] font-semibold tabular-nums whitespace-nowrap opacity-0 group-hover/stage:opacity-100">
                      {targetWidth} × {targetHeight}
                    </span>
                  </div>
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
                {formatBytes(source.size)} → {result ? formatBytes(result.size) : '…'}
              </span>
              {Number(targetKb) > 0 && result && result.size > Number(targetKb) * 1024 ? (
                <ToolTag tone="amber">已压到极限，未达目标</ToolTag>
              ) : savedRatio !== null ? (
                <ToolTag tone={savedRatio >= 0 ? 'emerald' : 'amber'}>
                  {savedRatio >= 0 ? `体积 -${savedRatio}%` : `体积 +${Math.abs(savedRatio)}%`}
                </ToolTag>
              ) : null}
            </ToolCardFooter>
          )}
        </ToolCard>
      </div>

      {/* 底部动作条 */}
      <ToolActionBar
        info={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Maximize2 size={13} className="text-brand-500" />
              预览图上拖四角或四边即可改尺寸
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
        <button onClick={download} disabled={!result} className={BTN.primary}>
          <Download size={14} />
          <span>导出图片</span>
        </button>
      </ToolActionBar>
    </ToolShell>
  )
}
