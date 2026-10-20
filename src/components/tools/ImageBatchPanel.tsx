import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  FileWarning,
  Layers,
  Loader2,
  Package,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import {
  BTN,
  META,
  SECTION_LABEL,
  Segmented,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolNotice,
  ToolTag,
  iconButtonClass,
  type SegmentOption,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import {
  canvasToBlob,
  encodeUnderTarget,
  fitToLongEdge,
  formatBytes,
  listEncodableFormats,
  loadImage,
  type FormatValue,
  type ImageFormat,
  type Size,
} from '../../utils/imageConvertCore'
import { bundleZip, downloadBlob, type BundleEntry } from '../../utils/zipBundle'
import { setToolBusy } from '../../utils/toolTabs'

type BatchStatus = 'idle' | 'working' | 'done' | 'error'

interface BatchResult {
  blob: Blob
  width: number
  height: number
  ext: string
}

interface BatchItem {
  id: string
  file: File
  /** 原图的 object URL，用于缩略图与解码 */
  url: string
  width: number
  height: number
  status: BatchStatus
  result?: BatchResult
  error?: string
}

/** 长边上限：'0' 表示保持原尺寸。只缩不放，比上限小的图保持原样 */
const LONG_EDGE_OPTIONS: SegmentOption<string>[] = [
  { value: '0', label: '原尺寸' },
  { value: '1920', label: '1920' },
  { value: '1280', label: '1280' },
  { value: '1080', label: '1080' },
  { value: '750', label: '750' },
  { value: '512', label: '512' },
]

interface ConvertOptions {
  format: ImageFormat
  quality: number
  targetKb: number
  bgColor: string
  longEdge: number
}

function newId() {
  return Math.random().toString(36).slice(2, 10)
}

function baseNameOf(file: File) {
  return file.name.replace(/\.[^.]+$/, '') || 'image'
}

/** 单张转换：与单图工具同一套换算，只是参数来自批量面板自己的设置 */
async function convertOne(item: BatchItem, opts: ConvertOptions): Promise<BatchResult> {
  const img = await loadImage(item.url)
  const origin: Size = { width: item.width, height: item.height }
  const target =
    opts.longEdge > 0 && Math.max(origin.width, origin.height) > opts.longEdge
      ? fitToLongEdge(origin, opts.longEdge)
      : origin

  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境拿不到画布')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (!opts.format.alpha) {
    ctx.fillStyle = opts.bgColor
    ctx.fillRect(0, 0, target.width, target.height)
  }
  ctx.drawImage(img, 0, 0, target.width, target.height)

  let blob: Blob
  if (opts.format.lossy && opts.targetKb > 0) {
    blob = (await encodeUnderTarget(canvas, opts.format.mime, opts.targetKb * 1024, opts.quality)).blob
  } else {
    blob = await canvasToBlob(
      canvas,
      opts.format.mime,
      opts.format.lossy ? opts.quality / 100 : undefined,
    )
  }
  // 体积目标可能把画布再缩过，所以尺寸以画布实际值为准
  return { blob, width: canvas.width, height: canvas.height, ext: opts.format.ext }
}

function StatusTag({ item }: { item: BatchItem }) {
  if (item.status === 'working') {
    return (
      <ToolTag tone="brand">
        <Loader2 size={11} className="animate-spin" />
        转换中
      </ToolTag>
    )
  }
  if (item.status === 'done' && item.result) {
    const saved = Math.round((1 - item.result.blob.size / item.file.size) * 100)
    return (
      <ToolTag tone={saved >= 0 ? 'emerald' : 'amber'}>
        {saved >= 0 ? `-${saved}%` : `+${Math.abs(saved)}%`}
      </ToolTag>
    )
  }
  if (item.status === 'error') return <ToolTag tone="amber">失败</ToolTag>
  return <ToolTag tone="slate">待转换</ToolTag>
}

function BatchRow({
  item,
  locked,
  onDownload,
  onRemove,
}: {
  item: BatchItem
  locked: boolean
  onDownload: () => void
  onRemove: () => void
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200/60 dark:bg-dark-bg/40 dark:ring-dark-border">
        <img src={item.url} alt="" className="max-h-full max-w-full object-contain" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">
          {item.file.name}
        </p>
        <p className={`${META} mt-0.5 font-mono tabular-nums`}>
          {item.width} × {item.height} · {formatBytes(item.file.size)}
          {item.result && ` → ${item.result.width} × ${item.result.height} · ${formatBytes(item.result.blob.size)}`}
        </p>
        {item.error && (
          <p className="mt-0.5 truncate text-[11px] text-rose-500 dark:text-rose-400" title={item.error}>
            {item.error}
          </p>
        )}
      </div>

      <StatusTag item={item} />

      <div className="flex shrink-0 items-center gap-0.5">
        {item.status === 'done' && (
          <Tooltip content="下载这张">
            <button onClick={onDownload} className={iconButtonClass('brand')}>
              <Download size={15} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="移除">
          <button onClick={onRemove} disabled={locked} className={iconButtonClass('danger')}>
            <X size={15} />
          </button>
        </Tooltip>
      </div>
    </li>
  )
}

/**
 * 批量转换：一次挑多张图，用同一套格式 / 画质 / 体积 / 长边设置逐张转换，
 * 结果可以逐张下载，也可以打成一个 zip。转换按顺序进行，避免同时解码太多大图撑爆内存。
 */
export default function ImageBatchPanel() {
  const { showToast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<BatchItem[]>([])
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [format, setFormat] = useState<FormatValue>('webp')
  const [quality, setQuality] = useState(90)
  const [targetKb, setTargetKb] = useState('')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [longEdge, setLongEdge] = useState('0')

  // 批量转换期间，图片转换的标签亮绿点
  useEffect(() => {
    setToolBusy('image-convert', running)
    return () => setToolBusy('image-convert', false)
  }, [running])

  const encodable = useMemo(() => listEncodableFormats(), [])
  const formatOptions: SegmentOption<FormatValue>[] = useMemo(
    () => encodable.map((item) => ({ value: item.value, label: item.label })),
    [encodable],
  )
  const activeFormat = encodable.find((item) => item.value === format) ?? encodable[0]

  useEffect(() => {
    if (encodable.length && !encodable.some((item) => item.value === format)) {
      setFormat(encodable[0].value)
    }
  }, [encodable, format])

  // 组件卸载时释放所有 object URL
  const itemsRef = useRef<BatchItem[]>([])
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  useEffect(
    () => () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url))
    },
    [],
  )

  const addFiles = async (files: File[]) => {
    const accepted = files.filter((file) => file.type.startsWith('image/') || /\.svg$/i.test(file.name))
    if (accepted.length === 0) {
      showToast('只能处理图片文件', 'error')
      return
    }
    const loaded = await Promise.all(
      accepted.map(async (file): Promise<BatchItem | null> => {
        const url = URL.createObjectURL(file)
        try {
          const img = await loadImage(url)
          return {
            id: newId(),
            file,
            url,
            width: img.naturalWidth || 1024,
            height: img.naturalHeight || 1024,
            status: 'idle',
          }
        } catch {
          URL.revokeObjectURL(url)
          return null
        }
      }),
    )
    const ok = loaded.filter((item): item is BatchItem => item !== null)
    if (ok.length > 0) setItems((prev) => [...prev, ...ok])
    const failed = accepted.length - ok.length
    if (failed > 0) showToast(`${failed} 张图片解码失败，已跳过`, 'error')
  }

  const removeItem = (id: string) => {
    const target = items.find((item) => item.id === id)
    if (target) URL.revokeObjectURL(target.url)
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  const clearAll = () => {
    items.forEach((item) => URL.revokeObjectURL(item.url))
    setItems([])
  }

  const patchItem = (id: string, patch: Partial<BatchItem>) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  const runAll = async () => {
    if (running || items.length === 0 || !activeFormat) return
    const ids = items.map((item) => item.id)
    const opts: ConvertOptions = {
      format: activeFormat,
      quality,
      targetKb: Number(targetKb) || 0,
      bgColor,
      longEdge: Number(longEdge),
    }
    setRunning(true)
    setItems((prev) =>
      prev.map((item) => ({ ...item, status: 'idle', result: undefined, error: undefined })),
    )

    let succeeded = 0
    for (const id of ids) {
      const item = itemsRef.current.find((entry) => entry.id === id)
      if (!item) continue
      patchItem(id, { status: 'working' })
      try {
        const result = await convertOne(item, opts)
        patchItem(id, { status: 'done', result })
        succeeded += 1
      } catch (err) {
        patchItem(id, {
          status: 'error',
          error: err instanceof Error ? err.message : '转换失败',
        })
      }
    }
    setRunning(false)
    showToast(`转换完成：${succeeded} / ${ids.length} 张`)
  }

  const doneItems = items.filter((item) => item.status === 'done' && item.result)

  const downloadOne = (item: BatchItem) => {
    if (!item.result) return
    downloadBlob(item.result.blob, `${baseNameOf(item.file)}.${item.result.ext}`)
  }

  const downloadZip = async () => {
    if (doneItems.length === 0) return
    // 同名文件（比如两个目录下都有 logo.png）加序号，避免 zip 里互相覆盖
    const used = new Map<string, number>()
    const entries: BundleEntry[] = doneItems.map((item) => {
      const result = item.result as BatchResult
      const base = baseNameOf(item.file)
      const count = used.get(base) ?? 0
      used.set(base, count + 1)
      const name = count === 0 ? base : `${base}-${count + 1}`
      return { name: `${name}.${result.ext}`, blob: result.blob }
    })
    try {
      downloadBlob(await bundleZip(entries), 'converted-images.zip')
      showToast(`已打包 ${entries.length} 张图片`)
    } catch (err) {
      showToast('打包失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    }
  }

  const totalOrigin = items.reduce((sum, item) => sum + item.file.size, 0)
  const totalOutput = doneItems.reduce((sum, item) => sum + (item.result?.blob.size ?? 0), 0)
  const doneCount = doneItems.length

  return (
    <div className="tool-cascade grid grid-cols-1 gap-4 pr-4 items-start lg:grid-cols-[minmax(0,1fr)_340px] lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
      {/* ---------------- 待转换列表 ---------------- */}
      <div
        className="min-w-0"
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (running) return
          const files = Array.from(event.dataTransfer.files ?? [])
          if (files.length > 0) void addFiles(files)
        }}
      >
        <ToolCard fill={false}>
          <ToolCardHeader
            title="待转换图片"
            icon={Layers}
            meta={items.length > 0 ? `${items.length} 张` : undefined}
            actions={
              items.length > 0 ? (
                <>
                  <button
                    onClick={() => inputRef.current?.click()}
                    disabled={running}
                    className="tool-button-secondary h-7 px-2.5 text-[11px] disabled:opacity-40"
                  >
                    <Upload size={13} />
                    <span>继续添加</span>
                  </button>
                  <Tooltip content="清空列表">
                    <button onClick={clearAll} disabled={running} className={iconButtonClass('danger')}>
                      <Trash2 size={15} />
                    </button>
                  </Tooltip>
                </>
              ) : null
            }
          />

          {items.length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              data-drag={dragging || undefined}
              className={`drop-zone m-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 ${
                dragging
                  ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/50 dark:bg-brand-500/10'
                  : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50/60 dark:border-dark-border dark:hover:bg-dark-hover/40'
              }`}
            >
              <span className="drop-zone-icon flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                <Upload size={20} />
              </span>
              <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                把多张图片拖进来，或点击选择
              </span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                可以一次选多个文件，按住 ⌘ / Ctrl 多选
              </span>
            </button>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-dark-border">
              {items.map((item) => (
                <BatchRow
                  key={item.id}
                  item={item}
                  locked={running}
                  onDownload={() => downloadOne(item)}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </ul>
          )}

          <ToolCardFooter>
            <span className="font-mono">
              {items.length > 0 ? `原始 ${formatBytes(totalOrigin)}` : '未选择图片'}
              {doneCount > 0 && ` → 输出 ${formatBytes(totalOutput)}`}
            </span>
            <span className="tabular-nums">
              {running ? `转换中 ${doneCount} / ${items.length}` : doneCount > 0 ? `已完成 ${doneCount} 张` : ''}
            </span>
          </ToolCardFooter>
        </ToolCard>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) void addFiles(files)
          // 清掉 value，否则连续选同一批文件不会再触发 change
          event.target.value = ''
        }}
      />

      {/* ---------------- 批量设置 ---------------- */}
      <div className="min-w-0 space-y-4">
        <ToolCard fill={false}>
          <ToolCardHeader title="批量设置" icon={Zap} />

          <div className="flex flex-col gap-5 p-4">
            <div className="flex flex-col gap-2">
              <span className={SECTION_LABEL}>目标格式</span>
              <Segmented value={format} options={formatOptions} onChange={setFormat} />
              {activeFormat && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">{activeFormat.hint}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className={SECTION_LABEL}>长边上限</span>
              <Segmented value={longEdge} options={LONG_EDGE_OPTIONS} onChange={setLongEdge} />
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                只缩小不放大，比上限小的图保持原样
              </p>
            </div>

            {activeFormat?.lossy && (
              <>
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
                </div>

                <div className="flex flex-col gap-2">
                  <span className={SECTION_LABEL}>目标体积</span>
                  <label className="flex cursor-text items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 py-2 pl-3 pr-2.5 dark:border-dark-border dark:bg-dark-hover/40">
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
                      onChange={(event) => setTargetKb(event.target.value)}
                      placeholder="留空表示不限制"
                      className="min-w-0 flex-1 bg-transparent text-[13px] font-medium tabular-nums text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">KB</span>
                  </label>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    每张都会单独压到这个大小以内：先降画质，还不够再缩尺寸
                  </p>
                </div>
              </>
            )}

            {activeFormat && !activeFormat.alpha && (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 py-2 pl-2.5 pr-3 dark:border-dark-border dark:bg-dark-hover/40">
                <span className="flex items-center gap-2.5">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(event) => setBgColor(event.target.value)}
                    className="h-7 w-7 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                  />
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">背景填充色</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{bgColor}</span>
              </label>
            )}

            {!activeFormat?.alpha && (
              <ToolNotice tone="info" icon={FileWarning}>
                当前格式不支持透明，透明区域会填成背景色
              </ToolNotice>
            )}

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 dark:border-dark-border">
              <button
                onClick={() => void runAll()}
                disabled={running || items.length === 0}
                className={`${BTN.primary} w-full`}
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
                <span>{running ? '转换中…' : `开始转换（${items.length} 张）`}</span>
              </button>
              <button
                onClick={() => void downloadZip()}
                disabled={running || doneCount === 0}
                className={`${BTN.secondary} w-full`}
              >
                <Package size={14} />
                <span>打包下载 ZIP{doneCount > 0 ? `（${doneCount} 张）` : ''}</span>
              </button>
              <p className={`${META} text-center`}>转换全在本机完成，不上传</p>
            </div>
          </div>
        </ToolCard>
      </div>
    </div>
  )
}
