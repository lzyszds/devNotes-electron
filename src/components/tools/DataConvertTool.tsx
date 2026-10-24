import { useMemo, useState } from 'react'
import { ArrowLeftRight, Replace, Sparkles, FileWarning, Shuffle } from 'lucide-react'
import {
  CodeEditor,
  CopyButton,
  META,
  Segmented,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolNotice,
  ToolShell,
  type SegmentOption,
} from '../ui'
import { DATA_FORMATS, guessFormat, parseData, stringifyData, type DataFormat } from '../../utils/dataConvert'

const FORMAT_OPTIONS: SegmentOption<DataFormat>[] = DATA_FORMATS.map((item) => ({ value: item.id, label: item.label }))

const HINTS: Record<DataFormat, string> = {
  json: '标准 JSON，支持任意嵌套',
  yaml: '缩进结构，适合 K8s、CI 配置',
  toml: '适合 Cargo、pyproject 等配置，顶层必须是对象',
  csv: '第一行为表头，每行转成一个对象；嵌套值会序列化成 JSON',
  env: 'KEY=VALUE 每行一个，支持 # 注释和引号',
  query: '完整 URL、?a=1 或 a=1&b=2 都可以；重复键转成数组',
}

export default function DataConvertTool() {
  const [from, setFrom] = useState<DataFormat>('json')
  const [to, setTo] = useState<DataFormat>('yaml')
  const [input, setInput] = useState('')

  const result = useMemo(() => {
    if (!input.trim()) return { output: '', error: '' }
    try {
      const value = parseData(input, from)
      return { output: stringifyData(value, to), error: '' }
    } catch (err) {
      return { output: '', error: err instanceof Error ? err.message : '转换失败' }
    }
  }, [input, from, to])

  /** 交换：输出作为新的输入，格式也对调，方便「改完再转回去」 */
  const swap = () => {
    if (result.error || !result.output) return
    setInput(result.output)
    setFrom(to)
    setTo(from)
  }

  const autoDetect = () => {
    const guessed = guessFormat(input)
    if (!guessed) return
    setFrom(guessed)
    if (guessed === to) setTo(from)
  }

  return (
    <ToolShell
      icon={Shuffle}
      title="数据互转沙箱"
      subtitle="JSON、YAML、TOML、CSV、.env、URL Query 之间互相转换"
      badge={<ToolBadge tone={result.error ? 'amber' : 'emerald'}>{result.error ? '解析失败' : '已转换'}</ToolBadge>}
    >
      <div className="flex flex-col gap-3.5 h-full">
        {/* 格式选择 */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/70 bg-white px-3.5 py-2.5 dark:border-dark-border dark:bg-dark-panel">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">从</span>
          <Segmented value={from} options={FORMAT_OPTIONS} onChange={setFrom} />
          <button
            type="button"
            onClick={swap}
            disabled={!!result.error || !result.output}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40 dark:bg-dark-hover dark:text-slate-300"
            title="把输出换到左边继续编辑"
          >
            <ArrowLeftRight size={12} />
            交换
          </button>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">转为</span>
          <Segmented value={to} options={FORMAT_OPTIONS} onChange={setTo} />
          <div className="ml-auto">
            <button
              type="button"
              onClick={autoDetect}
              disabled={!input.trim()}
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-40 dark:text-brand-400 dark:hover:bg-brand-500/10"
            >
              <Sparkles size={12} />
              自动识别输入格式
            </button>
          </div>
        </div>

        <p className={META}>
          {from.toUpperCase()}：{HINTS[from]} · {to.toUpperCase()}：{HINTS[to]}
        </p>

        <div className="tool-cascade grid grid-cols-1 h-full gap-3.5 xl:grid-cols-2">
          <ToolCard>
            <ToolCardHeader title="输入" meta={input ? `${input.length} 字符` : undefined} />
            <CodeEditor value={input} onChange={setInput} placeholder={`在这里粘贴 ${from.toUpperCase()} 内容…`} />
          </ToolCard>

          <ToolCard>
            <ToolCardHeader
              title="输出"
              icon={Replace}
              actions={<CopyButton value={() => result.output} disabled={!result.output} label="复制输出" />}
            />
            {result.error ? (
              <div className="p-4">
                <ToolNotice tone="error" icon={FileWarning}>
                  {result.error}
                </ToolNotice>
              </div>
            ) : (
              <CodeEditor value={result.output} readOnly placeholder="转换结果会显示在这里" />
            )}
          </ToolCard>
        </div>
      </div>
    </ToolShell>
  )
}
