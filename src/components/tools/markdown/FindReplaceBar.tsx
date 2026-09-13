import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  clearSearch,
  getSearchState,
  moveSearchCursor,
  replaceAllMatches,
  replaceCurrent,
  selectSearchMatch,
  setSearchQuery,
} from '../../../utils/milkdownSearch'
import Tooltip from '../../ui/Tooltip'
import { ChevronDown, ChevronUp, Replace, ReplaceAll, Search, X } from 'lucide-react'

export type FindReplaceBarProps = {
  editor: Editor | null
  onClose: () => void
}

/**
 * 所见即所得的查找替换条。
 *
 * 与 Cherry 那颗 `search` 是两套东西：Cherry 走它内置的 SearcherPanel
 * （支持大小写/全字/正则），这里第一版只做字面量查找。外观对齐本站工具栏语言，
 * 不再是一块原生皮肤。
 */
export default function FindReplaceBar({ editor, onClose }: FindReplaceBarProps) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [total, setTotal] = useState(0)
  const [current, setCurrent] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  /** 所有操作都要先进 ctx 拿 view —— editor 可能还没就绪 */
  const withView = useCallback(
    (fn: (view: EditorView) => void) => {
      if (!editor) return
      try {
        editor.action((ctx) => fn(ctx.get(editorViewCtx)))
      } catch {
        // 编辑器已销毁或尚未就绪，静默跳过即可
      }
    },
    [editor]
  )

  /** 把插件状态同步回 React —— 文档一变（打字/替换）命中数就跟着变 */
  const syncState = useCallback(() => {
    withView((view) => {
      const state = getSearchState(view)
      setTotal(state?.matches.length ?? 0)
      setCurrent(state?.current ?? -1)
    })
  }, [withView])

  // 打开即聚焦输入框，符合「⌘F 之后直接打字」的预期
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // 查询串变化时重算匹配并跳到第一个
  useEffect(() => {
    withView((view) => {
      if (!query) {
        clearSearch(view)
        setTotal(0)
        setCurrent(-1)
        return
      }
      const state = setSearchQuery(view, query)
      setTotal(state?.matches.length ?? 0)
      setCurrent(state?.current ?? -1)
      // 落到第一个命中，否则高亮在最上面而视野还停在原处
      if (state?.matches.length) selectSearchMatch(view, 0)
    })
  }, [query, withView])

  const go = useCallback(
    (delta: 1 | -1) => {
      withView((view) => {
        const state = moveSearchCursor(view, delta)
        if (state) {
          selectSearchMatch(view, state.current)
          setCurrent(state.current)
        }
      })
    },
    [withView]
  )

  const doReplace = useCallback(() => {
    withView((view) => {
      if (!replaceCurrent(view, replacement)) return
      // 替换后 matches 已在 apply 里重算，这里把新的当前项选中
      const state = getSearchState(view)
      setTotal(state?.matches.length ?? 0)
      setCurrent(state?.current ?? -1)
      if (state?.matches.length && state.current >= 0) selectSearchMatch(view, state.current)
    })
  }, [withView, replacement])

  const doReplaceAll = useCallback(() => {
    withView((view) => {
      replaceAllMatches(view, replacement)
      syncState()
    })
  }, [withView, replacement, syncState])

  const close = useCallback(() => {
    withView((view) => clearSearch(view))
    onClose()
  }, [withView, onClose])

  return (
    <div className="absolute right-2 top-2 z-30 flex w-[22rem] max-w-[calc(100%-1rem)] flex-col gap-1.5 rounded-lg border border-slate-200/80 bg-white/95 p-2 shadow-lg backdrop-blur-sm dark:border-dark-border dark:bg-dark-panel/95">
      <div className="flex items-center gap-1.5">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 h-3 w-3 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') go(event.shiftKey ? -1 : 1)
              if (event.key === 'Escape') close()
            }}
            placeholder="查找"
            className="h-7 w-full rounded-md border border-slate-200/80 bg-slate-50 pl-7 pr-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-dark-border dark:bg-dark-hover dark:text-slate-200"
          />
        </div>

        {/* 命中计数。分母为 0 时只显示 0/0，不要显示 -1 */}
        <span className="flex-shrink-0 tabular-nums text-[11px] text-slate-400 dark:text-slate-500">
          {total ? `${current + 1}/${total}` : '0/0'}
        </span>

        <Tooltip content="上一个 (Shift+Enter)">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={!total}
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-dark-hover"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="下一个 (Enter)">
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!total}
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-dark-hover"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="关闭 (Esc)">
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-dark-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') doReplace()
            if (event.key === 'Escape') close()
          }}
          placeholder="替换为"
          className="h-7 min-w-0 flex-1 rounded-md border border-slate-200/80 bg-slate-50 px-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-dark-border dark:bg-dark-hover dark:text-slate-200"
        />
        <Tooltip content="替换当前">
          <button
            type="button"
            onClick={doReplace}
            disabled={!total}
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-dark-hover"
          >
            <Replace className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="全部替换">
          <button
            type="button"
            onClick={doReplaceAll}
            disabled={!total}
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-dark-hover"
          >
            <ReplaceAll className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
