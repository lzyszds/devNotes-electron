import { Fragment, useMemo, useState } from 'react'
import {
  Wand2,
  Minimize2,
  ArrowUpDown,
  Trash2,
  Copy,
  Download,
  GitCompareArrows,
  CheckCircle2,
  AlertTriangle,
  History,
  Clock,
  ChevronRight,
} from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'

type JsonFormatToolProps = {
  mode?: 'format' | 'diff'
}

type DiffLine = {
  left: string
  right: string
  status: 'same' | 'added' | 'removed' | 'changed'
}

const formatForDisplay = (value: string) => {
  if (!value.trim()) return ''
  return JSON.stringify(JSON.parse(value), null, 2)
}

const sortObjectKeys = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(sortObjectKeys)

  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce((result, key) => {
        ;(result as Record<string, unknown>)[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
        return result
      }, {} as Record<string, unknown>)
  }

  return obj
}

const buildDiffLines = (leftText: string, rightText: string): DiffLine[] => {
  const leftLines = leftText.split('\n')
  const rightLines = rightText.split('\n')
  const lineCount = Math.max(leftLines.length, rightLines.length)

  return Array.from({ length: lineCount }, (_, index) => {
    const left = leftLines[index] ?? ''
    const right = rightLines[index] ?? ''

    if (left === right) return { left, right, status: 'same' as const }
    if (!left && right) return { left, right, status: 'added' as const }
    if (left && !right) return { left, right, status: 'removed' as const }

    return { left, right, status: 'changed' as const }
  })
}

const diffStyles: Record<DiffLine['status'], string> = {
  same: 'border-slate-200 bg-white text-slate-500',
  added: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  removed: 'border-rose-200 bg-rose-50 text-rose-700',
  changed: 'border-amber-200 bg-amber-50 text-amber-700',
}

export default function JsonFormatTool({ mode = 'format' }: JsonFormatToolProps) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [leftInput, setLeftInput] = useState('')
  const [rightInput, setRightInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const { history, saveHistory, clearHistory } = useToolHistory<string>(mode === 'diff' ? 'json-diff' : 'json-format')

  const formatJson = () => {
    if (!input.trim()) return
    try {
      const parsed = JSON.parse(input)
      const formatted = JSON.stringify(parsed, null, 2)
      setOutput(formatted)
      setError('')
      saveHistory(input, input.slice(0, 30) + '...')
    } catch (err) {
      setError('JSON 格式错误: ' + (err as Error).message)
      setOutput('')
    }
  }

  const compressJson = () => {
    if (!input.trim()) return
    try {
      const parsed = JSON.parse(input)
      setOutput(JSON.stringify(parsed))
      setError('')
      saveHistory(input, 'Compressed JSON')
    } catch {
      setError('JSON 格式错误')
    }
  }

  const sortKeys = () => {
    if (!input.trim()) return
    try {
      const parsed = JSON.parse(input)
      const sorted = sortObjectKeys(parsed)
      setOutput(JSON.stringify(sorted, null, 2))
      setError('')
      saveHistory(input, 'Sorted JSON')
    } catch {
      setError('JSON 格式错误')
    }
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  const downloadOutput = () => {
    const blob = new Blob([output], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'formatted.json'
    link.click()
  }

  const leftParsed = useMemo(() => {
    try {
      return { formatted: formatForDisplay(leftInput), error: '' }
    } catch (err) {
      return { formatted: '', error: '左侧 JSON 无法解析: ' + (err as Error).message }
    }
  }, [leftInput])

  const rightParsed = useMemo(() => {
    try {
      return { formatted: formatForDisplay(rightInput), error: '' }
    } catch (err) {
      return { formatted: '', error: '右侧 JSON 无法解析: ' + (err as Error).message }
    }
  }, [rightInput])

  const diffError = leftParsed.error || rightParsed.error

  const diffLines = useMemo(() => {
    if (!leftParsed.formatted || !rightParsed.formatted) return []
    return buildDiffLines(leftParsed.formatted, rightParsed.formatted)
  }, [leftParsed.formatted, rightParsed.formatted])

  const diffStats = useMemo(
    () =>
      diffLines.reduce(
        (stats, line) => {
          stats[line.status] += 1
          return stats
        },
        { same: 0, added: 0, removed: 0, changed: 0 },
      ),
    [diffLines],
  )

  const restoreHistory = (data: string) => {
    if (mode === 'diff') {
      // For diff, we might need a more complex history object to store both sides.
      // For now, let's assume it's single side for simplicity or store an object.
      setLeftInput(data)
    } else {
      setInput(data)
    }
    setShowHistory(false)
  }

  if (mode === 'diff') {
    return (
      <div className="flex h-full min-h-[600px]">
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">JSON Diff</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">双栏比对工作区</h3>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`tool-button-secondary ${showHistory ? 'bg-slate-100 ring-1 ring-slate-900' : ''}`}
              >
                <History className="h-4 w-4" />
                历史
              </button>
              <button
                onClick={() => {
                  setLeftInput('')
                  setRightInput('')
                }}
                className="tool-button-secondary"
              >
                <Trash2 className="h-4 w-4" />
                清空
              </button>
              <button
                onClick={() => {
                  if (!leftInput || !rightInput) return
                  saveHistory(JSON.stringify({ left: leftInput, right: rightInput }), `Diff: ${leftInput.slice(0, 10)} vs ${rightInput.slice(0, 10)}`)
                  navigator.clipboard.writeText(
                    diffLines
                      .map((line, index) => `#${index + 1}\nLEFT: ${line.left}\nRIGHT: ${line.right}\nSTATUS: ${line.status}`)
                      .join('\n\n'),
                  )
                }}
                className="tool-button-accent"
              >
                <Copy className="h-4 w-4" />
                复制 Diff
              </button>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="tool-panel">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Matched</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{diffStats.same}</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="text-xs uppercase tracking-[0.2em] text-emerald-600">Added</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-700">{diffStats.added}</div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
              <div className="text-xs uppercase tracking-[0.2em] text-rose-600">Removed</div>
              <div className="mt-2 text-2xl font-semibold text-rose-700">{diffStats.removed}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-xs uppercase tracking-[0.2em] text-amber-600">Changed</div>
              <div className="mt-2 text-2xl font-semibold text-amber-700">{diffStats.changed}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="tool-panel">
              <label className="tool-label">左侧 JSON</label>
              <textarea
                value={leftInput}
                onChange={(event) => setLeftInput(event.target.value)}
                placeholder='{\n  "service": "alpha",\n  "status": "ready"\n}'
                className="tool-textarea min-h-[320px]"
              />
            </div>

            <div className="tool-panel">
              <label className="tool-label">右侧 JSON</label>
              <textarea
                value={rightInput}
                onChange={(event) => setRightInput(event.target.value)}
                placeholder='{\n  "service": "beta",\n  "status": "ready"\n}'
                className="tool-textarea min-h-[320px]"
              />
            </div>
          </div>

          {diffError ? (
            <div className="status-note mt-5 border-amber-200 bg-amber-50 text-amber-700">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {diffError}
              </div>
            </div>
          ) : (
            <div className="tool-panel mt-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Comparison View</p>
                  <h4 className="mt-1 flex items-center gap-2 text-base font-semibold text-slate-900">
                    <GitCompareArrows className="h-4 w-4 text-sky-500" />
                    行级对比
                  </h4>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  实时比对
                </div>
              </div>

              <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] gap-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-400">
                <div className="px-2 py-2 uppercase tracking-[0.2em]">Line</div>
                <div className="px-2 py-2 uppercase tracking-[0.2em]">Left JSON</div>
                <div className="px-2 py-2 uppercase tracking-[0.2em]">Right JSON</div>

                {diffLines.length === 0 ? (
                  <div className="col-span-3 flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white text-sm text-slate-400">
                    粘贴两份合法 JSON 后，这里会展示差异
                  </div>
                ) : (
                  diffLines.map((line, index) => (
                    <Fragment key={`diff-${index}`}>
                      <div className={`rounded-lg border px-2 py-2 font-mono ${diffStyles[line.status]}`}>
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <pre className={`overflow-x-auto rounded-lg border px-3 py-2 font-mono ${diffStyles[line.status]}`}>
                        {line.left || ' '}
                      </pre>
                      <pre className={`overflow-x-auto rounded-lg border px-3 py-2 font-mono ${diffStyles[line.status]}`}>
                        {line.right || ' '}
                      </pre>
                    </Fragment>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* History Sidebar */}
        {showHistory && (
          <aside className="w-80 border-l border-slate-200 bg-slate-50/50 flex flex-col shrink-0 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Clock size={16} />
                使用历史
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
                      if (mode === 'diff') {
                        try {
                          const data = JSON.parse(item.data)
                          setLeftInput(data.left)
                          setRightInput(data.right)
                        } catch {
                          setLeftInput(item.data)
                        }
                      } else {
                        setInput(item.data)
                      }
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

  return (
    <div className="flex h-full min-h-[600px]">
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">JSON Beautifier</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">格式化工作区</h3>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`tool-button-secondary ${showHistory ? 'bg-slate-100 ring-1 ring-slate-900' : ''}`}
            >
              <History className="h-4 w-4" />
              历史
            </button>
            <button onClick={formatJson} className="tool-button-primary">
              <Wand2 className="h-4 w-4" />
              美化
            </button>
            <button onClick={compressJson} className="tool-button-secondary">
              <Minimize2 className="h-4 w-4" />
              压缩
            </button>
            <button onClick={sortKeys} className="tool-button-secondary">
              <ArrowUpDown className="h-4 w-4" />
              排序
            </button>
            <button
              onClick={() => {
                setInput('')
                setOutput('')
                setError('')
              }}
              className="tool-button-secondary"
            >
              <Trash2 className="h-4 w-4" />
              清空
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="tool-panel">
            <label className="tool-label h-[38px] flex items-center">输入 JSON</label>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="在此粘贴 JSON 内容..."
              className="tool-textarea min-h-[420px]"
            />
          </div>

          <div className="tool-panel">
            <div className="mb-3 flex items-center justify-between">
              <label className="tool-label mb-0">输出结果</label>
              <div className="flex gap-2">
                <button onClick={copyOutput} className="tool-button-secondary px-3 py-2">
                  <Copy className="h-4 w-4" />
                </button>
                <button onClick={downloadOutput} className="tool-button-secondary px-3 py-2">
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </div>

            {error ? (
              <div className="status-note flex min-h-[420px] items-start gap-3 border-rose-200 bg-rose-50 text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : (
              <textarea
                value={output}
                readOnly
                placeholder="格式化后的 JSON 将显示在这里..."
                className="tool-textarea min-h-[420px]"
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
              使用历史
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
