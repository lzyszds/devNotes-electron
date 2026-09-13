/**
 * EditorAdapter 的 Cherry（CM6）实现。
 *
 * 这一侧基本是「转调」：现成的 editorView.ts 已经把 CM6 的原语都写好了，
 * 这里只负责把 EditorAdapter 的方法名接上去，并把共用的纯文本逻辑
 * （editorText.ts）套在选中的行上。
 *
 * 之所以要包一层而不是让菜单直接调 editorView.ts：菜单树要能同时服务两个内核，
 * 必须有一个统一入口。Cherry 这侧的实现因此宁可啰嗦也不要漏方法。
 */
import type { RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import type { EditorAdapter, EditorSelection } from './editorAdapter'
import {
  ORDERED_LIST_RE,
  collapseBlankLinesInText,
  dedupeLinesText,
  escapeMarkdownChars,
  indentLinesText,
  setHeadingText,
  sortLinesText,
  stripInlineFormat,
  toggleLinePrefixText,
  toggleOrderedListText,
  trimTrailingSpacesText,
  wrapText,
} from './editorText'
import {
  getEditorView,
  getFullText,
  getSelection,
  redo,
  replaceRange,
  selectAll,
  setFullText,
  stripInlineFormat as stripInlineFormatCompat,
  undo,
} from './editorView'

/** Cherry 实例上我们真正用到的那部分能力（全部可选，运行时用 typeof 守卫） */
export interface CherryEditorApi {
  getMarkdown?: () => string
  getHtml?: () => string
  toolbar?: { toolbarHandlers?: Record<string, unknown> }
}

/**
 * 读取行内容需要 CM6 的 doc.line(n)。
 * 这里刻意不 import @codemirror/state 的运行时符号 —— Cherry 内联了自己那份
 * @codemirror/*，跨实例取 lineAt 会因为 identity 不同而失效（editorView.ts 顶部注释同理）。
 */
function readLines(view: EditorView): { lines: string[]; first: number; last: number } {
  const { from, to } = view.state.selection.main
  const first = view.state.doc.lineAt(from).number
  const last = view.state.doc.lineAt(to).number
  const lines: string[] = []
  for (let n = first; n <= last; n += 1) lines.push(view.state.doc.line(n).text)
  return { lines, first, last }
}

/** 用变换后的行整体替换选区覆盖的行区间，单次 dispatch、一步可撤销 */
function writeLines(view: EditorView, next: string[]): void {
  const { lines, first, last } = readLines(view)
  if (next.length === lines.length && next.every((line, i) => line === lines[i])) return
  view.dispatch({
    changes: {
      from: view.state.doc.line(first).from,
      to: view.state.doc.line(last).to,
      insert: next.join('\n'),
    },
  })
}

/** 只改行内内容（行数不变）时用这个，保留光标大致位置 */
function mapLines(view: EditorView, fn: (lines: string[]) => string[]): void {
  const { lines } = readLines(view)
  const next = fn(lines)
  if (next.length !== lines.length) {
    // 行数变了（去重），只能整段替换
    writeLines(view, next)
    return
  }
  if (next.every((line, i) => line === lines[i])) return

  const { first } = readLines(view)
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] === lines[i]) continue
    const line = view.state.doc.line(first + i)
    changes.push({ from: line.from, to: line.to, insert: next[i] })
  }
  if (changes.length) view.dispatch({ changes })
}

export function createCherryAdapter(
  cherryRef: RefObject<CherryEditorApi | null>
): EditorAdapter {
  const view = (): EditorView | null => getEditorView(cherryRef.current)

  const handler = (name: string): (() => void) | null => {
    const candidate = cherryRef.current?.toolbar?.toolbarHandlers?.[name]
    return typeof candidate === 'function' ? (candidate as () => void) : null
  }

  /** 选区为空时把「当前行」当作目标 */
  const targetText = (v: EditorView): { text: string; from: number; to: number } => {
    const sel = getSelection(v)
    if (!sel.empty) return { text: sel.text, from: sel.from, to: sel.to }
    const line = v.state.doc.lineAt(sel.from)
    return { text: line.text, from: line.from, to: line.to }
  }

  return {
    engine: 'cherry',

    getFullText: () => {
      const v = view()
      return v ? getFullText(v) : ''
    },

    getHtml: () => {
      try {
        return cherryRef.current?.getHtml?.() || ''
      } catch {
        return ''
      }
    },

    getSelection: (): EditorSelection => {
      const v = view()
      if (!v) return { text: '', empty: true, from: 0, to: 0 }
      return getSelection(v)
    },

    replaceRange: (from, to, text) => {
      const v = view()
      if (v) replaceRange(v, from, to, text)
    },

    insertSnippet: (text, cursorFromStart) => {
      const v = view()
      if (!v) return
      const sel = getSelection(v)
      const anchor = sel.from + (cursorFromStart ?? text.length)
      v.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor },
      })
      v.focus()
    },

    insertAtStart: (text) => {
      const v = view()
      if (!v) return false
      v.dispatch({ changes: { from: 0, to: 0, insert: text }, selection: { anchor: 0 } })
      v.focus()
      return true
    },

    setFullText: (text) => {
      const v = view()
      return v ? setFullText(v, text) : false
    },

    transformTarget: (fn) => {
      const v = view()
      if (!v) return
      const { text, from, to } = targetText(v)
      const next = fn(text)
      if (next !== text) replaceRange(v, from, to, next)
    },

    selectAll: () => {
      const v = view()
      if (!v) return
      selectAll(v)
      v.focus()
    },

    focus: () => view()?.focus(),

    undo: () => {
      const v = view()
      return v ? undo(v) : false
    },

    redo: () => {
      const v = view()
      return v ? redo(v) : false
    },

    // —— 块级：Cherry 这侧真的就是「行文本操作」，全部走 editorText 的纯函数 ——

    wrapSelection: (prefix, suffix, placeholder = '') => {
      const v = view()
      if (!v) return
      const sel = getSelection(v)
      if (sel.empty) {
        // 无选区：插入空标记对并把光标放到中间
        const insert = prefix + placeholder + suffix
        v.dispatch({
          changes: { from: sel.from, to: sel.to, insert },
          selection: { anchor: sel.from + prefix.length + placeholder.length },
        })
        return
      }
      const { text } = wrapText(sel.text, prefix, suffix)
      v.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from, head: sel.from + text.length },
      })
    },

    unwrapSelection: () => {
      const v = view()
      if (!v) return
      const sel = getSelection(v)
      if (!sel.empty) {
        const cleaned = stripInlineFormatCompat(sel.text)
        if (cleaned === sel.text) return
        v.dispatch({
          changes: { from: sel.from, to: sel.to, insert: cleaned },
          selection: { anchor: sel.from, head: sel.from + cleaned.length },
        })
        return
      }
      mapLines(v, (lines) => lines.map((line) => stripInlineFormat(line)))
    },

    setHeading: (level) => {
      const v = view()
      if (!v) return
      const { lines } = readLines(v)
      const allAtLevel =
        level > 0 &&
        lines.every((line) => {
          const match = line.match(/^(#{1,6})[ \t]+/)
          return !!match && match[1].length === level
        })
      mapLines(v, (current) => setHeadingText(current, level, allAtLevel))
    },

    toggleLinePrefix: (prefix) => {
      const v = view()
      if (!v) return
      const { lines } = readLines(v)
      const test = new RegExp('^[ \\t]*' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      const allHave = lines.every((line) => test.test(line))
      mapLines(v, (current) => toggleLinePrefixText(current, prefix, allHave))
    },

    toggleOrderedList: () => {
      const v = view()
      if (!v) return
      const { lines } = readLines(v)
      const allHave = lines.every((line) => ORDERED_LIST_RE.test(line))
      mapLines(v, (current) => toggleOrderedListText(current, allHave))
    },

    indentLines: (delta) => {
      const v = view()
      if (v) mapLines(v, (lines) => indentLinesText(lines, delta))
    },

    trimTrailingSpaces: () => {
      const v = view()
      if (v) mapLines(v, (lines) => trimTrailingSpacesText(lines))
    },

    collapseBlankLines: () => {
      const v = view()
      if (!v) return false
      const current = getFullText(v)
      const next = collapseBlankLinesInText(current)
      if (next === current) return false
      setFullText(v, next)
      return true
    },

    sortLines: (descending) => {
      const v = view()
      if (!v) return
      const { lines } = readLines(v)
      if (lines.length <= 1) return
      writeLines(v, sortLinesText(lines, descending))
    },

    dedupeLines: () => {
      const v = view()
      if (!v) return
      const { lines } = readLines(v)
      if (lines.length <= 1) return
      writeLines(v, dedupeLinesText(lines))
    },

    // —— 原生 ——

    invokeNative: (id) => {
      const fn = handler(id)
      if (!fn) return false
      try {
        fn()
        return true
      } catch (error) {
        console.error(`工具栏动作 ${id} 失败:`, error)
        return false
      }
    },

    hasNative: (id) => handler(id) !== null,
  }
}

/** 菜单里「粘贴为纯文本」用得到，统一从这里出，免得菜单再 import 一次 */
export { escapeMarkdownChars }
