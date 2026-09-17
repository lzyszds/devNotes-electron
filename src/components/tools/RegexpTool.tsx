import { useState } from 'react'
import { Binary, Code2, Copy, Filter, History, ListTree, Search, Trash2, TriangleAlert } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import { ToolBadge, ToolHistoryOverlay, ToolShell } from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'

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

const FLAG_OPTIONS = ['g', 'i', 'm']

export default function RegexpTool() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testText, setTestText] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const { showToast } = useToast()

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<{ pattern: string, flags: string, text: string }>('regexp')
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
      const result = testText.match(new RegExp(pattern, flags)) || []
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

  const copyAll = async () => {
    const ok = await copyText(matches.join('\n'))
    showToast(ok ? '已复制全部匹配' : '复制失败', ok ? 'default' : 'error')
  }

  const toggleFlag = (f: string) => {
    setFlags(flags.includes(f) ? flags.replace(f, '') : flags + f)
  }

  return (
    <ToolShell
      icon={Binary}
      title="正则实验室"
      subtitle="编写、测试并即时预览正则表达式匹配结果"
      badge={
        matches.length > 0 ? (
          <ToolBadge tone="brand">{matches.length} 个匹配</ToolBadge>
        ) : undefined
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
            <span>匹配历史</span>
          </button>
          <button
            onClick={testRegex}
            disabled={!pattern || !testText}
            className="tool-button-primary h-9 px-5"
          >
            <Search size={15} />
            <span>运行测试</span>
          </button>
        </>
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="历史表达式库"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setPattern(item.data.pattern)
            setFlags(item.data.flags)
            setTestText(item.data.text)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
          renderItemTitle={(item) => (
            <span className="font-mono">/{item.data.pattern}/{item.data.flags}</span>
          )}
        />
      }
    >
      {error && (
        <div className="status-note border-rose-100 bg-rose-50/30 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 flex items-start gap-2 flex-shrink-0">
          <TriangleAlert size={14} className="mt-px shrink-0" />
          <p className="whitespace-pre-line font-mono">{error}</p>
        </div>
      )}

      {/* 正则表达式 */}
      <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex-shrink-0">
        <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">正则表达式</span>
          <div className="flex gap-1">
            {FLAG_OPTIONS.map((f) => {
              const active = flags.includes(f)
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFlag(f)}
                  title={`修饰符 ${f}`}
                  className={`w-7 h-7 rounded-lg text-[11px] font-bold uppercase transition ${
                    active
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-white dark:bg-dark-panel border border-slate-200 dark:border-dark-border text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                  }`}
                >
                  {f}
                </button>
              )
            })}
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-dark-border bg-slate-50 dark:bg-dark-sidebar px-4 py-3 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/10 transition">
            <span className="text-lg font-mono text-slate-300 dark:text-slate-600">/</span>
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="在此输入正则表达式 (例如: [a-z0-9]+)"
              className="flex-1 min-w-0 bg-transparent border-none outline-none font-mono text-base font-bold text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600"
            />
            <span className="text-lg font-mono text-slate-300 dark:text-slate-600">/</span>
            <input
              type="text"
              value={flags}
              onChange={(e) => setFlags(e.target.value)}
              placeholder="修饰符"
              title="修饰符"
              className="w-14 bg-transparent border-none outline-none font-mono text-base font-bold text-brand-600 dark:text-brand-400 text-center placeholder:text-slate-300 dark:placeholder:text-slate-600"
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest shrink-0">
              <Filter size={12} />
              常用库
            </span>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {templates.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => useTemplate(t.pattern)}
                  title={t.desc}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-400 transition whitespace-nowrap"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 待测试文本 / 匹配结果 */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 gap-4 min-h-[440px]">
        <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col min-h-0">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border flex items-center justify-between gap-2 bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Code2 size={13} className="text-brand-600 dark:text-brand-400" />
              待测试文本
            </span>
            <Tooltip content="清空测试文本">
              <button
                type="button"
                onClick={() => {
                  setTestText('')
                  setMatches([])
                }}
                disabled={!testText}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 transition disabled:opacity-40 disabled:pointer-events-none"
              >
                <Trash2 size={15} />
              </button>
            </Tooltip>
          </div>

          <div className="flex-1 p-4 flex flex-col min-h-0">
            <textarea
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder="在此输入需要进行正则匹配测试的长文本…"
              className="w-full flex-1 bg-transparent resize-none outline-none font-mono text-slate-800 dark:text-slate-100 text-sm leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-600"
            />
          </div>

          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-dark-border flex items-center justify-end gap-3 text-xs bg-slate-50/40 dark:bg-dark-sidebar/30 rounded-b-2xl flex-shrink-0">
            <span className="font-mono text-slate-500 dark:text-slate-500">{testText.length} 字符</span>
          </div>
        </div>

        <div className="bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/90 dark:border-dark-border shadow-sm flex flex-col min-h-0">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-dark-border flex items-center justify-between gap-2 bg-slate-50/50 dark:bg-dark-sidebar/40 rounded-t-2xl flex-shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <ListTree size={13} className="text-brand-600 dark:text-brand-400" />
              匹配提取结果
            </span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">{matches.length} 项</span>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            {error ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-rose-600 dark:text-rose-300">
                <TriangleAlert size={28} className="mb-3 opacity-30" />
                <p className="text-[10px] font-black uppercase mb-1">语法错误</p>
                <p className="text-xs font-medium font-mono leading-relaxed">{error}</p>
              </div>
            ) : matches.length > 0 ? (
              <div className="flex-1 divide-y divide-slate-50 dark:divide-dark-border overflow-y-auto">
                {matches.map((match, i) => (
                  <div
                    key={i}
                    className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors group"
                  >
                    <span className="text-[10px] font-mono font-bold text-slate-300 dark:text-slate-600 group-hover:text-brand-500 transition-colors mt-0.5 w-6 shrink-0">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0 font-mono text-[13px] leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-all select-text">
                      {match}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-16 text-slate-300 dark:text-slate-600 px-8 text-center">
                <Search size={36} className="mb-3 opacity-15" />
                <p className="text-[11px] font-bold uppercase tracking-widest leading-relaxed">
                  未检测到匹配项
                  <br />
                  请调整正则或输入文本
                </p>
              </div>
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-dark-border flex items-center justify-end gap-3 text-xs bg-slate-50/40 dark:bg-dark-sidebar/30 rounded-b-2xl flex-shrink-0">
            <button
              type="button"
              onClick={() => void copyAll()}
              disabled={matches.length === 0}
              className="px-3 py-1 bg-white dark:bg-dark-panel hover:bg-slate-50 dark:hover:bg-dark-hover text-slate-700 dark:text-slate-200 font-medium border border-slate-200 dark:border-dark-border rounded-md transition shadow-2xs flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Copy size={13} className="text-slate-500 dark:text-slate-400" />
              <span>全部复制</span>
            </button>
          </div>
        </div>
      </div>
    </ToolShell>
  )
}
