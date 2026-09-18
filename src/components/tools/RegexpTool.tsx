import { useState } from 'react'
import { Binary, Code2, Copy, Filter, History, ListTree, Search, Trash2, TriangleAlert } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import {
  BODY_TEXTAREA,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolEmpty,
  ToolHistoryOverlay,
  ToolNotice,
  ToolShell,
  ToolTag,
  iconButtonClass,
  pillClass,
} from '../ui'
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
        <ToolNotice tone="error" icon={TriangleAlert}>
          <p className="whitespace-pre-line font-mono">{error}</p>
        </ToolNotice>
      )}

      {/* 正则表达式 */}
      <ToolCard fill={false}>
        <ToolCardHeader
          title="正则表达式"
          sublabel={<span className="font-mono">/{pattern || '…'}/{flags}</span>}
          actions={
            <div className="flex gap-1">
              {FLAG_OPTIONS.map((f) => {
                const active = flags.includes(f)
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFlag(f)}
                    title={`修饰符 ${f}`}
                    className={`h-7 w-7 rounded-lg text-[11px] font-bold uppercase transition-colors ${
                      active
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:bg-dark-hover dark:text-slate-500 dark:hover:bg-dark-border dark:hover:text-slate-300'
                    }`}
                  >
                    {f}
                  </button>
                )
              })}
            </div>
          }
        />

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 h-11 rounded-[10px] border border-slate-200/80 dark:border-dark-border bg-white dark:bg-dark-panel px-3.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/10 transition">
            <span className="text-base font-mono text-slate-300 dark:text-slate-600">/</span>
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="在此输入正则表达式 (例如: [a-z0-9]+)"
              className="flex-1 min-w-0 bg-transparent border-none outline-none font-mono text-[13px] font-medium text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600"
            />
            <span className="text-base font-mono text-slate-300 dark:text-slate-600">/</span>
            <input
              type="text"
              value={flags}
              onChange={(e) => setFlags(e.target.value)}
              placeholder="修饰符"
              title="修饰符"
              className="w-14 bg-transparent border-none outline-none font-mono text-[13px] font-medium text-brand-600 dark:text-brand-400 text-center placeholder:text-slate-300 dark:placeholder:text-slate-600"
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 shrink-0">
              <Filter size={12} />
              常用库
            </span>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
              {templates.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => useTemplate(t.pattern)}
                  title={t.desc}
                  className={pillClass(false, 'whitespace-nowrap')}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </ToolCard>

      {/* 待测试文本 / 匹配结果 */}
      <div className="tool-cascade flex-1 grid grid-cols-1 xl:grid-cols-2 gap-4 min-h-[440px]">
        <ToolCard>
          <ToolCardHeader
            title="待测试文本"
            icon={Code2}
            actions={
              <Tooltip content="清空测试文本">
                <button
                  type="button"
                  onClick={() => {
                    setTestText('')
                    setMatches([])
                  }}
                  disabled={!testText}
                  className={iconButtonClass('danger')}
                >
                  <Trash2 size={15} />
                </button>
              </Tooltip>
            }
          />

          <div className="flex-1 min-h-0 p-4 flex flex-col">
            <textarea
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder="在此输入需要进行正则匹配测试的长文本…"
              className={BODY_TEXTAREA}
            />
          </div>

          <ToolCardFooter>
            <span className="font-mono">{testText.length} 字符</span>
          </ToolCardFooter>
        </ToolCard>

        <ToolCard>
          <ToolCardHeader
            title="匹配提取结果"
            icon={ListTree}
            meta={<ToolTag tone="brand">{matches.length} 项</ToolTag>}
            actions={
              <Tooltip content="复制全部匹配">
                <button
                  type="button"
                  onClick={() => void copyAll()}
                  disabled={matches.length === 0}
                  className={iconButtonClass('brand')}
                >
                  <Copy size={15} />
                </button>
              </Tooltip>
            }
          />

          <div className="flex-1 min-h-0 flex flex-col">
            {error ? (
              <ToolEmpty icon={TriangleAlert} title="正则语法错误" hint={error} className="flex-1" />
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
              <ToolEmpty
                icon={Search}
                title="未检测到匹配项"
                hint="请调整正则表达式或输入测试文本"
                className="flex-1"
              />
            )}
          </div>
        </ToolCard>
      </div>
    </ToolShell>
  )
}
