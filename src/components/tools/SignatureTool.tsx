import { useEffect, useRef, useState } from 'react'
import { Check, File as FileIcon, KeyRound, ShieldCheck, ShieldX, TriangleAlert, X } from 'lucide-react'
import {
  BODY_TEXTAREA,
  BTN,
  META,
  SECTION_LABEL,
  Segmented,
  Select,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolNotice,
  ToolShell,
  CopyButton,
} from '../ui'
import {
  DIGEST_ALGORITHMS,
  HMAC_ALGORITHMS,
  diffPositions,
  digest,
  digestBytes,
  formatBytes,
  hmac,
  hmacBytes,
  normalizeSignature,
  timingSafeEqual,
  type DigestAlgorithm,
  type HmacAlgorithm,
  type OutputEncoding,
} from '../../utils/signature'

type Mode = 'hmac' | 'digest' | 'verify'
type SourceKind = 'text' | 'file'

const MODE_OPTIONS = [
  { value: 'hmac' as const, label: 'HMAC 签名' },
  { value: 'digest' as const, label: '摘要' },
  { value: 'verify' as const, label: '签名比对' },
]

const SOURCE_OPTIONS = [
  { value: 'text' as const, label: '文本' },
  { value: 'file' as const, label: '文件' },
]

const ENCODING_OPTIONS = [
  { value: 'hex' as const, label: 'Hex' },
  { value: 'base64' as const, label: 'Base64' },
]

/** 一行「标签 + 值」，签名比对结果里的元信息用 */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className={SECTION_LABEL}>{label}</span>
      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">{value}</span>
    </div>
  )
}

/**
 * 逐字符高亮差异。
 *
 * 不做「整串标红」—— 两个 64 位 hex 里只差一个字符时，全红等于没说。
 * 公共前缀/后缀保持原色，只有中间那段不同才染红，用户一眼能定位。
 * 首尾用 … 收尾，避免超长签名把卡片撑破。
 */
function DiffHighlight({ expected, actual }: { expected: string; actual: string }) {
  const left = normalizeSignature(expected)
  const right = normalizeSignature(actual)
  const span = diffPositions(left, right)

  if (!span) {
    return <span className="text-emerald-600 dark:text-emerald-400">{actual}</span>
  }

  const render = (text: string) => {
    const head = text.slice(0, span.first)
    const middle = text.slice(span.first, span.last + 1)
    const tail = text.slice(span.last + 1)
    return (
      <>
        {head}
        <mark className="bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300 rounded-[3px] px-px">
          {middle || '␀'}
        </mark>
        {tail}
      </>
    )
  }

  return (
    <span className="break-all">
      {render(right)}
      <span className="block mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-sans">
        与期望值第 <span className="font-mono font-semibold">{span.first + 1}</span> 位起不同
        {span.last > span.first && (
          <>
            ，到第 <span className="font-mono font-semibold">{span.last + 1}</span> 位
          </>
        )}
      </span>
    </span>
  )
}

/**
 * 文件投放区。
 *
 * 用 input[type=file] 而不是 Electron 的 dialog：同一份代码在浏览器里也能跑
 * （拖动或点击都行），不额外依赖主进程，打包成 Web / 移动端时不用改。
 */
function FileDrop({
  file,
  onPick,
  onClear,
}: {
  file: File | null
  onPick: (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-slate-200/70 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/40 px-3 py-2.5">
        <FileIcon size={16} className="text-brand-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 truncate">
            {file.name}
          </p>
          <p className={`${META} tabular-nums`}>{formatBytes(file.size)}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          title="移除文件"
          className="shrink-0 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const dropped = e.dataTransfer.files?.[0]
        if (dropped) onPick(dropped)
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors ${
        dragging
          ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/50 dark:bg-brand-500/10'
          : 'border-slate-200 dark:border-dark-border hover:border-slate-300 dark:hover:border-slate-600'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked) onPick(picked)
          // 清掉 value，否则连续选同一个文件不会再触发 change
          e.target.value = ''
        }}
      />
      <FileIcon size={20} className="text-slate-300 dark:text-slate-600" />
      <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
        拖入文件，或点击选择
      </p>
      <p className="text-[11px] text-slate-400 dark:text-slate-600">
        按原始字节签名，不做任何编码转换
      </p>
    </div>
  )
}

export default function SignatureTool() {
  const [mode, setMode] = useState<Mode>('hmac')
  const [source, setSource] = useState<SourceKind>('text')
  const [algorithm, setAlgorithm] = useState<HmacAlgorithm | DigestAlgorithm>('SHA-256')
  const [encoding, setEncoding] = useState<OutputEncoding>('hex')
  const [key, setKey] = useState('')
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [expected, setExpected] = useState('')

  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  /** 比对结论。null 表示输入还没齐，不显示判定 */
  const [verdict, setVerdict] = useState<boolean | null>(null)

  const isHmac = mode === 'hmac'
  const algorithmOptions = isHmac ? HMAC_ALGORITHMS : DIGEST_ALGORITHMS

  /*
   * 切模式时算法可能不在新模式的候选里（HMAC 有 SHA-512，摘要也有，
   * 但两边集合不同），落到第一个合法值，免得 Select 显示空白。
   */
  useEffect(() => {
    if (!algorithmOptions.includes(algorithm as never)) setAlgorithm(algorithmOptions[0])
  }, [mode, algorithm, algorithmOptions])

  const isFile = source === 'file'
  const keyMissing = isHmac && !key
  /** 有输入才算「可执行」：文本看 message，文件看有没有挑中文件 */
  const hasInput = isFile ? Boolean(file) : Boolean(message)
  const canRun = hasInput && !running && !keyMissing

  /**
   * 取待签内容的字节。
   *
   * 文本走 UTF-8 编码，文件走 arrayBuffer —— 这两条路必须分清：
   * 二进制文件按 UTF-8 解码再编码会丢字节，签出来是错的。
   */
  const readPayload = async (): Promise<Uint8Array | null> => {
    if (!isFile) return null
    if (!file) return null
    return new Uint8Array(await file.arrayBuffer())
  }

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      const bytes = await readPayload()

      if (mode === 'digest') {
        const output = bytes
          ? await digestBytes(algorithm as DigestAlgorithm, bytes, encoding)
          : await digest(algorithm as DigestAlgorithm, message, encoding)
        setResult(output)
        setVerdict(null)
      } else {
        // HMAC 与比对模式都要密钥；比对模式现算一遍再做常量时间比较
        const output = bytes
          ? await hmacBytes(algorithm as HmacAlgorithm, new TextEncoder().encode(key), bytes, encoding)
          : await hmac(algorithm as HmacAlgorithm, key, message, encoding)
        setResult(output)
        setVerdict(mode === 'verify' ? await timingSafeEqual(expected, output) : null)
      }
    } catch (e) {
      setError((e as Error).message)
      setVerdict(null)
    } finally {
      setRunning(false)
    }
  }

  const clearAll = () => {
    setMessage('')
    setFile(null)
    setExpected('')
    setResult('')
    setError('')
    setVerdict(null)
  }

  /** 期望值改了，上一次的判定就作废 —— 否则会挂着一个过期的对勾 */
  const onExpectedChange = (value: string) => {
    setExpected(value)
    setVerdict(null)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <ToolShell
        icon={ShieldCheck}
        title="签名工作台"
        subtitle="HMAC-SHA256 生成、摘要计算与常量时间比对"
        contentClassName="min-h-0"
        badge={
          <ToolBadge tone={verdict === false ? 'rose' : verdict ? 'emerald' : 'brand'}>
            {verdict === null ? '就绪' : verdict ? '签名一致' : '签名不一致'}
          </ToolBadge>
        }
      >
        {error && (
          <ToolNotice tone="error" icon={TriangleAlert}>
            <p className="whitespace-pre-line">{error}</p>
          </ToolNotice>
        )}

        <div className="h-full min-h-[420px] grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 items-stretch">
          {/* ---------------- 左：参数与输入 ---------------- */}
          <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-1">
            <ToolCard fill={false}>
              <ToolCardHeader title="参数" sublabel="PARAMS" />
              <div className="p-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className={SECTION_LABEL}>模式</span>
                  <Segmented value={mode} onChange={setMode} options={MODE_OPTIONS} />
                </div>
                <div className="flex flex-col gap-2">
                  <span className={SECTION_LABEL}>输入</span>
                  <Segmented value={source} onChange={setSource} options={SOURCE_OPTIONS} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <span className={SECTION_LABEL}>算法</span>
                    <Select
                      value={algorithm}
                      onChange={setAlgorithm}
                      options={algorithmOptions.map((item) => ({ value: item, label: item }))}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className={SECTION_LABEL}>输出格式</span>
                    <Select
                      value={encoding}
                      onChange={setEncoding}
                      options={ENCODING_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                    />
                  </div>
                </div>
              </div>
            </ToolCard>

            {isHmac && (
              <ToolCard fill={false}>
                <ToolCardHeader
                  title="密钥"
                  icon={KeyRound}
                  meta="Secret"
                />
                <div className="p-4">
                  <textarea
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="HMAC 的密钥（Secret Key），任意长度"
                    rows={2}
                    className="w-full bg-slate-50/70 dark:bg-dark-hover/40 border border-slate-200/70 dark:border-dark-border rounded-lg px-3 py-2 resize-none outline-none font-mono text-[12px] leading-5 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-brand-400"
                  />
                  {keyMissing && (
                    <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                      还没填密钥，填了才能签名
                    </p>
                  )}
                </div>
              </ToolCard>
            )}

            {isFile ? (
              <ToolCard fill={false}>
                <ToolCardHeader
                  title="文件"
                  sublabel="FILE"
                  meta={mode === 'digest' ? '计算摘要' : '按字节签名'}
                />
                <div className="p-4">
                  <FileDrop file={file} onPick={setFile} onClear={() => setFile(null)} />
                </div>
              </ToolCard>
            ) : (
              <ToolCard className="flex-1 min-h-[140px]">
                <ToolCardHeader
                  title={mode === 'digest' ? '原文' : '待签内容'}
                  sublabel="MESSAGE"
                  meta={mode === 'digest' ? '纯文本' : '原文不参与传输'}
                />
                <div className="flex-1 min-h-0 p-4 flex flex-col">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={
                      isHmac
                        ? '要签名的内容。签名串常是 method + path + 时间戳 + body 拼起来的，原样贴进来'
                        : '要计算摘要的内容'
                    }
                    className={BODY_TEXTAREA}
                  />
                </div>
                <ToolCardFooter>
                  <span className="font-mono">{message.length} 字符</span>
                  <span className={META}>UTF-8</span>
                </ToolCardFooter>
              </ToolCard>
            )}

            {mode === 'verify' && (
              <ToolCard fill={false}>
                <ToolCardHeader title="期望签名" sublabel="EXPECTED" meta="服务端返回的那个" />
                <div className="p-4">
                  <textarea
                    value={expected}
                    onChange={(e) => onExpectedChange(e.target.value)}
                    placeholder="从服务端文档 / 日志里复制的签名值，大小写与空白都会自动忽略"
                    rows={3}
                    className="w-full bg-slate-50/70 dark:bg-dark-hover/40 border border-slate-200/70 dark:border-dark-border rounded-lg px-3 py-2 resize-none outline-none font-mono text-[12px] leading-5 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-brand-400"
                  />
                </div>
              </ToolCard>
            )}
          </div>

          {/* ---------------- 右：结果 ---------------- */}
          <ToolCard className="min-h-[200px]">
            <ToolCardHeader
              title={mode === 'verify' ? '比对结果' : '签名结果'}
              sublabel="RESULT"
              meta={algorithm}
              actions={<CopyButton value={() => result} disabled={!result} />}
            />
            <div className="flex-1 min-h-0 p-4 flex flex-col gap-3 overflow-y-auto">
              {mode === 'verify' && verdict !== null && (
                <div
                  className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold shrink-0 ${
                    verdict
                      ? 'border-emerald-200/70 bg-emerald-50/60 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : 'border-rose-200/70 bg-rose-50/60 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300'
                  }`}
                >
                  {verdict ? <Check size={15} /> : <ShieldX size={15} />}
                  {verdict ? '一致，签名正确' : '不一致，签名不匹配'}
                </div>
              )}

              {mode === 'verify' && verdict === false && result && (
                <div className="shrink-0">
                  <p className={`${SECTION_LABEL} mb-1.5`}>实际签名</p>
                  <div className="font-mono text-[12px] leading-6 text-slate-700 dark:text-slate-200 bg-slate-50/70 dark:bg-dark-hover/40 rounded-lg px-3 py-2">
                    <DiffHighlight expected={expected} actual={result} />
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex-1 min-h-0 overflow-y-auto select-text whitespace-pre-wrap break-all font-mono text-[13px] leading-6 text-slate-800 dark:text-slate-100">
                  {result || (
                    <span className="text-slate-300 dark:text-slate-600">
                      签名结果将在此呈现…
                    </span>
                  )}
                </div>
              </div>

              {mode === 'verify' && result && (
                <div className="shrink-0 flex flex-col gap-1.5 border-t border-slate-200/60 dark:border-dark-border pt-3">
                  <MetaRow label="算法" value={algorithm} />
                  <MetaRow label="格式" value={encoding === 'hex' ? 'Hex' : 'Base64'} />
                  <MetaRow label="长度" value={`${result.length} 字符`} />
                </div>
              )}
            </div>
            <ToolCardFooter>
              <span className="font-mono">{result.length} 字符</span>
              <span className={META}>
                {mode === 'verify' ? '比对大小写不敏感' : '复制后可直接用于请求头'}
              </span>
            </ToolCardFooter>
          </ToolCard>
        </div>
      </ToolShell>

      <div className="shrink-0 px-4 md:px-6 py-3">
        <ToolActionBar
          info={
            <>
              {isHmac ? '将按' : '将计算'}
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                {isHmac ? `HMAC-${algorithm}` : `${algorithm} 摘要`}
              </span>
              {isFile && (
                <>
                  处理
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {file ? file.name : '文件'}
                  </span>
                </>
              )}
              {mode === 'verify' ? '并与期望值比对' : `，输出 ${encoding === 'hex' ? 'Hex' : 'Base64'}`}
            </>
          }
        >
          <button type="button" onClick={() => void run()} disabled={!canRun} className={BTN.primary}>
            {running ? '计算中…' : mode === 'verify' ? '比对签名' : mode === 'digest' ? '计算摘要' : '生成签名'}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={!message && !file && !expected && !result}
            className={BTN.secondary}
          >
            清空
          </button>
        </ToolActionBar>
      </div>
    </div>
  )
}
