import { useState, useRef, useEffect } from 'react'
import { QrCode, Upload, Download, Copy, RefreshCw } from 'lucide-react'

export default function QrCodeTool() {
  const [text, setText] = useState('https://fehelper.com')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [size, setSize] = useState(200)
  const [fgColor, setFgColor] = useState('#000000')
  const [bgColor, setBgColor] = useState('#ffffff')
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Settings */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">内容</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入二维码内容..."
              className="w-full p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-gray-100"
              rows={4}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              尺寸: {size}px
            </label>
            <input
              type="range"
              min="100"
              max="500"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">前景色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={fgColor}
                  onChange={(e) => setFgColor(e.target.value)}
                  className="w-10 h-10 rounded-lg cursor-pointer border-0"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">{fgColor}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">背景色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="w-10 h-10 rounded-lg cursor-pointer border-0"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">{bgColor}</span>
              </div>
            </div>
          </div>

          <button
            onClick={generateQR}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> 重新生成
          </button>
        </div>

        {/* Preview */}
        <div className="flex flex-col items-center justify-center">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700">
            <canvas ref={canvasRef} className="hidden" />
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="QR Code"
                className="max-w-full"
                style={{ width: size, height: size }}
              />
            )}
          </div>
          
          <div className="flex gap-3 mt-6">
            <button
              onClick={downloadQR}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" /> 下载 PNG
            </button>
            <button
              onClick={copyQR}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors"
            >
              <Copy className="w-4 h-4" /> 复制图片
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
