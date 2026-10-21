import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileWarning, Fingerprint, Loader2, Upload, X, XCircle } from 'lucide-react'
import {
  CopyButton,
  META,
  SECTION_LABEL,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolEmpty,
  ToolNotice,
  ToolShell,
  ToolTag,
} from '../ui'

type Algo = 'md5' | 'sha1' | 'sha256' | 'sha512'

const ALGOS: { id: Algo; label: string; bits: number }[] = [
  { id: 'md5', label: 'MD5', bits: 32 },
  { id: 'sha1', label: 'SHA-1', bits: 40 },
  { id: 'sha256', label: 'SHA-256', bits: 64 },
  { id: 'sha512', label: 'SHA-512', bits: 128 },
]

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** 按期望哈希的长度判断它是哪种算法，和主进程的 guessAlgorithm 规则一致 */
function guessAlgo(value: string): Algo | null {
  const clean = value.trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(clean)) return null
  return ALGOS.find((algo) => algo.bits === clean.length)?.id ?? null
}

export default function FileHashTool() {
  const api = window.electronAPI
  const available = !!api?.hashCompute

  const [files, setFiles] = useState<string[]>([])
  const [algos, setAlgos] = useState<Algo[]>(['md5', 'sha256'])
  const [results, setResults] = useState<HashFileResult[]>([])
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ path: string; readBytes: number; totalBytes: number } | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const requestRef = useRef(0)

  // 大文件计算时，主进程会推送进度
  useEffect(() => {
    if (!api?.onHashProgress) return
    return api.onHashProgress((event) => {
      if (event.requestId !== requestRef.current) return
      setProgress({ path: event.path, readBytes: event.readBytes, totalBytes: event.totalBytes })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available])

  const addPaths = (paths: string[]) => {
    const unique = paths.filter((p) => p && !files.includes(p))
    if (unique.length === 0) return
    setFiles((prev) => [...prev, ...unique])
    setResults([])
  }

  const pick = async () => {
    if (!api?.hashPick) return
    addPaths(await api.hashPick())
  }

  const toggleAlgo = (algo: Algo) => {
    setAlgos((prev) => (prev.includes(algo) ? prev.filter((a) => a !== algo) : [...prev, algo]))
  }

  const compute = async () => {
    if (!api?.hashCompute || files.length === 0 || algos.length === 0) return
    setError('')
    setBusy(true)
    requestRef.current += 1
    const requestId = requestRef.current
    setProgress(null)
    try {
      const list = await api.hashCompute({ paths: files, algorithms: algos, requestId })
      setResults(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : '计算失败')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const expectedAlgo = guessAlgo(expected)
  const expectedHex = expected.trim().toLowerCase()

  /** 只在当前选中的算法里找期望值；每个文件给出「哪种算法、是否一致」 */
  const verdicts = useMemo(() => {
    if (!expectedHex || results.length === 0) return null
    return results.map((item) => {
      if (item.error) return { ok: false, text: item.error }
      if (!expectedAlgo) return { ok: false, text: '期望值的长度不对应任何算法' }
      const actual = item.digests[expectedAlgo]
      if (!actual) return { ok: false, text: `没有计算 ${expectedAlgo.toUpperCase()}，请勾选后重算` }
      return actual === expectedHex
        ? { ok: true, text: `与期望值一致（${expectedAlgo.toUpperCase()}）` }
        : { ok: false, text: `与期望值不一致（${expectedAlgo.toUpperCase()}）` }
    })
  }, [expectedHex, expectedAlgo, results])

  /** 两个文件时逐算法比对是否完全相同 */
  const pairCompare = useMemo(() => {
    if (results.length !== 2 || results.some((r) => r.error)) return null
    const [a, b] = results
    return algos.map((algo) => ({
      algo,
      same: !!a.digests[algo] && a.digests[algo] === b.digests[algo],
    }))
  }, [results, algos])

  if (!available) {
    return (
      <ToolShell icon={Fingerprint} title="文件哈希校验" subtitle="仅桌面版可用">
        <ToolNotice tone="info" icon={FileWarning}>
          文件哈希需要运行在 devNotes 桌面版中，计算在主进程完成。
        </ToolNotice>
      </ToolShell>
    )
  }

  return (
    <ToolShell
      icon={Fingerprint}
      title="文件哈希校验"
      subtitle="MD5 / SHA 系列校验，可对照期望值，也能比较两个文件是否相同"
      badge={files.length > 0 ? <ToolBadge tone="brand">{files.length} 个文件</ToolBadge> : undefined}
    >
      <div className="tool-cascade grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* 左：文件与设置 */}
        <div className="flex flex-col gap-4">
          <ToolCard fill={false}>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                setDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const paths = api?.filePathsFromFiles?.(Array.from(e.dataTransfer.files ?? [])) ?? []
                addPaths(paths)
              }}
              className={`m-3.5 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
                dragging
                  ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/50 dark:bg-brand-500/10'
                  : 'border-slate-200 dark:border-dark-border'
              }`}
            >
              <Upload size={18} className="text-slate-400" />
              <p className="text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">把文件拖到这里</p>
              <button type="button" onClick={() => void pick()} className="text-[11.5px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                或点击选择文件
              </button>
              <p className={META}>大文件在后台流式计算，不会卡住界面</p>
            </div>

            {files.length > 0 && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-dark-border dark:border-dark-border">
                {files.map((path) => (
                  <li key={path} className="flex items-center gap-2 px-3.5 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-slate-600 dark:text-slate-300" title={path}>
                      {path.split(/[\\/]/).pop()}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles((prev) => prev.filter((p) => p !== path))
                        setResults([])
                      }}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ToolCard>

          <ToolCard fill={false}>
            <ToolCardHeader title="算法" icon={Fingerprint} />
            <div className="flex flex-col gap-3.5 p-3.5">
              <div className="flex flex-wrap gap-1.5">
                {ALGOS.map((algo) => {
                  const on = algos.includes(algo.id)
                  return (
                    <button
                      key={algo.id}
                      type="button"
                      onClick={() => toggleAlgo(algo.id)}
                      className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                        on
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-dark-hover dark:text-slate-300'
                      }`}
                    >
                      {algo.label}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => void compute()}
                disabled={busy || files.length === 0 || algos.length === 0}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-[13px] font-semibold text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={14} />}
                {busy ? '计算中…' : '计算哈希'}
              </button>
              {progress && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[10.5px] text-slate-400 dark:text-slate-500">
                    <span className="truncate">{progress.path.split(/[\\/]/).pop()}</span>
                    <span className="font-mono tabular-nums">
                      {Math.round((progress.readBytes / Math.max(1, progress.totalBytes)) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-dark-hover">
                    <div
                      className="h-full bg-brand-500 transition-[width] duration-150"
                      style={{ width: `${Math.round((progress.readBytes / Math.max(1, progress.totalBytes)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {error && (
                <ToolNotice tone="error" icon={FileWarning}>
                  {error}
                </ToolNotice>
              )}
            </div>
          </ToolCard>

          <ToolCard fill={false}>
            <ToolCardHeader title="对照期望值" icon={CheckCircle2} sublabel="粘贴官网给出的哈希，自动识别算法" />
            <div className="flex flex-col gap-2 p-3.5">
              <input
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="粘贴哈希值（32 / 40 / 64 / 128 位十六进制）"
                spellCheck={false}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11.5px] text-slate-800 outline-none focus:border-brand-400 dark:border-dark-border dark:bg-dark-panel dark:text-slate-100"
              />
              {expectedHex && (
                <p className={META}>
                  {expectedAlgo ? `识别为 ${expectedAlgo.toUpperCase()}` : '无法识别算法，请检查长度'}
                </p>
              )}
            </div>
          </ToolCard>
        </div>

        {/* 右：结果 */}
        <div className="flex min-w-0 flex-col gap-4">
          {results.length === 0 ? (
            <ToolCard fill={false}>
              <ToolEmpty icon={Fingerprint} title="还没有计算结果" hint="选择文件、勾选算法后点击「计算哈希」" className="min-h-[300px]" />
            </ToolCard>
          ) : (
            <>
              {pairCompare && (
                <ToolCard fill={false}>
                  <ToolCardHeader title="两个文件对比" icon={Fingerprint} sublabel="逐个算法比较，全部相同才算相同" />
                  <div className="flex flex-wrap gap-2 p-3.5">
                    {pairCompare.map((row) => (
                      <ToolTag key={row.algo} tone={row.same ? 'emerald' : 'amber'}>
                        {row.same ? '相同' : '不同'} · {row.algo.toUpperCase()}
                      </ToolTag>
                    ))}
                  </div>
                </ToolCard>
              )}

              {results.map((item, index) => {
                const verdict = verdicts?.[index]
                return (
                  <ToolCard key={item.path} fill={false}>
                    <ToolCardHeader
                      title={item.name}
                      icon={Fingerprint}
                      meta={item.error ? '失败' : formatSize(item.size)}
                    />
                    <div className="flex flex-col gap-2.5 p-3.5">
                      {item.error ? (
                        <ToolNotice tone="error" icon={XCircle}>
                          {item.error}
                        </ToolNotice>
                      ) : (
                        algos.map((algo) => (
                          <div key={algo} className="flex items-center gap-2.5">
                            <span className={`${SECTION_LABEL} w-14 shrink-0`}>{algo.toUpperCase()}</span>
                            <span className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-slate-700 dark:text-slate-200">
                              {item.digests[algo]}
                            </span>
                            {item.digests[algo] && <CopyButton value={item.digests[algo] as string} label={`复制 ${algo.toUpperCase()}`} size={13} />}
                          </div>
                        ))
                      )}
                      {verdict && (
                        <p className={`flex items-center gap-1.5 text-[11.5px] font-semibold ${verdict.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                          {verdict.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                          {verdict.text}
                        </p>
                      )}
                    </div>
                  </ToolCard>
                )
              })}
            </>
          )}
        </div>
      </div>
    </ToolShell>
  )
}
