import { useState } from 'react'
import { Copy, Trash2, History, Clock, ChevronRight, Shuffle, ArrowRightLeft, Sparkles, X } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'

const encodeTypes = [
  { id: 'base64', name: 'Base64', icon: 'B64', encode: (s: string) => btoa(unescape(encodeURIComponent(s))), decode: (s: string) => decodeURIComponent(escape(atob(s))) },
  { id: 'url', name: 'URL', icon: 'URL', encode: encodeURIComponent, decode: decodeURIComponent },
  { id: 'unicode', name: 'Unicode', icon: '\\u', encode: (s: string) => s.split('').map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''), decode: (s: string) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) },
  {
    id: 'html',
    name: 'HTML',
    icon: '<>',
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
      saveHistory(input, `${type.name} 编码`)
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
      saveHistory(input, `${type.name} 解码`)
    } catch (e) {
      setError('解码失败: ' + (e as Error).message)
    }
  }

  const copyOutput = () => {
    if (output) navigator.clipboard.writeText(output)
  }

  return (
    <div className="relative flex h-full min-h-[600px] bg-white overflow-hidden text-slate-900">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Action Header */}
        <div className="px-8 py-5 flex items-center justify-between border-b border-slate-100">
           <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-100">
                <Shuffle size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">万能编解码工作室</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">支持 Base64、URL、Unicode 及 HTML 实体转换</p>
              </div>
           </div>

           <div className="flex items-center gap-3">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`tool-button-secondary h-10 px-4 ${showHistory ? 'ring-2 ring-amber-500/20 border-amber-200 text-amber-600' : ''}`}
              >
                <History size={16} />
                <span>转换历史</span>
              </button>
              <div className="w-px h-6 bg-slate-100" />
              <div className="flex gap-1.5 p-1 bg-slate-100 rounded-xl">
                 {encodeTypes.map(type => (
                   <button
                    key={type.id}
                    onClick={() => { setActiveType(type.id); setError(''); }}
                    className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${activeType === type.id ? 'bg-white text-amber-600 shadow-sm shadow-amber-500/5' : 'text-slate-400 hover:text-slate-600'}`}
                   >
                     {type.name}
                   </button>
                 ))}
              </div>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/20">
           <div className="max-w-7xl mx-auto space-y-8">
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_48px_1fr] gap-4 items-center">
                 {/* Input Pane */}
                 <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                       <label className="tool-label">原始内容 (输入)</label>
                       <button onClick={() => { setInput(''); setOutput(''); setError(''); }} className="p-1 text-slate-300 hover:text-rose-500 transition-colors">
                          <Trash2 size={14} />
                       </button>
                    </div>
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="在这里输入需要转换的文本..."
                      className="tool-textarea min-h-[400px] border-slate-200 shadow-sm"
                    />
                 </div>

                 {/* Middle Arrows/Controls */}
                 <div className="flex xl:flex-col justify-center items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-300 shadow-sm">
                       <ArrowRightLeft size={18} className="xl:rotate-90" />
                    </div>
                 </div>

                 {/* Output Pane */}
                 <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                       <label className="tool-label">处理结果 (输出)</label>
                       <button onClick={copyOutput} disabled={!output} className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-900 hover:text-white transition-all disabled:opacity-30">
                          <Copy size={14} />
                       </button>
                    </div>
                    <div className="relative">
                       {error ? (
                         <div className="status-note min-h-[400px] flex flex-col items-center justify-center border-rose-100 bg-rose-50/30 text-rose-600 p-8 text-center">
                            <Sparkles size={32} className="mb-3 opacity-20" />
                            <p className="text-[10px] font-black uppercase mb-1">转换出错</p>
                            <p className="text-xs font-medium">{error}</p>
                         </div>
                       ) : (
                         <textarea
                            value={output}
                            readOnly
                            placeholder="转换结果将在此显示..."
                            className={`tool-textarea min-h-[400px] border-amber-100 bg-amber-50/10 font-bold text-amber-900 placeholder:text-amber-200`}
                         />
                       )}
                    </div>
                 </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-center gap-4">
                 <button 
                  onClick={handleEncode}
                  className="tool-button-primary h-14 px-12 bg-slate-900 shadow-xl shadow-slate-100 text-sm group"
                 >
                   立即进行编码 <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                 </button>
                 <button 
                  onClick={handleDecode}
                  className="tool-button-secondary h-14 px-12 text-sm border-slate-200"
                 >
                   尝试进行解码
                 </button>
              </div>
           </div>
        </div>
      </div>

       {/* History Sidebar Popup */}
       <div className={`absolute top-0 -right-5 h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col shrink-0 overflow-hidden transition-all duration-300 ease-in-out z-50 ${showHistory ? 'w-80 translate-x-0' : 'w-80 translate-x-full'}`}>
          <div className="p-6 border-b border-slate-200/60 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900 font-black text-xs uppercase tracking-widest">
              <History size={18} className="text-amber-500" />
              历史文本片段
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
                  onClick={() => { setInput(item.data); setShowHistory(false); }}
                  className="w-full text-left p-5 rounded-2xl bg-white border border-slate-200/60 shadow-sm hover:border-amber-500 hover:shadow-amber-500/10 transition-all group"
                >
                  <p className="text-[11px] font-black text-slate-800 mb-2 truncate pr-4">{item.title}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(item.timestamp).toLocaleString()}</span>
                    <ChevronRight size={10} className="text-slate-300 group-hover:text-amber-600 transition-colors" />
                  </div>
                </button>
               ))
             )}
          </div>
       </div>
    </div>
  )
}
