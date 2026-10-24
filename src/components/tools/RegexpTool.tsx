import { useState } from 'react'
import { handleTextareaKeyDown } from '../../utils/textareaIndent'
import { ArrowRight, Binary, Code2, Filter, History, ListTree, Search, Trash2, TriangleAlert } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import {
  BODY_TEXTAREA,
  META,
  SECTION_LABEL,
  Segmented,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolEmpty,
  ToolHistoryOverlay,
  ToolNotice,
  ToolShell,
  buttonClass,
  CopyButton,
  iconButtonClass,
  pillClass,
} from '../ui'
import Tooltip from '../ui/Tooltip'

/** 一次匹配：整串 + 各捕获组 + 在原文中的位置 */
export interface RegexMatch {
  /** 整串匹配到的文本 */
  value: string
  /**
   * 捕获组。未参与匹配的组 JS 给的是 null（不是 undefined），
   * 所以这里如实标成可空，别用 undefined 去判。
   */
  groups: (string | null)[]
  /** 具名捕获组 */
  named: Record<string, string | undefined>
  /** 在原文中的起始下标 */
  index: number
}

/**
 * 把原文按匹配位置切成片段。
 *
 * 匹配可能重叠或相邻（如 `a*` 在 "aa" 上），所以不能简单地逐个 replace ——
 * 必须按 index 排序后依次切，并跳过落在已输出区间内的匹配，否则片段会错位。
 */
export function splitByMatches(
  text: string,
  matches: { value: string; index: number }[],
): { text: string; matched: boolean }[] {
  const parts: { text: string; matched: boolean }[] = []
  let cursor = 0

  for (const match of [...matches].sort((a, b) => a.index - b.index)) {
    if (match.index < cursor) continue // 与上一段重叠，跳过
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), matched: false })

    if (match.value.length > 0) {
      parts.push({ text: match.value, matched: true })
      cursor = match.index + match.value.length
    } else {
      /*
       * 零宽匹配（`\b`、`(?=x)`、`^`）没有可见文本，但**必须推进 cursor**。
       * 否则下一个匹配的 index 仍大于 cursor，刚才那段普通文本会被再切一遍，
       * 整段文本被重复输出 —— 而且看起来只是「有点怪」，不容易联想到是这里。
       */
      cursor = match.index
    }
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), matched: false })
  return parts
}

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

/**
 * 可勾选的修饰符。
 *
 * 补上 s/u 是因为调试别人给的正则时常卡在这两个上：u 影响 emoji 与代理对的
 * 匹配、s 让 `.` 能跨行。少一个就可能复现不出对方的行为。
 */
const FLAG_OPTIONS = ['g', 'i', 'm', 's', 'u']

export default function RegexpTool() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testText, setTestText] = useState('')
  const [matches, setMatches] = useState<RegexMatch[]>([])
  /** 替换用的模板，支持 $1 / $<name> 反向引用 */
  const [replacement, setReplacement] = useState('')
  const [replaced, setReplaced] = useState('')
  /** "待测试文本"卡片：编辑原件 or 看带高亮的渲染结果 */
  const [showHighlight, setShowHighlight] = useState(false)
  /** 点结果列表时高亮的那一条，用来在预览里区分「当前项」 */
  const [activeMatch, setActiveMatch] = useState<number | null>(null)
  const [error, setError] = useState('')

  /**
   * 是否全是零宽匹配（`\b`、`(?=x)`、`^`）。
   *
   * 零宽匹配的是「位置」不是字符，没有宽度可以染色 —— 高亮视图看起来会和
   * 原文一模一样，用户会以为没匹配上。这种时候得明说。
   */
  const allZeroWidth = matches.length > 0 && matches.every((match) => match.value.length === 0)
  const [showHistory, setShowHistory] = useState(false)

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

  /**
   * 执行匹配。
   *
   * 用 matchAll 而不是 match：带 g 时 match() 只返回整串、把捕获组全丢掉，
   * 而分组恰恰是调试正则时最想看的东西。matchAll 每组都带回来。
   *
   * matchAll 要求正则必须带 g，所以这里强制补上 —— 用户没勾 g 时也想看
   * 「有几个分组」而不是只拿到第一个匹配。
   */
  const testRegex = () => {
    if (!pattern || !testText) return
    try {
      const safeFlags = flags.includes('g') ? flags : flags + 'g'
      const regex = new RegExp(pattern, safeFlags)
      const result: RegexMatch[] = Array.from(testText.matchAll(regex), (m) => ({
        value: m[0],
        groups: m.slice(1),
        named: (m.groups ?? {}) as Record<string, string | undefined>,
        index: m.index ?? 0,
      }))
      setMatches(result)
      setActiveMatch(null)
      setError('')
      // 跑出结果就自动翻到高亮视图 —— 用户点「运行测试」想看的就是匹配落在哪
      setShowHighlight(true)
      saveHistory({ pattern, flags, text: testText }, `/${pattern}/${flags}`)
    } catch (e) {
      setError((e as Error).message)
      setMatches([])
      setActiveMatch(null)
    }
  }

  /**
   * 执行替换预览。
   *
   * 用 replaceAll 配合带 g 的正则；补 g 是因为 replaceAll 在无 g 的正则上
   * 会直接抛错，而用户未必会想到「替换还必须勾 g」这层。
   */
  const testReplace = () => {
    if (!pattern || !testText) return
    try {
      const safeFlags = flags.includes('g') ? flags : flags + 'g'
      setReplaced(testText.replace(new RegExp(pattern, safeFlags), replacement))
      setError('')
    } catch (e) {
      setError((e as Error).message)
      setReplaced('')
    }
  }

  const useTemplate = (p: string) => {
    setPattern(p)
    setError('')
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
            className={`tool-button-secondary h-8 ${
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
            className="tool-button-primary h-8 px-5"
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
              <>
                <Segmented
                  value={showHighlight ? 'highlight' : 'edit'}
                  onChange={(mode) => setShowHighlight(mode === 'highlight')}
                  options={[
                    { value: 'edit' as const, label: '编辑' },
                    { value: 'highlight' as const, label: '高亮' },
                  ]}
                />
                <Tooltip content="清空测试文本">
                  <button
                    type="button"
                    onClick={() => {
                      setTestText('')
                      setMatches([])
                      setReplaced('')
                      setActiveMatch(null)
                    }}
                    disabled={!testText}
                    className={iconButtonClass('danger')}
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
              </>
            }
          />

          <div className="flex-1 min-h-0 p-4 flex flex-col">
            {showHighlight ? (
              <div className="flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-6 text-slate-800 dark:text-slate-100 select-text">
                {allZeroWidth && (
                  <p className="mb-2 font-sans text-[11px] text-amber-600 dark:text-amber-400">
                    本次命中的都是零宽匹配（匹配位置而非字符），没有字符可染色 —— 匹配数见右侧列表。
                  </p>
                )}
                {testText ? (
                  (() => {
                    /*
                     * 逐段渲染。matched 段要能分辨「当前选中的那一处」，
                     * 所以自己数已渲染过几个匹配，跟 activeMatch 比。
                     * 被跳过的重叠/零宽匹配不占编号，与右侧列表的序号一致。
                     */
                    let matchedSoFar = -1
                    return splitByMatches(testText, matches).map((part, i) => {
                      if (!part.matched) return <span key={i}>{part.text}</span>
                      matchedSoFar++
                      const isActive = matchedSoFar === activeMatch
                      return (
                        <mark
                          key={i}
                          className={`rounded-[3px] ${
                            isActive
                              ? 'bg-brand-500 text-white dark:bg-brand-500 dark:text-white'
                              : 'bg-amber-200/70 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100'
                          }`}
                        >
                          {part.text}
                        </mark>
                      )
                    })
                  })()
                ) : (
                  <span className="text-slate-300 dark:text-slate-600 not-italic">
                    先在上面输入文本并运行测试…
                  </span>
                )}
              </div>
            ) : (
              <textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                onKeyDown={(e) => handleTextareaKeyDown(e, setTestText)}
                placeholder="在此输入需要进行正则匹配测试的长文本…"
                className={BODY_TEXTAREA}
              />
            )}
          </div>

          <ToolCardFooter>
            <span className="font-mono">{testText.length} 字符</span>
            <span className={META}>
              {showHighlight ? `${matches.length} 处高亮` : '编辑原件'}
            </span>
          </ToolCardFooter>
        </ToolCard>

        <ToolCard>
          <ToolCardHeader
            title="匹配提取结果"
            icon={ListTree}
            // meta 自带一层灰底，只能传纯文本；套 ToolTag 会双层叠色
            meta={`${matches.length} 项`}
            actions={
              <CopyButton
                value={() => matches.map((match) => match.value).join('\n')}
                disabled={matches.length === 0}
              />
            }
          />

          <div className="flex-1 min-h-0 flex flex-col">
            {error ? (
              <ToolEmpty icon={TriangleAlert} title="正则语法错误" hint={error} className="flex-1" />
            ) : matches.length > 0 ? (
              /* key 随匹配结果变化：每次都重新挂载，fe-rise 才会重播一遍 ——
                 否则从「无匹配」切到「有匹配」只是内容被换掉，没有过渡 */
              <div
                key={`${matches.length}-${matches[0]?.value ?? ''}`}
                className="fe-rise flex-1 divide-y divide-slate-50 dark:divide-dark-border overflow-y-auto"
              >
                {matches.map((match, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      setActiveMatch(i)
                      setShowHighlight(true)
                    }}
                    title="点此在左侧高亮这一处"
                    className={`px-4 py-3 flex items-start gap-3 cursor-pointer transition-colors group ${
                      activeMatch === i
                        ? 'bg-amber-50/70 dark:bg-amber-500/10'
                        : 'hover:bg-slate-50 dark:hover:bg-dark-hover'
                    }`}
                  >
                    <span className="text-[10px] font-mono font-bold text-slate-300 dark:text-slate-600 group-hover:text-brand-500 transition-colors mt-0.5 w-6 shrink-0">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <div className="font-mono text-[13px] leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-all select-text">
                        {match.value}
                      </div>
                      {/* 捕获组：调试正则时最需要看的就是这几行 */}
                      {match.groups.length > 0 && (
                        <div className="flex flex-col gap-0.5">
                          {match.groups.map((group, gi) => (
                            <div key={gi} className="flex items-baseline gap-2 text-[11px]">
                              <span className="font-mono text-slate-300 dark:text-slate-600 shrink-0">
                                ${gi + 1}
                              </span>
                              <span className="font-mono text-brand-600 dark:text-brand-400 break-all">
                                {group === null || group === undefined ? (
                                  <span className="text-slate-300 dark:text-slate-600 italic">
                                    （未参与匹配）
                                  </span>
                                ) : (
                                  group
                                )}
                              </span>
                            </div>
                          ))}
                          {Object.entries(match.named).map(([name, value]) => (
                            <div key={name} className="flex items-baseline gap-2 text-[11px]">
                              <span className="font-mono text-slate-300 dark:text-slate-600 shrink-0">
                                ${'<' + name + '>'}
                              </span>
                              <span className="font-mono text-brand-600 dark:text-brand-400 break-all">
                                {value ?? ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <span className="text-[10px] text-slate-300 dark:text-slate-600 font-mono">
                        位置 {match.index}
                      </span>
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

      {/* 替换预览 */}
      <ToolCard fill={false}>
        <ToolCardHeader
          title="替换预览"
          icon={ArrowRight}
          meta="支持 $1 / $<name> 引用捕获组"
          actions={
            <button
              type="button"
              onClick={testReplace}
              disabled={!pattern || !testText}
              className={buttonClass('secondary', 'h-7 px-3 text-[11px]')}
            >
              执行替换
            </button>
          }
        />
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className={SECTION_LABEL}>替换为</span>
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="例如 $1-$2，或直接写死文本"
              className="h-9 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel px-3 font-mono text-[12px] text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:border-brand-400"
            />
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className={SECTION_LABEL}>替换结果</span>
            <div className="h-9 rounded-lg border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 px-3 flex items-center overflow-hidden">
              <span className="font-mono text-[12px] text-slate-700 dark:text-slate-200 truncate">
                {replaced || (
                  <span className="text-slate-300 dark:text-slate-600 not-italic">尚未替换</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </ToolCard>
    </ToolShell>
  )
}
