import { useState } from 'react'
import { Copy, Trash2, History, Clock, ChevronRight } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'

const encodeTypes = [
  { id: 'base64', name: 'Base64', encode: (s: string) => btoa(unescape(encodeURIComponent(s))), decode: (s: string) => decodeURIComponent(escape(atob(s))) },
  { id: 'url', name: 'URL', encode: encodeURIComponent, decode: decodeURIComponent },
  { id: 'unicode', name: 'Unicode', encode: (s: string) => s.split('').map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''), decode: (s: string) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) },
  {
    id: 'html',
    name: 'HTML',
    encode: (s: string) =>
      s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)),
    decode: (s: string) =>
      s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: 'amp' | 'lt' | 'gt' | 'quot' | '#39') => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e])),
  },
]

export default function EncodeTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [activeType, setActiveType] = useState('base64')
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const { history, saveHistory, clearHistory } = useToolHistory<string>('encode')

  const handleEncode = () => {
    if (!input.trim()) return
    const type = encodeTypes.find(t => t.id === activeType)
    if (!type) return
    try {
      const result = type.encode(input)
      setOutput(result)
      setError('')
      saveHistory(input, `${type.name} Encode: ${input.slice(0, 15)}...`)
    } catch (e) {
      setError('编码失败: ' + (e as Error).message)
    }
  }

  const handleDecode = () => {
    if (!input.trim()) return
    const type = encodeTypes.find(t => t.id === activeType)
    if (!type) return
    try {
      const result = type.decode(input)
      setOutput(result)
      setError('')
      saveHistory(input, `${type.name} Decode: ${input.slice(0, 15)}...`)
    } catch (e) {
      setError('解码失败: ' + (e as Error).message)
    }
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  return (
    <div className="flex h-full min-h-[600px]">
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex flex-wrap gap-2">
            {encodeTypes.map(type => (
              <button
                key={type.id}
                onClick={() => { setActiveType(type.id); setError('') }}
                className={`tool-chip px-4 py-2 text-sm ${
                  activeType === type.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : ''
                }`}
              >
                {type.name}
              </button>
            ))}
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
          <div className="tool-panel">
            <div className="mb-3 flex items-center justify-between">
              <label className="tool-label mb-0">输入内容</label>
              <button onClick={() => { setInput(''); setOutput(''); setError('') }} className="tool-button-secondary px-3 py-2">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入要转换的内容..."
              className="tool-textarea min-h-[320px]"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={handleEncode} className="tool-button-primary flex-1">
                编码
              </button>
              <button onClick={handleDecode} className="tool-button-secondary flex-1">
                解码
              </button>
            </div>
          </div>

          <div className="tool-panel">
            <div className="mb-3 flex items-center justify-between">
              <label className="tool-label mb-0">输出结果</label>
              <button onClick={copyOutput} className="tool-button-secondary px-3 py-2">
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {error ? (
              <div className="status-note min-h-[320px] border-rose-200 bg-rose-50 text-rose-700">
                {error}
              </div>
            ) : (
              <textarea
                value={output}
                readOnly
                placeholder="转换结果..."
                className="tool-textarea min-h-[320px]"
              />
            )}
          </div>
        </div>
      </div>

      {/* History Sidebar */}
      {showHistory && (
        <aside className="w-80 border-l border-slate-200 bg-slate-50/50 flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Clock size={16} />
              处理历史
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
                    setInput(item.data)
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
