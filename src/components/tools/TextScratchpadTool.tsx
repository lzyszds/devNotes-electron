import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Eraser,
  ExternalLink,
  Eye,
  PenLine,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react'
import {
  BTN,
  META,
  Segmented,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolShell,
  ToolTag,
  iconButtonClass,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'
import { renderScratchPreview } from '../../utils/scratchMarkdown'

/**
 * 草稿纸（工具页版）。
 *
 * 和置顶小窗共用同一个存储键，所以两边看到的是同一份草稿 —— 小窗负责
 * 「浮在别的应用上面随手记」，这一页负责「窗口收起来时也能翻出来看」，
 * 以及在没有桌面端能力的环境（Web / 移动端）里提供一个可用的替代。
 */

const STORE_KEY = 'scratchpad-content'
const SAVE_DEBOUNCE_MS = 400

const EMPTY_HINT = `随手写点什么。

- 临时接口地址和 Token
- 待办清单
- 一段还没想好的 SQL

支持简易 Markdown，右上角可以切到预览。`

export default function TextScratchpadTool() {
  const { showToast } = useToast()
  const api = window.electronAPI

  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  const saveTimer = useRef<number | null>(null)
  const scratchWindowSupported = Boolean(api?.scratchOpen)

  useEffect(() => {
    let alive = true
    void api?.storeGet(STORE_KEY).then((saved) => {
      if (!alive) return
      if (typeof saved === 'string') setText(saved)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [api])

  useEffect(() => {
    if (!loaded) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void api?.storeSet(STORE_KEY, text)
      setSavedAt(Date.now())
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [text, loaded, api])

  const html = useMemo(
    () => (mode === 'preview' ? renderScratchPreview(text) : ''),
    [text, mode],
  )

  const stats = useMemo(
    () => ({
      chars: text.length,
      lines: text ? text.split('\n').length : 0,
      todos: (text.match(/^\s*[-*+]\s+\[[ xX]\]/gm) || []).length,
    }),
    [text],
  )

  return (
    <ToolShell
      icon={StickyNote}
      title="草稿纸"
      subtitle="临时记事本：不命名、不归档，关掉也不会丢"
      badge={
        <ToolBadge tone={savedAt ? 'emerald' : 'brand'}>
          {savedAt ? `已保存 ${new Date(savedAt).toLocaleTimeString()}` : '自动保存'}
        </ToolBadge>
      }
      actions={
        <>
          <Segmented
            value={mode}
            options={[
              { value: 'edit', label: '编辑', icon: PenLine },
              { value: 'preview', label: '预览', icon: Eye },
            ]}
            onChange={(value) => setMode(value as 'edit' | 'preview')}
          />
          <Tooltip
            content={
              scratchWindowSupported
                ? '弹出一张永远置顶的小窗，可以拖到 IDE 旁边'
                : '置顶小窗是桌面端能力，当前环境不支持'
            }
          >
            <button
              onClick={() => {
                if (!scratchWindowSupported) {
                  showToast('置顶小窗仅在桌面端可用', 'error')
                  return
                }
                void api?.scratchOpen?.()
                showToast('草稿纸小窗已打开')
              }}
              disabled={!scratchWindowSupported}
              className={`${BTN.secondary} ${scratchWindowSupported ? '' : 'opacity-50'}`}
            >
              <ExternalLink size={14} />
              <span>弹出置顶小窗</span>
            </button>
          </Tooltip>
        </>
      }
    >
      <ToolCard>
        <ToolCardHeader
          title={mode === 'edit' ? '草稿正文' : 'Markdown 预览'}
          icon={Sparkles}
          actions={
            <>
              {stats.todos > 0 && <ToolTag tone="brand">{stats.todos} 条待办</ToolTag>}
              <Tooltip content="复制全文">
                <span className="inline-flex">
                  <CopyButtonIcon text={text} />
                </span>
              </Tooltip>
              <Tooltip content="清空草稿（不可撤销）">
                <button
                  onClick={() => {
                    if (!text || window.confirm('清空草稿纸？内容无法找回。')) {
                      setText('')
                      showToast('已清空')
                    }
                  }}
                  disabled={!text}
                  className={iconButtonClass('danger')}
                >
                  <Trash2 size={15} />
                </button>
              </Tooltip>
            </>
          }
        />

        <div className="flex-1 min-h-0">
          {mode === 'edit' ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              disabled={!loaded}
              placeholder={EMPTY_HINT}
              className="w-full h-full min-h-[320px] resize-none outline-none bg-transparent px-4 py-3 font-mono text-[13px] leading-6 text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 disabled:opacity-50"
            />
          ) : (
            <div
              className="scratch-preview h-full overflow-y-auto px-4 py-3 text-[13px] leading-6"
              dangerouslySetInnerHTML={{
                __html: html || '<p class="text-slate-400">（草稿纸是空的）</p>',
              }}
            />
          )}
        </div>
      </ToolCard>

      <ToolActionBar
        info={
          <>
            <Eraser size={13} className="shrink-0" />
            <span>
              草稿存在本机，不参与云端同步 —— 里面往往是临时 Token 和只对本机有意义的地址
            </span>
          </>
        }
      >
        <span className={META}>
          {stats.lines} 行 · {stats.chars} 字符
        </span>
      </ToolActionBar>
    </ToolShell>
  )
}

/** 带「已复制」反馈的复制按钮，和 CopyButton 同样的交互，这里只需要一个图标 */
function CopyButtonIcon({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      disabled={!text}
      onClick={async () => {
        const ok = await copyText(text)
        if (!ok) return
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      }}
      className={iconButtonClass(copied ? 'emerald' : 'brand')}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  )
}
