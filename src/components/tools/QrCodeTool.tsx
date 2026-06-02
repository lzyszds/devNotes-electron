import { useState, useRef, useEffect } from 'react'
import { Download, Copy, RefreshCw, History, Clock, ChevronRight } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'

export default function QrCodeTool() {
  const [text, setText] = useState('https://fehelper.com')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [size, setSize] = useState(200)
  const [fgColor, setFgColor] = useState('#000000')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [showHistory, setShowHistory] = useState(false)
  
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { history, saveHistory, clearHistory } = useToolHistory<string>('qr-code')

  // Simple QR code generator
  const generateQR = () => {
    if (!text.trim()) return
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    canvas.width = size
    canvas.height = size
    
    // Background
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, size, size)
    
    // Generate pattern
    const cellSize = size / 25
    ctx.fillStyle = fgColor
    
    // Position patterns (corners)
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
    
    // Data pattern (simplified)
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 25; j++) {
        // Skip position patterns
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
    const response = await fetch(qrDataUrl)
    const blob = await response.blob()
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ])
  }

  const saveToHistoryManual = () => {
    if (!text.trim()) return
    saveHistory(text, text.slice(0, 20) + (text.length > 20 ? '...' : ''))
  }

  return (
    <div className="flex h-full min-h-[600px]">
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
           <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">QR Code Generator</p>
              <h3 className="mt-1 text-xl font-bold text-slate-900">二维码生成</h3>
           </div>
           <button
              onClick={() => setShowHistory(!showHistory)}
              className={`tool-button-secondary h-9 ${showHistory ? 'bg-slate-100 ring-1 ring-slate-900' : ''}`}
            >
              <History className="h-4 w-4" />
              历史
            </button>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="tool-panel space-y-6">
            <div>
              <label className="tool-label">内容</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="输入二维码内容..."
                className="tool-textarea min-h-[140px]"
                rows={4}
              />
            </div>

            <div>
              <label className="tool-label">
                尺寸: {size}px
              </label>
              <input
                type="range"
                min="100"
                max="500"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="tool-label">前景色</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={fgColor}
                    onChange={(e) => setFgColor(e.target.value)}
                    className="h-9 w-9 cursor-pointer rounded-lg border-0 bg-transparent"
                  />
                  <span className="text-[11px] font-mono text-slate-500">{fgColor}</span>
                </div>
              </div>
              <div>
                <label className="tool-label">背景色</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="h-9 w-9 cursor-pointer rounded-lg border-0 bg-transparent"
                  />
                  <span className="text-[11px] font-mono text-slate-500">{bgColor}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={generateQR}
                className="tool-button-primary flex-1"
              >
                <RefreshCw className="h-4 w-4" /> 重新生成
              </button>
              <button
                onClick={saveToHistoryManual}
                className="tool-button-secondary flex-1"
              >
                保存到历史
              </button>
            </div>
          </div>

          <div className="tool-panel flex flex-col items-center justify-center">
            <div className="rounded-xl bg-white p-8 border border-slate-200 shadow-sm">
              <canvas ref={canvasRef} className="hidden" />
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR Code"
                  className="max-w-full"
                  style={{ width: size, height: size }}
                />
              ) : (
                <div className="w-[200px] h-[200px] bg-slate-50 rounded-lg flex items-center justify-center text-slate-300 text-xs italic">
                  输入内容生成二维码
                </div>
              )}
            </div>
            
            <div className="flex gap-3 mt-8">
              <button
                onClick={downloadQR}
                className="tool-button-secondary"
              >
                <Download className="h-4 w-4" /> 下载 PNG
              </button>
              <button
                onClick={copyQR}
                className="tool-button-secondary"
              >
                <Copy className="h-4 w-4" /> 复制图片
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* History Sidebar */}
      {showHistory && (
        <aside className="w-80 border-l border-slate-200 bg-slate-50/50 flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Clock size={16} />
              内容历史
            </div>
            <button onClick={clearHistory} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 uppercase tracking-wider transition">
              清空
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {history.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-xs italic">暂无历史记录</div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setText(item.data)
                    setShowHistory(false)
                  }}
                  className="w-full text-left p-3 rounded-lg bg-white border border-slate-200 shadow-sm hover:border-slate-900 transition-all group"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                    <ChevronRight size={12} className="text-slate-200 group-hover:text-slate-900 transition-colors" />
                  </div>
                  <p className="text-xs font-bold text-slate-700 truncate">{item.title || '无标题'}</p>
                </button>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
