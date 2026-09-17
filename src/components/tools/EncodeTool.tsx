import { useState } from 'react'
import { ChevronRight, Copy, History, Shuffle, Trash2, TriangleAlert } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import { ToolBadge, ToolHistoryOverlay, ToolShell } from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'

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
  const { showToast } = useToast()

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>('encode')
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setInput(item.data)
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  const currentType = encodeTypes.find((t) => t.id === activeType) ?? encodeTypes[0]

  const handleEncode = () => {
    if (!input.trim()) return
    try {
      setOutput(currentType.encode(input))
      setError('')
      saveHistory(input, `${currentType.name} 编码`)
    } catch (e) {
      setError('编码失败: ' + (e as Error).message)
    }
  }

  const handleDecode = () => {
    if (!input.trim()) return
    try {
      setOutput(currentType.decode(input))
      setError('')
      saveHistory(input, `${currentType.name} 解码`)
    } catch (e) {
      setError('解码失败: ' + (e as Error).message)
    }
  }

  const clearAll = () => {
    setInput('')
    setOutput('')
    setError('')
  }

  const copyOutput = async () => {
    if (!output) return
    const ok = await copyText(output)
    showToast(ok ? '已复制结果' : '复制失败', ok ? 'default' : 'error')
  }

  return (
    <ToolShell
      icon={Shuffle}
      title="万能编解码工作室"
      subtitle="支持 Base64、URL、Unicode 及 HTML 实体转换"
      badge={<ToolBadge tone="emerald" className="hidden sm:flex">{currentType.name} · 就绪</ToolBadge>}
      actions={
        <>
          {/* 编码方式切换：分段控件，与设置面板里的接口类型切换同一形态 */}
          <div className="flex gap-0.5 p-0.5 bg-slate-100 dark:bg-dark-sidebar rounded-xl border border-slate-200/60 dark:border-dark-border">
            {encodeTypes.map((type) => {
              const active = activeType === type.id
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => {
                    setActiveType(type.id)
                    setError('')
                  }}
                  className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                    active
                      ? 'bg-white dark:bg-dark-panel text-brand-600 dark:text-brand-400 shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {type.name}
                </button>
              )
            })}
          </div>

          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`tool-button-secondary h-9 ${
              showHistory
                ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400'
                : ''
            }`}
          >
            <History size={15} />
            <span>历史记录</span>
          </button>
        </>
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="历史文本片段"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setInput(item.data)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
        />
      }
    >
      {error && (
        <div className="status-note border-rose-100 bg-rose-50/30 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 flex items-start gap-2 flex-shrink-0">
          <TriangleAlert size={14} className="mt-px shrink-0" />
          <p className="whitespace-pre-line">{error}</p>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[440px]">
        {/* ---------------- 原始内容 ---------------- */}
        <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col min-h-0">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border flex items-center justify-between gap-2 bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">原始内容</span>
            <Tooltip content="清空输入与结果">
              <button
                type="button"
                onClick={clearAll}
                disabled={!input && !output}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 transition disabled:opacity-40 disabled:pointer-events-none"
              >
                <Trash2 size={15} />
              </button>
            </Tooltip>
          </div>

          <div className="flex-1 p-4 flex flex-col min-h-0">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="在这里输入需要转换的文本…"
              className="w-full flex-1 bg-transparent resize-none outline-none font-mono text-slate-800 dark:text-slate-100 text-sm leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-600"
            />
          </div>

          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-dark-border flex items-center justify-end gap-3 text-xs bg-slate-50/40 dark:bg-dark-sidebar/30 rounded-b-2xl flex-shrink-0">
            <span className="font-mono text-slate-500 dark:text-slate-500">{input.length} 字符</span>
          </div>
        </div>

        {/* ---------------- 处理结果 ---------------- */}
        <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col min-h-0">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border flex items-center justify-between gap-2 bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">处理结果</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">{currentType.name}</span>
          </div>

          <div className="flex-1 p-4 flex flex-col min-h-0">
            <div className="flex-1 select-text overflow-y-auto whitespace-pre-wrap break-words font-mono text-slate-800 dark:text-slate-100 text-sm leading-relaxed">
              {output || (
                <span className="text-slate-300 dark:text-slate-600 italic">转换结果将在此呈现…</span>
              )}
            </div>
          </div>

          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-dark-border flex items-center justify-end gap-3 text-xs bg-slate-50/40 dark:bg-dark-sidebar/30 rounded-b-2xl flex-shrink-0">
            <span className="font-mono text-slate-500 dark:text-slate-500">{output.length} 字符</span>
            <button
              type="button"
              onClick={() => void copyOutput()}
              disabled={!output}
              className="px-3 py-1 bg-white dark:bg-dark-panel hover:bg-slate-50 dark:hover:bg-dark-hover text-slate-700 dark:text-slate-200 font-medium border border-slate-200 dark:border-dark-border rounded-md transition shadow-2xs flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Copy size={13} className="text-slate-500 dark:text-slate-400" />
              <span>复制结果</span>
            </button>
          </div>
        </div>
      </div>

      {/* 底部动作条 */}
      <div className="bg-white dark:bg-dark-panel rounded-xl border border-slate-200/80 dark:border-dark-border px-4 py-3 md:px-5 flex items-center justify-between gap-3 flex-wrap shadow-2xs flex-shrink-0">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          当前方式：
          <span className="font-semibold text-slate-600 dark:text-slate-300">{currentType.name}</span>
          ，编码把原文转成该格式，解码反过来
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDecode}
            disabled={!input.trim()}
            className="tool-button-secondary h-9"
          >
            解码
          </button>
          <button
            type="button"
            onClick={handleEncode}
            disabled={!input.trim()}
            className="tool-button-primary h-9 px-5"
          >
            <span>编码</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </ToolShell>
  )
}
