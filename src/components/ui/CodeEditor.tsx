import { useMemo, type UIEvent } from 'react'

/*
 * 带行号与 JSON 语法高亮的代码编辑区。
 *
 * 结构（react-simple-code-editor 同款，久经验证）：
 *   外层是唯一的滚动容器 —— 编辑区、行号槽都放在它里面自然流动，
 *   不存在任何 transform 同步；
 *   行号槽 sticky 吸附在左侧，横向滚动时保持可见；
 *   高亮 <pre> 在文档流里撑开宽高，透明文字的 <textarea> 绝对定位盖在上面。
 * 关键约定：pre 与 textarea 的字体、字号、行高、内边距必须完全一致。
 */

const TOKEN_SPAN = {
  key: 'text-sky-700 dark:text-sky-300 font-semibold',
  string: 'text-emerald-700 dark:text-emerald-300',
  number: 'text-brand-600 dark:text-brand-300',
  literal: 'text-amber-600 dark:text-amber-400 font-semibold',
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 单遍词法扫描：一个正则一次跑完，逐 token 转义后直接定稿。
 * 不做链式二次替换，杜绝数字规则污染 span class 的可能。
 */
function highlightJson(source: string): string {
  const tokenizer =
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|[\s\S]/g
  let out = ''
  let match: RegExpExecArray | null
  let guard = 0
  while ((match = tokenizer.exec(source)) !== null) {
    if (match[1]) {
      const cls = match[2] ? TOKEN_SPAN.key : TOKEN_SPAN.string
      out += `<span class="${cls}">${escapeHtml(match[1])}</span>${match[2] ?? ''}`
    } else if (match[3]) {
      out += `<span class="${TOKEN_SPAN.number}">${match[3]}</span>`
    } else if (match[4]) {
      out += `<span class="${TOKEN_SPAN.literal}">${match[4]}</span>`
    } else {
      out += escapeHtml(match[0])
    }
    if (match.index === tokenizer.lastIndex) tokenizer.lastIndex += 1 // 空串兜底，防死循环
    if (++guard > 2_000_000) break
  }
  return out
}

/** 行高写死：行号槽、高亮层、输入层三方共用同一像素值，杜绝漂移 */
const LINE_HEIGHT = '24px'

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
  /** 是否关掉高亮（纯文本场景） */
  plain?: boolean
}

export default function CodeEditor({
  value,
  onChange,
  readOnly = false,
  placeholder,
  disabled = false,
  className = '',
  plain = false,
}: CodeEditorProps) {
  const lineCount = useMemo(() => value.split('\n').length, [value])

  const highlighted = useMemo(
    () => (plain ? escapeHtml(value) : highlightJson(value)),
    [value, plain],
  )

  /** 滚动只发生在外层容器上；这里仅用于派发自定义事件（当前无需处理） */
  const noop = (_event: UIEvent<HTMLDivElement>) => {}

  const metrics = { lineHeight: LINE_HEIGHT } as const

  const textLayer =
    'absolute inset-0 w-full h-full py-3 px-3.5 font-mono text-[13px] bg-transparent resize-none border-none outline-none rounded-none'

  return (
    <div className={`relative flex-1 min-h-0 min-w-0 overflow-hidden ${className}`}>
      {/* 唯一的滚动容器 */}
      <div className="absolute inset-0 overflow-auto" onScroll={noop}>
        <div className="flex w-max min-w-full min-h-full">
          {/* 行号槽：sticky 吸附左侧，横向滚动时保持可见 */}
          <div
            className="sticky left-0 z-10 w-9 shrink-0 select-none overflow-hidden text-right font-mono text-[11px] pr-2 text-slate-300 dark:text-slate-600 border-r border-slate-100 dark:border-dark-border bg-slate-50 dark:bg-[#141821]"
            style={metrics}
          >
            <div style={{ ...metrics, paddingTop: 12 }}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          </div>

          {/* 代码区：pre 撑宽高度，textarea 相对定位 */}
          <div className="relative flex-1" style={{ minWidth: 0 }}>
            <pre
              aria-hidden
              className="m-0 py-3 px-3.5 font-mono text-[13px] whitespace-pre pointer-events-none text-slate-700 dark:text-slate-200"
              style={metrics}
              dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
            />
            {placeholder && !value && (
              <span className="absolute top-3 left-3.5 font-mono text-[13px] text-slate-300 dark:text-slate-600 pointer-events-none" style={metrics}>
                {placeholder}
              </span>
            )}
            <textarea
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              readOnly={readOnly}
              disabled={disabled}
              spellCheck={false}
              wrap="off"
              className={`${textLayer} select-text overflow-hidden text-transparent caret-slate-900 dark:caret-slate-100 selection:bg-brand-500/20 selection:text-transparent ${
                disabled ? 'cursor-not-allowed' : ''
              }`}
              style={metrics}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
