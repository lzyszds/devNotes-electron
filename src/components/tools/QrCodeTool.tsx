import { useState, useRef, useEffect } from 'react'
import { Copy, Download, History, Move, Palette, QrCode, RefreshCw, Type } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import {
  BTN,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolHistoryOverlay,
  ToolShell,
  ToolTag,
  iconButtonClass,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'

export default function QrCodeTool() {
  const [text, setText] = useState('https://fehelper.com')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [size, setSize] = useState(240)
  const [fgColor, setFgColor] = useState('#000000')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [showHistory, setShowHistory] = useState(false)
  const { showToast } = useToast()

  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>('qr-code')
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setText(item.data)
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  // 简易二维码绘制：定位图案 + 按内容散列的伪数据点
  const generateQR = () => {
    if (!text.trim()) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = size
    canvas.height = size

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, size, size)

    const cellSize = size / 25
    ctx.fillStyle = fgColor

    const drawPositionPattern = (x: number, y: number) => {
      ctx.fillRect(x, y, 7 * cellSize, 7 * cellSize)
      ctx.fillStyle = bgColor
      ctx.fillRect(x + cellSize, y + cellSize, 5 * cellSize, 5 * cellSize)
      ctx.fillStyle = fgColor
      ctx.fillRect(x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize)
    }

    drawPositionPattern(0, 0)
    drawPositionPattern(18 * cellSize, 0)
    drawPositionPattern(0, 18 * cellSize)

    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 25; j++) {
        if ((i < 7 && j < 7) || (i < 7 && j > 17) || (i > 17 && j < 7)) continue
        const hash = (text.charCodeAt((i * 3 + j) % text.length) || 0) + i * 7 + j * 13
        if (hash % 2 === 0) {
          ctx.fillRect(j * cellSize, i * cellSize, cellSize, cellSize)
        }
      }
    }
    setQrDataUrl(canvas.toDataURL('image/png'))
  }

  useEffect(() => {
    generateQR()
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
      subtitle="快速生成可自定义样式的二维码"
      badge={
        <ToolBadge tone="brand">
          {size} × {size} px
        </ToolBadge>
      }
      actions={
        <>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`tool-button-secondary h-9 ${
              showHistory
                ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400'
                : ''
            }`}
          >
            <History size={15} />
            <span>生成历史</span>
          </button>
          <button onClick={downloadQR} disabled={!qrDataUrl} className="tool-button-primary h-9 px-5">
            <Download size={15} />
            <span>导出图片</span>
          </button>
        </>
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="历史内容库"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setText(item.data)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
        />
      }
    >
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
            meta={<ToolTag tone="emerald">{size} × {size} px</ToolTag>}
            actions={
              <Tooltip content="复制图片">
                <button
                  type="button"
                  onClick={() => void copyQR()}
                  disabled={!qrDataUrl}
                  className={iconButtonClass('brand')}
                >
                  <Copy size={15} />
                </button>
              </Tooltip>
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

      {/* 底部动作条 */}
      <ToolActionBar info="改内容或参数会即时重绘；这里生成的图案仅供占位示意">
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
    </ToolShell>
  )
}
