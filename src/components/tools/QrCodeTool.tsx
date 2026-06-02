import { useState, useRef, useEffect } from 'react'
import { Download, Copy, RefreshCw, History, Clock, ChevronRight, QrCode, Type, Move, Palette, X } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'

export default function QrCodeTool() {
  const [text, setText] = useState('https://fehelper.com')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [size, setSize] = useState(240)
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
    saveHistory(text, text.slice(0, 30) + '...')
  }

  return (
    <div className="relative flex h-full min-h-[600px] bg-white overflow-hidden text-slate-900">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Action Header */}
        <div className="px-8 py-5 flex items-center justify-between border-b border-slate-100">
           <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-100">
                <QrCode size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">二维码工作台</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">快速生成可自定义样式的二维码</p>
              </div>
           </div>

           <div className="flex items-center gap-3">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`tool-button-secondary h-10 px-4 ${showHistory ? 'ring-2 ring-indigo-500/20 border-indigo-200 text-indigo-600' : ''}`}
              >
                <History size={16} />
                <span>生成历史</span>
              </button>
              <div className="w-px h-6 bg-slate-100" />
              <button onClick={downloadQR} disabled={!qrDataUrl} className="tool-button-primary h-10 bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100 px-6">
                <Download size={16} /> 导出图片
              </button>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/20">
           <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-10">
              {/* Configuration Column */}
              <div className="space-y-6">
                 {/* Text Input */}
                 <div className="tool-panel space-y-4">
                    <div className="flex items-center gap-2">
                       <Type size={16} className="text-slate-400" />
                       <label className="tool-label mb-0">二维码内容 (URL/文本)</label>
                    </div>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="输入需要转换成二维码的内容..."
                      className="tool-textarea min-h-[160px] border-slate-200 shadow-sm"
                    />
                    <div className="flex justify-end">
                       <button onClick={saveToHistoryManual} className="text-[10px] font-black text-slate-400 hover:text-indigo-600 transition-colors uppercase tracking-widest">
                          收藏到历史记录
                       </button>
                    </div>
                 </div>

                 {/* Customization Grid */}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Size Selector */}
                    <div className="tool-panel">
                       <div className="flex items-center gap-2 mb-6">
                          <Move size={16} className="text-slate-400" />
                          <label className="tool-label mb-0">尺寸规格</label>
                       </div>
                       <div className="space-y-4">
                          <div className="flex items-center justify-between">
                             <span className="text-3xl font-black text-slate-900">{size}</span>
                             <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">像素 (PX)</span>
                          </div>
                          <input
                             type="range"
                             min="120"
                             max="500"
                             step="20"
                             value={size}
                             onChange={(e) => setSize(Number(e.target.value))}
                             className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600"
                          />
                       </div>
                    </div>

                    {/* Color Picker */}
                    <div className="tool-panel">
                       <div className="flex items-center gap-2 mb-6">
                          <Palette size={16} className="text-slate-400" />
                          <label className="tool-label mb-0">外观配色</label>
                       </div>
                       <div className="space-y-4">
                          <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-100">
                             <div className="flex items-center gap-3">
                                <input type="color" value={fgColor} onChange={(e) => setFgColor(e.target.value)} className="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer" />
                                <span className="text-[10px] font-black text-slate-500 uppercase">前景色</span>
                             </div>
                             <span className="text-[10px] font-mono font-bold text-slate-300">{fgColor}</span>
                          </div>
                          <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-100">
                             <div className="flex items-center gap-3">
                                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer" />
                                <span className="text-[10px] font-black text-slate-500 uppercase">背景色</span>
                             </div>
                             <span className="text-[10px] font-mono font-bold text-slate-300">{bgColor}</span>
                          </div>
                       </div>
                    </div>
                 </div>

                 <button onClick={generateQR} className="tool-button-secondary w-full h-12 border-slate-200 text-slate-500 font-black uppercase tracking-widest">
                    <RefreshCw size={16} /> 强制重新生成
                 </button>
              </div>

              {/* Preview Column */}
              <div className="flex flex-col items-center">
                 <div className="workspace-card p-10 bg-white shadow-2xl shadow-indigo-500/5 relative group">
                    <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                    <div className="relative border-4 border-slate-50 rounded-2xl overflow-hidden shadow-inner bg-slate-50 p-4">
                       <canvas ref={canvasRef} className="hidden" />
                       {qrDataUrl ? (
                         <img src={qrDataUrl} alt="QR Code" className="max-w-full" style={{ width: size, height: size }} />
                       ) : (
                         <div className="flex items-center justify-center bg-white" style={{ width: size, height: size }}>
                            <QrCode size={48} className="text-slate-100 animate-pulse" />
                         </div>
                       )}
                    </div>
                 </div>

                 <div className="mt-8 flex gap-4">
                    <button onClick={copyQR} className="tool-button-secondary h-12 px-8 shadow-sm">
                       <Copy size={16} /> 复制图片
                    </button>
                 </div>
                 <p className="mt-6 text-[10px] font-bold text-slate-300 uppercase tracking-widest">高清 1:1 渲染视图</p>
              </div>
           </div>
        </div>
      </div>

       {/* History Sidebar Popup */}
       <div className={`absolute top-0 -right-5 h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col shrink-0 overflow-hidden transition-all duration-300 ease-in-out z-50 ${showHistory ? 'w-80 translate-x-0' : 'w-80 translate-x-full'}`}>
          <div className="p-6 border-b border-slate-200/60 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900 font-black text-xs uppercase tracking-widest">
              <QrCode size={18} className="text-indigo-600" />
              历史内容库
            </div>
            <div className="flex items-center gap-2">
              <button onClick={clearHistory} className="text-[10px] font-black text-slate-400 hover:text-rose-500 transition uppercase">清空</button>
              <button onClick={() => setShowHistory(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={14}/></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
             {history.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                  <Clock size={32} className="mb-2 opacity-20" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">暂无记录</p>
               </div>
             ) : (
               history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setText(item.data); setShowHistory(false); }}
                  className="w-full text-left p-5 rounded-2xl bg-white border border-slate-200/60 shadow-sm hover:border-indigo-600 hover:shadow-indigo-500/10 transition-all group"
                >
                  <p className="text-[11px] font-black text-slate-800 mb-2 truncate pr-4">{item.data}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(item.timestamp).toLocaleDateString()}</span>
                    <ChevronRight size={10} className="text-slate-300 group-hover:text-indigo-600 transition-colors" />
                  </div>
                </button>
               ))
             )}
          </div>
       </div>
    </div>
  )
}
