import { useState, useEffect } from 'react'
import { Clock, Copy, History, ChevronRight, Timer, Calendar, ArrowRight, Sparkles, Hash, X } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'

export default function TimestampTool() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [inputTimestamp, setInputTimestamp] = useState('')
  const [inputDate, setInputDate] = useState('')
  const [timestampResult, setTimestampResult] = useState('')
  const [dateResult, setDateResult] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>('timestamp')
  // 历史记录右键菜单
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      if (item.data.includes('-') || item.data.includes('T')) {
        setInputDate(item.data)
      } else {
        setInputTimestamp(item.data)
      }
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const timestampToDate = () => {
    if (!inputTimestamp) return
    let ts = parseInt(inputTimestamp)
    if (isNaN(ts)) return
    if (ts < 10000000000) ts *= 1000
    const date = new Date(ts)
    const result = date.toLocaleString('zh-CN')
    setTimestampResult(result)
    saveHistory(inputTimestamp, `时间戳 → ${result}`)
  }

  const dateToTimestamp = () => {
    if (!inputDate) return
    const date = new Date(inputDate)
    const result = Math.floor(date.getTime() / 1000).toString()
    setDateResult(result)
    saveHistory(inputDate, `日期 → ${result}`)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="relative flex h-full min-h-[600px] bg-white text-slate-900 overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Action Header */}
        <div className="px-8 py-5 flex items-center justify-between border-b border-slate-100">
           <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-100">
                <Clock size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">时间戳转换中心</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">秒、毫秒与人类可读时间的双向转换</p>
              </div>
           </div>

           <div className="flex items-center gap-3">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`tool-button-secondary h-10 px-4 ${showHistory ? 'ring-2 ring-indigo-500/20 border-indigo-200 text-indigo-600' : ''}`}
              >
                <History size={16} />
                <span>转换日志</span>
              </button>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 py-4 bg-slate-50/20">
           <div className="max-w-4xl mx-auto space-y-4">
              {/* Live Dashboard Card */}
              <div className="workspace-card p-10 py-5 relative overflow-hidden bg-slate-900 text-white border-none shadow-2xl">
                 <div className="absolute top-0 right-0 p-8 opacity-[0.05]">
                    <Timer size={140} />
                 </div>
                 
                 <div className="relative z-10 space-y-6">
                    <div className="flex items-center gap-2">
                       <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                       <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">实时系统时钟</span>
                    </div>
                    
                    <div className="space-y-1">
                       <div className="text-6xl font-mono font-black tracking-tighter leading-none">
                          {currentTime.toLocaleTimeString('zh-CN', { hour12: false })}
                       </div>
                       <p className="text-lg font-bold text-slate-400 uppercase tracking-widest">
                          {currentTime.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
                       </p>
                    </div>

                    <div className="flex gap-4">
                       <div className="px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10 backdrop-blur-md">
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 text-center">秒 (Epoch)</p>
                          <p className="text-sm font-mono font-bold text-indigo-300">{Math.floor(currentTime.getTime() / 1000)}</p>
                       </div>
                       <div className="px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10 backdrop-blur-md">
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 text-center">毫秒 (Millis)</p>
                          <p className="text-sm font-mono font-bold text-sky-300">{currentTime.getTime()}</p>
                       </div>
                    </div>
                 </div>
              </div>

              {/* Conversion Workspaces */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 {/* Epoch to Date */}
                 <div className="tool-panel group flex flex-col">
                    <div className="flex items-center gap-2 mb-6">
                       <Hash size={16} className="text-indigo-400" />
                       <label className="tool-label mb-0">时间戳 转 日期</label>
                    </div>
                    <input
                       type="text"
                       value={inputTimestamp}
                       onChange={(e) => setInputTimestamp(e.target.value)}
                       placeholder="例如: 1717315200"
                       className="tool-input mb-4 bg-slate-50 border-transparent focus:bg-white"
                    />
                    <button 
                      onClick={timestampToDate}
                      className="tool-button-primary h-12 w-full bg-slate-900 group-hover:bg-indigo-600 shadow-lg shadow-slate-100 mb-6"
                    >
                       开始转换 <ArrowRight size={14} className="ml-1" />
                    </button>
                    
                    {timestampResult ? (
                       <div className="mt-auto p-4 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-between animate-in zoom-in-95 duration-200 shadow-sm">
                          <div className="flex flex-col">
                             <span className="text-[9px] font-black text-indigo-400 uppercase mb-1">本地时间</span>
                             <span className="text-sm font-black text-indigo-900">{timestampResult}</span>
                          </div>
                          <button onClick={() => copyToClipboard(timestampResult)} className="p-2 rounded-lg bg-white shadow-sm text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all">
                             <Copy size={14} />
                          </button>
                       </div>
                    ) : (
                       <div className="mt-auto h-[60px] border border-dashed border-slate-200 rounded-xl flex items-center justify-center text-[10px] font-bold text-slate-300 uppercase tracking-widest italic">等待输入...</div>
                    )}
                 </div>

                 {/* Date to Epoch */}
                 <div className="tool-panel group flex flex-col">
                    <div className="flex items-center gap-2 mb-6">
                       <Calendar size={16} className="text-sky-400" />
                       <label className="tool-label mb-0">日期 转 时间戳</label>
                    </div>
                    <input
                       type="datetime-local"
                       value={inputDate}
                       onChange={(e) => setInputDate(e.target.value)}
                       className="tool-input mb-4 bg-slate-50 border-transparent focus:bg-white h-[44px]"
                    />
                    <button 
                      onClick={dateToTimestamp}
                      className="tool-button-primary h-12 w-full bg-slate-900 group-hover:bg-sky-600 shadow-lg shadow-slate-100 mb-6"
                    >
                       开始转换 <ArrowRight size={14} className="ml-1" />
                    </button>

                    {dateResult ? (
                       <div className="mt-auto p-4 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-between animate-in zoom-in-95 duration-200 shadow-sm">
                          <div className="flex flex-col">
                             <span className="text-[9px] font-black text-sky-400 uppercase mb-1">UNIX 时间戳</span>
                             <span className="text-sm font-black text-sky-900">{dateResult}</span>
                          </div>
                          <button onClick={() => copyToClipboard(dateResult)} className="p-2 rounded-lg bg-white shadow-sm text-sky-600 hover:bg-sky-600 hover:text-white transition-all">
                             <Copy size={14} />
                          </button>
                       </div>
                    ) : (
                       <div className="mt-auto h-[60px] border border-dashed border-slate-200 rounded-xl flex items-center justify-center text-[10px] font-bold text-slate-300 uppercase tracking-widest italic">等待选择日期...</div>
                    )}
                 </div>
              </div>
           </div>
        </div>
      </div>

       {showHistory && (
       <div className="history-overlay">
          <button type="button" aria-label="关闭历史记录" className="history-overlay-backdrop" onClick={() => setShowHistory(false)} />
          <div className="history-overlay-panel" onClick={(e) => e.stopPropagation()}>
          <div className="p-6 border-b border-slate-200/70 bg-white/80 flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900 font-black text-xs uppercase tracking-widest">
              <History size={18} className="text-indigo-600" />
              最近转换历史
            </div>
            <div className="flex items-center gap-2">
              <button onClick={clearHistory} className="text-[10px] font-black text-slate-400 hover:text-rose-500 transition uppercase">清空</button>
              <button onClick={() => setShowHistory(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={14}/></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
             {history.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                  <Sparkles size={32} className="mb-2 opacity-20" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">暂无记录</p>
               </div>
             ) : (
               history.map((item) => (
                <button
                  key={item.id}
                  onContextMenu={(e) => openHistoryMenu(e, item)}
                  onClick={() => {
                    if (item.data.includes('-') || item.data.includes('T')) { setInputDate(item.data); } else { setInputTimestamp(item.data); }
                    setShowHistory(false);
                  }}
                  className="w-full text-left p-5 rounded-2xl bg-white border border-slate-200/60 shadow-sm hover:border-indigo-600 hover:shadow-indigo-500/10 transition-all group"
                >
                  <p className="text-[11px] font-black text-slate-800 mb-2 truncate pr-4">{item.title || item.data}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(item.timestamp).toLocaleString()}</span>
                    <ChevronRight size={10} className="text-slate-300 group-hover:text-indigo-600 transition-colors" />
                  </div>
                </button>
               ))
             )}
          </div>
          </div>
       </div>
       )}
    </div>
  )
}
