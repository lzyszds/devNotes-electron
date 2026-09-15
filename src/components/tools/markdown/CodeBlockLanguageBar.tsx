import { useCallback, useMemo, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Check, ChevronDown, Code2, Copy } from 'lucide-react'
import { FloatingBarShell, useFloatingBar } from './FloatingBar'
import { canonicalLanguageId, LANGUAGE_OPTIONS } from '../../../utils/milkdownShiki'
import { copyText } from '../../../utils/clipboard'

export type CodeBlockLanguageBarProps = {
  editor: Editor | null
  /** 由编辑器组件持有，闭包进驱动插件；见 milkdownFloatingBar.ts */
  providerRef: MutableRefObject<TooltipProvider | null>
}

/** 标签离代码块右上角的内缩量（px） */
const CORNER_TOP = 8
const CORNER_RIGHT = 12

/**
 * 光标所在的语言块。要求光标**直接**落在 code_block 里 —— 用 $from.parent 而不是
 * 顶层块，这样套在引用/列表里的代码块也认。
 */
function codeBlockAtCursor(view: EditorView): { pos: number; node: ProseNode } | null {
  const { $from } = view.state.selection
  if ($from.parent.type.name !== 'code_block') return null
  const pos = $from.before($from.depth)
  const node = view.state.doc.nodeAt(pos)
  return node ? { pos, node } : null
}

function currentLanguage(view: EditorView): string {
  return String(codeBlockAtCursor(view)?.node.attrs.language ?? '')
}

/** 标签贴在代码块自己的右上角，光标在块里怎么移都不动 */
function codeBlockCorner(view: EditorView): { top: number; right: number } | null {
  const target = codeBlockAtCursor(view)
  if (!target) return null
  const dom = view.nodeDOM(target.pos)
  if (!(dom instanceof HTMLElement)) return null
  const rect = dom.getBoundingClientRect()
  return { top: rect.top + CORNER_TOP, right: rect.right - CORNER_RIGHT }
}

/**
 * 代码块的语言标签：光标落进某个代码块时，在它右上角浮出来，点开可以改语言。
 *
 * 为什么需要它：所见即所得里没有写围栏的地方，粘一段代码进来是不带语言标签的。
 * 没有标签就只能靠 milkdownShiki 的自动识别猜（猜得出常见语言，猜不出冷门的），
 * 而这个入口让人能直接指定 —— 否则用户只能切到 Cherry 改完再切回来。
 *
 * 改的是 code_block 的 language 属性。节点一变，高亮插件的缓存会自己失效并重新解析，
 * 所以这里不用手动触发重刷（换主题才需要，见 refreshMilkdownHighlight）。
 */
export default function CodeBlockLanguageBar({ editor, providerRef }: CodeBlockLanguageBarProps) {
  // 面板是否展开 + 面板里的筛选词
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  // 当前块的语言。每次评估从视图里同步进来，卡片上的字才是跟着光标走的
  const [language, setLanguage] = useState('')
  // 复制状态
  const [copied, setCopied] = useState(false)

  const { renderPortal } = useFloatingBar(editor, providerRef, {
    // 复用浮条的宿主样式（fixed 定位、data-show 控制显隐）
    hostClassName: 'fehelper-floating-bar',
    shouldShow: (view) => view.editable && view.hasFocus() && codeBlockAtCursor(view) != null,
    pinRect: codeBlockCorner,
    onEvaluate: (view) => setLanguage(currentLanguage(view)),
    onVisibilityChange: (visible) => {
      if (!visible) {
        setOpen(false)
        setKeyword('')
      }
    },
  })

  // 一键复制代码块文本
  const handleCopyCode = useCallback(async () => {
    if (!editor) return
    const view = editor.action((ctx) => ctx.get(editorViewCtx))
    const target = codeBlockAtCursor(view)
    if (!target) return
    const code = target.node.textContent
    if (!code) return
    const ok = await copyText(code)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [editor])

  const pick = useCallback(
    (id: string) => {
      editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const target = codeBlockAtCursor(view)
        if (!target) return
        // 光标可能已经不在原来那块里了，所以落点每次现算，不缓存
        view.dispatch(
          view.state.tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, language: id })
        )
        view.focus()
      })
      setOpen(false)
      setKeyword('')
    },
    [editor]
  )

  /*
   * 文档里写的是 `js` / `TS` 这类别名时，要先换到规范 id 才能跟清单对上 ——
   * 否则标签显示的是原文（可以接受），但面板里标不出选中项（会被当成没设语言）。
   * 换不出来的（如 ```notalang 这类瞎写的）就照原样显示，至少让人看出写的是什么。
   */
  const selectedId = useMemo(
    () => (language ? canonicalLanguageId(language) || language : ''),
    [language]
  )

  const label = useMemo(() => {
    if (!language) return '自动识别'
    return LANGUAGE_OPTIONS.find((item) => item.id === selectedId)?.label ?? language
  }, [language, selectedId])

  const options = useMemo(() => {
    const key = keyword.trim().toLowerCase()
    if (!key) return LANGUAGE_OPTIONS
    return LANGUAGE_OPTIONS.filter(
      (item) => item.label.toLowerCase().includes(key) || item.id.includes(key)
    )
  }, [keyword])

  return (
    <>
      {renderPortal(
        // 面板挂在标签下方、右对齐（标签钉在代码块右上角，面板往左展开才不会出编辑区）
        <div className="flex flex-col items-end">
          <FloatingBarShell>
            {/* 语言显示与下拉切换 */}
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              title="设置该代码块的语言"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
            >
              <Code2 className="h-3 w-3 text-brand-600 dark:text-brand-400" />
              <span className="max-w-[7rem] truncate font-medium">{label}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            <span className="h-3 w-px bg-slate-200 dark:bg-dark-border mx-0.5" />

            {/* 一键复制代码块 */}
            <button
              type="button"
              onClick={handleCopyCode}
              title="复制代码块全部内容"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">已复制</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>复制</span>
                </>
              )}
            </button>
          </FloatingBarShell>

          {open && (
            // 拦住 mousedown，否则点列表会让编辑区失焦、选区随即消失；输入框除外，它本来就要拿焦点
            <div
              onMouseDown={(event) => {
                if ((event.target as HTMLElement).closest('input')) return
                event.preventDefault()
              }}
              className="mt-1 flex max-h-64 w-56 flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-lg dark:border-dark-border dark:bg-dark-panel"
            >
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setOpen(false)
                    setKeyword('')
                  }
                }}
                placeholder="筛选语言…"
                className="mx-1.5 mt-1.5 h-6 flex-shrink-0 rounded border border-slate-200/80 bg-slate-50 px-1.5 text-[11px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-dark-border dark:bg-dark-hover dark:text-slate-200"
              />
              <div className="mt-1 overflow-y-auto py-0.5">
                {options.length === 0 ? (
                  <div className="px-2.5 py-1.5 text-[11px] text-slate-400">没有匹配的语言</div>
                ) : (
                  options.map((item) => (
                    <button
                      key={item.id || 'auto'}
                      type="button"
                      onClick={() => pick(item.id)}
                      className={`flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-[11px] transition-colors ${
                        item.id === selectedId
                          ? 'bg-brand-50 font-semibold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-dark-hover'
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.id && (
                        <span className="flex-shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                          {item.id}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
