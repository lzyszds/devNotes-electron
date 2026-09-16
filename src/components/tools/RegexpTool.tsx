import { useState } from 'react'
import { Search, Copy, Trash2, History, Clock, ChevronRight, Binary, Code2, ListTree, Sparkles, Filter, X } from 'lucide-react'
import { usePresence } from '../../hooks/usePresence'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import Tooltip from '../ui/Tooltip'

const templates = [
  { name: '手机号', pattern: '1[3-9]\\d{9}', desc: '中国大陆手机号' },
  { name: '邮箱', pattern: '[\\w.-]+@[\\w.-]+\\.\\w+', desc: '常用邮箱地址' },
  { name: 'URL', pattern: 'https?://[\\w./%-]+', desc: '网页链接' },
  { name: '身份证', pattern: '\\d{17}[\\dXx]', desc: '18位身份证' },
  { name: 'IP v4', pattern: '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}', desc: 'IPv4 地址' },
  { name: '日期', pattern: '\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}', desc: '通用日期格式' },
  { name: '整数', pattern: '-?\\d+', desc: '包含正负整数' },
  { name: '中文', pattern: '[\\u4e00-\\u9fa5]+', desc: '纯中文字符' },
]

export default function RegexpTool() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testText, setTestText] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  // 历史浮层退出动画：面板 180ms、遮罩 160ms，取长者
  const { mounted: historyMounted, state: historyState } = usePresence(showHistory, 180)

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<{ pattern: string, flags: string, text: string }>('regexp')
  // 历史记录右键菜单
  const openHistoryMenu = useHistoryContextMenu<{
    pattern: string
    flags: string
    text: string
  }>({
    onUse: (item) => {
      setPattern(item.data.pattern)
      setFlags(item.data.flags)
      setTestText(item.data.text)
      setShowHistory(false)
    },
    // 复制时还原成可直接粘贴的正则字面量
    toText: (data) => `/${data.pattern}/${data.flags}`,
    onRemove: removeHistoryItem,
  })

  const testRegex = () => {
    if (!pattern || !testText) return
    try {
      const regex = new RegExp(pattern, flags)
      const result = testText.match(regex) || []
      setMatches(result)
      setError('')
      saveHistory({ pattern, flags, text: testText }, `/${pattern}/${flags}`)
    } catch (e) {
      setError((e as Error).message)
      setMatches([])
    }
  }

  const useTemplate = (p: string) => {
    setPattern(p)
    setError('')
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="relative flex h-full min-h-0 md:min-h-[600px] bg-white text-slate-900 overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Action Header */}
        <div className="flex-wrap gap-3 px-4 py-4 md:px-8 md:py-5 flex items-center justify-between border-b border-slate-100">
           <div className="flex flex-wrap items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-lg shadow-brand-100">
                <Binary size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">正则实验室</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">编写、测试并即时预览正则表达式匹配结果</p>
              </div>
           </div>

           <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`tool-button-secondary h-10 px-4 ${showHistory ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600' : ''}`}
              >
                <History size={16} />
                <span>匹配历史</span>
              </button>
              <div className="w-px h-6 bg-slate-100" />
              <button onClick={testRegex} className="tool-button-primary h-10 bg-brand-600 hover:bg-brand-700 shadow-brand-100 px-8">
                <Search size={16} /> 运行测试
              </button>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-50/20">
           <div className="max-w-7xl mx-auto space-y-8">
              {/* Pattern Input Card */}
              <div className="workspace-card p-6">
                 <div className="flex items-center gap-4">
                    <div className="flex-1 flex items-center gap-3 bg-[#F8FAFC] rounded-2xl px-6 py-4 border border-slate-200 focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/[0.03] transition-all shadow-sm">
                       <span className="text-2xl font-mono text-slate-300">/</span>
                       <input
                          type="text"
                          value={pattern}
                          onChange={(e) => setPattern(e.target.value)}
                          placeholder="在此输入正则表达式 (例如: [a-z0-9]+)"
                          className="flex-1 bg-transparent border-none outline-none font-mono text-xl font-black text-slate-900 placeholder:text-slate-200"
                       />
                       <span className="text-2xl font-mono text-slate-300">/</span>
                       <input
                          type="text"
                          value={flags}
                          onChange={(e) => setFlags(e.target.value)}
                          placeholder="修饰符"
                          className="w-16 bg-transparent border-none outline-none font-mono text-xl font-black text-brand-600 text-center placeholder:text-slate-200"
                       />
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                       <div className="flex gap-1">
                          {['g', 'i', 'm'].map(f => (
                             <button 
                              key={f} 
                              onClick={() => setFlags(flags.includes(f) ? flags.replace(f, '') : flags + f)}
                              className={`w-8 h-8 rounded-lg text-[10px] font-black uppercase transition-all ${flags.includes(f) ? 'bg-brand-600 text-white shadow-sm' : 'bg-white border border-slate-100 text-slate-400 hover:bg-slate-50'}`}
                             >
                               {f}
                             </button>
                          ))}
                       </div>
                    </div>
                 </div>

                 {/* Templates Bar */}
                 <div className="mt-6 flex items-center gap-4 px-2">
                    <div className="flex items-center gap-2 shrink-0">
                       <Filter size={14} className="text-slate-300" />
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">常用库</span>
                    </div>
                    <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                       {templates.map(t => (
                          <button
                             key={t.name}
                             onClick={() => useTemplate(t.pattern)}
                             className="px-3 py-1.5 rounded-lg border border-slate-100 bg-white text-[10px] font-bold text-slate-500 hover:border-brand-500 hover:text-brand-600 hover:shadow-sm transition-all whitespace-nowrap"
                          >
                             {t.name}
                          </button>
                       ))}
                    </div>
                 </div>
              </div>

              {/* Main Content Split */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 h-full">
                 {/* Test Area */}
                 <div className="space-y-3 flex flex-col">
                    <div className="flex items-center justify-between px-1">
                       <div className="flex items-center gap-2">
                          <Code2 size={14} className="text-slate-400" />
                          <label className="tool-label mb-0">待测试文本</label>
                    </div>
                       <Tooltip content="清空测试文本">
                         <button onClick={() => { setTestText(''); setMatches([]); }} className="p-1 text-slate-300 hover:text-rose-500 transition-colors">
                            <Trash2 size={14} />
                         </button>
                       </Tooltip>
                    </div>
                    <textarea
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      placeholder="在此输入需要进行正则匹配测试的长文本..."
                      className="tool-textarea flex-1 min-h-[400px] border-slate-200 shadow-sm"
                    />
                 </div>

                 {/* Matches View */}
                 <div className="space-y-3 flex flex-col">
                    <div className="flex items-center justify-between px-1">
                       <div className="flex items-center gap-2">
                          <ListTree size={14} className="text-slate-400" />
                          <label className="tool-label mb-0">匹配提取结果</label>
                       </div>
                       {matches.length > 0 && (
                          <button onClick={() => copyToClipboard(matches.join('\n'))} className="p-1.5 rounded-lg bg-slate-900 text-white hover:bg-black transition-all flex items-center gap-1.5 px-3 shadow-md">
                             <Copy size={12} />
                             <span className="text-[9px] font-black uppercase">全部复制</span>
                          </button>
                       )}
                    </div>
                    
                    <div className="tool-panel flex-1 min-h-[400px] p-0 overflow-hidden border-slate-200 bg-white flex flex-col shadow-xl">
                       {error ? (
                          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-rose-600 bg-rose-50/20">
                             <Sparkles size={32} className="mb-3 opacity-20" />
                             <p className="text-[10px] font-black uppercase mb-1">语法错误</p>
                             <p className="text-xs font-medium font-mono leading-relaxed">{error}</p>
                          </div>
                       ) : matches.length > 0 ? (
                          <div className="divide-y divide-slate-50 overflow-y-auto h-full scrollbar-hide">
                             {matches.map((match, i) => (
                                <div key={i} className="px-6 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors group">
                                   <span className="text-[10px] font-mono font-black text-slate-200 group-hover:text-brand-400 transition-colors mt-1 w-6 shrink-0">#{i + 1}</span>
                                   <div className="flex-1 font-mono text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap break-all">{match}</div>
                                </div>
                             ))}
                          </div>
                       ) : (
                          <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-300 px-12 text-center">
                             <Search size={40} className="mb-3 opacity-10" />
                             <p className="text-[11px] font-bold uppercase tracking-widest leading-relaxed">未检测到匹配项<br/>请调整正则或输入文本</p>
                          </div>
                       )}
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>

       {historyMounted && (
       <div className="history-overlay" data-state={historyState}>
          <button type="button" aria-label="关闭历史记录" className="history-overlay-backdrop" onClick={() => setShowHistory(false)} />
          <div className="history-overlay-panel" data-state={historyState} onClick={(e) => e.stopPropagation()}>
          <div className="p-6 border-b border-slate-200/70 bg-white/80 flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900 font-black text-xs uppercase tracking-widest">
              <Code2 size={18} className="text-brand-600" />
              历史表达式库
            </div>
            <div className="flex items-center gap-2">
              <button onClick={clearHistory} className="text-[10px] font-black text-slate-400 hover:text-rose-500 transition uppercase">清空</button>
              <Tooltip content="关闭历史记录">
                <button onClick={() => setShowHistory(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={14}/></button>
              </Tooltip>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
             {history.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                  <Clock size={32} className="mb-2 opacity-20" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">暂无记录</p>
               </div>
             ) : (
               history.map((item) => (
                <button
                  key={item.id}
                  onContextMenu={(e) => openHistoryMenu(e, item)}
                  onClick={() => { setPattern(item.data.pattern); setFlags(item.data.flags); setTestText(item.data.text); setShowHistory(false); }}
                  className="w-full text-left p-5 rounded-2xl bg-white border border-slate-200/60 shadow-sm hover:border-brand-600 hover:shadow-brand-500/10 transition-all group"
                >
                  <p className="text-[11px] font-mono font-black text-slate-800 mb-2 truncate pr-4">/{item.data.pattern}/</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(item.timestamp).toLocaleDateString()}</span>
                    <ChevronRight size={10} className="text-slate-300 group-hover:text-brand-600 transition-colors" />
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
