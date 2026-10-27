import { useState, useRef, useEffect } from 'react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import {
  Download,
  FileWarning,
  History,
  ImageUp,
  Move,
  Palette,
  QrCode,
  RefreshCw,
  ScanLine,
  Type,
  X,
} from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import {
  BTN,
  META,
  Segmented,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolHistoryOverlay,
  ToolNotice,
  ToolShell,
  CopyButton,
  CopyImageButton,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'

type Mode = 'generate' | 'decode'

/** 解码结果：正文 + 二维码版本 + 是否用了反转色 */
interface DecodedInfo {
  data: string
  version: number
}

export default function QrCodeTool() {
  const [mode, setMode] = useState<Mode>('generate')
  const [text, setText] = useState('https://fehelper.com')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrError, setQrError] = useState('')
  const [size, setSize] = useState(240)
  const [fgColor, setFgColor] = useState('#000000')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [showHistory, setShowHistory] = useState(false)
  const { showToast } = useToast()

  /* ---------------- 解码状态 ---------------- */
  /** 待解码的图片，用 objectURL 预览；解码完 revoke 掉防止内存泄漏 */
  const [decodePreview, setDecodePreview] = useState('')
  const [decoded, setDecoded] = useState<DecodedInfo | null>(null)
  const [decodeError, setDecodeError] = useState('')
  const [decoding, setDecoding] = useState(false)
  const [dragging, setDragging] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef('')

  /** 换图时释放上一张的 objectURL，否则每解一张就漏一份内存 */
  const replacePreview = (url: string) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = url
    setDecodePreview(url)
  }

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    [],
  )

  /**
   * 解码一张图片。
   *
   * 走 Image + canvas 取原始像素：jsQR 要的是 Uint8ClampedArray 的 RGBA 数据，
   * 不能直接吃 File。
   *
   * inversionAttempts 用 attemptBoth：深色底 + 浅色码（反色二维码）在截图里
   * 很常见，只试正色会漏掉一整类输入。代价是每个码多算一遍。
   */
  const decodeFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setDecodeError('请选择图片文件')
      return
    }

    setDecoding(true)
    setDecoded(null)
    setDecodeError('')
    replacePreview(URL.createObjectURL(file))

    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('无法创建画布上下文')
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      })

      if (!result) {
        setDecodeError('没识别出二维码。换张更清晰、更正的图，或裁掉多余留白再试')
        return
      }
      setDecoded({ data: result.data, version: result.version })
    } catch (err) {
      setDecodeError('图片读取失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setDecoding(false)
    }
  }

  const clearDecode = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = ''
    }
    setDecodePreview('')
    setDecoded(null)
    setDecodeError('')
  }

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>('qr-code')
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setText(item.data)
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  /**
   * 真正生成二维码。
   *
   * 走 qrcode 库的 toCanvas：它做完整的 QR 编码（数据分块、GF(256) 里德-所罗门
   * 纠错、掩模评估、格式信息）。早先这里是照着二维码长相手绘的散列占位图案，
   * 不含纠错码，扫不出来 —— 别再改回手绘。
   *
   * 颜色经 toDataURL 传给库：库内部用 canvas 画，靠这两个字段定前景/背景。
   */
  const generateQR = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!text.trim()) {
      setQrDataUrl('')
      setQrError('')
      return
    }

    try {
      // margin 4 是规范要求的最小静默区，小于它很多扫码器识别不了
      await QRCode.toCanvas(canvas, text, {
        width: size,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: fgColor, light: bgColor },
      })
      setQrDataUrl(canvas.toDataURL('image/png'))
      setQrError('')
    } catch (err) {
      // 内容超出二维码容量上限时会抛错，别让整页白屏
      const message = err instanceof Error ? err.message : String(err)
      setQrDataUrl('')
      setQrError(/code length overflow|too long/i.test(message) ? '内容太长，超出二维码容量上限' : '生成失败：' + message)
    }
  }

  useEffect(() => {
    void generateQR()
  }, [text, size, fgColor, bgColor])

  const downloadQR = () => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = 'qrcode.png'
    a.click()
  }

  const copyQR = async () => {
    if (!qrDataUrl) return
    try {
      const blob = await (await fetch(qrDataUrl)).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      showToast('已复制二维码图片')
    } catch {
      showToast('复制失败', 'error')
    }
  }

  const saveToHistoryManual = () => {
    if (!text.trim()) return
    saveHistory(text, text.slice(0, 30) + '...')
    showToast('已收藏到历史记录')
  }

  return (
    <ToolShell
      icon={QrCode}
      title="二维码工作台"
      subtitle={mode === 'generate' ? '快速生成可自定义样式的二维码' : '从图片里识别二维码内容'}
      rail={
        <div className="flex items-center gap-3 w-full">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'generate' as const, label: '生成', icon: QrCode },
              { value: 'decode' as const, label: '解码', icon: ScanLine },
            ]}
          />
          <span className={META}>
            {mode === 'generate' ? '输入内容与配色，即时出图' : '上传截图或图片，识别其中的二维码'}
          </span>
        </div>
      }
      badge={
        mode === 'generate' ? (
          <ToolBadge tone="brand">
            {size} × {size} px
          </ToolBadge>
        ) : undefined
      }
      actions={
        mode === 'generate' ? (
          <>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`tool-button-secondary h-8 ${
                showHistory
                  ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400'
                  : ''
              }`}
            >
              <History size={15} />
              <span>生成历史</span>
            </button>
            <button onClick={downloadQR} disabled={!qrDataUrl} className="tool-button-primary h-8 px-5">
              <Download size={15} />
              <span>导出图片</span>
            </button>
          </>
        ) : undefined
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="历史内容库"
          items={history}
          onClear={clearHistory}
          onDelete={removeHistoryItem}
          onPick={(item) => {
            setText(item.data)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
        />
      }
    >
      {mode === 'decode' ? (
        <div className="tool-cascade flex-1 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4 items-start">
          {/* ---------------- 上传区 ---------------- */}
          <ToolCard fill={false}>
            <ToolCardHeader
              title="二维码图片"
              icon={ImageUp}
              meta="PNG / JPG / WebP"
              actions={
                decodePreview ? (
                  <button
                    type="button"
                    onClick={clearDecode}
                    title="移除图片"
                    className="text-slate-400 hover:text-rose-500 dark:hover:text-rose-400"
                  >
                    <X size={14} />
                  </button>
                ) : undefined
              }
            />

            <div className="p-4">
              {decodePreview ? (
                <div className="flex items-center justify-center bg-slate-50/50 dark:bg-dark-bg/30 rounded-xl p-4">
                  <img
                    src={decodePreview}
                    alt="待解码的二维码"
                    className="max-w-full max-h-[280px] rounded-lg bg-white ring-1 ring-slate-200/60"
                  />
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) void decodeFile(file)
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-12 cursor-pointer transition-colors ${
                    dragging
                      ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/50 dark:bg-brand-500/10'
                      : 'border-slate-200 dark:border-dark-border hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void decodeFile(file)
                      // 清 value，否则连续选同一张图不再触发 change
                      e.target.value = ''
                    }}
                  />
                  <ScanLine size={24} className="text-slate-300 dark:text-slate-600" />
                  <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    拖入图片，或点击选择
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-600">
                    支持反色二维码，会同时尝试正反两种
                  </p>
                </div>
              )}
            </div>
          </ToolCard>

          {/* ---------------- 解码结果 ---------------- */}
          <ToolCard fill={false}>
            <ToolCardHeader
              title="识别结果"
              sublabel="DECODED"
              meta={decoded ? `版本 ${decoded.version}` : undefined}
              actions={<CopyButton value={() => decoded?.data ?? ''} disabled={!decoded} />}
            />

            <div className="p-4">
              {decodeError ? (
                <ToolNotice tone="error" icon={FileWarning}>
                  {decodeError}
                </ToolNotice>
              ) : decoding ? (
                <p className={`${META} py-8 text-center`}>正在识别…</p>
              ) : decoded ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/10 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    识别成功
                  </div>
                  <div className="max-h-[240px] overflow-y-auto rounded-lg bg-slate-50/70 dark:bg-dark-hover/40 px-3 py-2 font-mono text-[12px] leading-6 text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-all select-text">
                    {decoded.data}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={META}>{decoded.data.length} 字符</span>
                    {/* 内容是 URL 时给个直达入口，省得手动复制 */}
                    {/^https?:\/\//i.test(decoded.data) && (
                      <button
                        type="button"
                        onClick={() => window.electronAPI?.openExternal?.(decoded.data)}
                        className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        在浏览器中打开
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <ScanLine size={24} className="text-slate-200 dark:text-slate-700" />
                  <p className={META}>识别出的内容会显示在这里</p>
                </div>
              )}
            </div>
          </ToolCard>
        </div>
      ) : (
        <>
          {qrError && (
            <ToolNotice tone="error" icon={FileWarning}>
              {qrError}
            </ToolNotice>
          )}

          <div className="tool-cascade flex-1 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4 items-start">
        {/* ---------------- 内容与参数 ---------------- */}
        <div className="space-y-4">
          <ToolCard fill={false}>
            <ToolCardHeader title="二维码内容" icon={Type} meta="URL / 文本" />

            <div className="p-4 flex flex-col">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="输入需要转换成二维码的内容…"
                className="w-full min-h-[120px] bg-transparent resize-none outline-none text-[13px] leading-6 text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600"
              />
            </div>

            <ToolCardFooter>
              <span className="font-mono">{text.length} 字符</span>
            </ToolCardFooter>
          </ToolCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 尺寸 */}
            <ToolCard fill={false}>
              <ToolCardHeader title="尺寸规格" icon={Move} />

              <div className="p-4 flex flex-col gap-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[28px] font-semibold text-slate-900 dark:text-white tabular-nums leading-none">
                    {size}
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">像素</span>
                </div>
                <input
                  type="range"
                  min="120"
                  max="500"
                  step="20"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  className="tool-range"
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500">120 ~ 500 px，步进 20</p>
              </div>
            </ToolCard>

            {/* 配色 */}
            <ToolCard fill={false}>
              <ToolCardHeader title="外观配色" icon={Palette} />

              <div className="p-4 flex flex-col gap-2.5">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 pl-2.5 pr-3 py-2 cursor-pointer">
                  <span className="flex items-center gap-2.5">
                    <input
                      type="color"
                      value={fgColor}
                      onChange={(e) => setFgColor(e.target.value)}
                      className="w-7 h-7 rounded-lg border-0 bg-transparent cursor-pointer p-0"
                    />
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">前景色</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">{fgColor}</span>
                </label>

                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 pl-2.5 pr-3 py-2 cursor-pointer">
                  <span className="flex items-center gap-2.5">
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="w-7 h-7 rounded-lg border-0 bg-transparent cursor-pointer p-0"
                    />
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">背景色</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">{bgColor}</span>
                </label>
              </div>
            </ToolCard>
          </div>
        </div>

        {/* ---------------- 预览 ---------------- */}
        <ToolCard fill={false}>
          <ToolCardHeader
            title="预览"
            // meta 自带一层灰底，只能传纯文本；套 ToolTag 会双层叠色
            meta={`${size} × ${size} px`}
            actions={
              <CopyImageButton onClick={() => void copyQR()} disabled={!qrDataUrl} />
            }
          />

          <div className="p-6 flex items-center justify-center bg-slate-50/50 dark:bg-dark-bg/30 rounded-b-2xl">
            <div className="rounded-xl overflow-hidden bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/60">
              <canvas ref={canvasRef} className="hidden" />
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR Code"
                  className="max-w-full block"
                  style={{ width: size, height: size }}
                />
              ) : (
                <div
                  className="flex items-center justify-center bg-white"
                  style={{ width: size, height: size }}
                >
                  <QrCode size={48} className="text-slate-100 animate-pulse" />
                </div>
              )}
            </div>
          </div>
        </ToolCard>
          </div>
        </>
      )}

      {/* 底部动作条 */}
      {mode === 'generate' ? (
        <ToolActionBar info="改内容或颜色会即时重绘；含纠错码，可直接扫码使用">
          <Tooltip content="把当前内容收藏到历史记录">
            <button onClick={saveToHistoryManual} disabled={!text.trim()} className={BTN.secondary}>
              <History size={14} />
              <span>收藏内容</span>
            </button>
          </Tooltip>
          <button onClick={generateQR} className={BTN.secondary}>
            <RefreshCw size={14} />
            <span>重新生成</span>
          </button>
        </ToolActionBar>
      ) : (
        <ToolActionBar info="识别在本机完成，图片不会上传到任何服务器">
          {decodePreview && (
            <button onClick={clearDecode} className={BTN.secondary}>
              <X size={14} />
              <span>换一张</span>
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className={BTN.primary}
          >
            <ImageUp size={14} />
            <span>{decodePreview ? '重新选择图片' : '选择图片'}</span>
          </button>
        </ToolActionBar>
      )}
    </ToolShell>
  )
}
