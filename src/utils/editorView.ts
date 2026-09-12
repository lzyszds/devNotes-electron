/**
 * Cherry 内部 CodeMirror 6 EditorView 的编辑原语。
 *
 * 这里只做 type-only import。Cherry 打包时内联了自己那份 @codemirror/*，
 * 顶层再 import 运行时代码（例如 @codemirror/commands 的 undo()）会因为
 * historyField 的 identity 不同而静默失效；类型在编译后会被完全擦除，没有这个问题。
 *
 * 所有写操作都走 view.dispatch，因此天然进入 CM6 自己的撤销栈，⌘Z 可回退。
 */
import type { EditorView } from '@codemirror/view'

/**
 * Cherry 0.11 用 CM6Adapter 包住真正的 CM6 EditorView：适配器上代理了 state /
 * dispatch，但 contentDOM 与 dom 都是 undefined。撤销要往内容区派发事件，必须
 * 拿到里面那个真正的 EditorView（adapter.view）。
 */
type CherryAdapterLike = {
  editor?: {
    editor?: {
      view?: EditorView
      contentDOM?: HTMLElement | null
      dispatch?: unknown
    }
  }
}

/** 从 Cherry 实例上取到内部的 CM6 EditorView（取不到时返回 null，调用方需守卫） */
export function getEditorView(cherry: unknown): EditorView | null {
  const adapter = (cherry as CherryAdapterLike)?.editor?.editor
  if (!adapter) return null
  const inner = adapter.view
  if (inner && typeof inner.dispatch === 'function' && inner.contentDOM) return inner
  // 兼容 editor.editor 直接就是 EditorView 的旧版 Cherry
  if (typeof adapter.dispatch === 'function' && adapter.contentDOM) {
    return adapter as unknown as EditorView
  }
  return null
}

export interface EditorSelection {
  from: number
  to: number
  text: string
  empty: boolean
}

export function getSelection(view: EditorView): EditorSelection {
  const { from, to } = view.state.selection.main
  return { from, to, text: view.state.sliceDoc(from, to), empty: from === to }
}

export function getFullText(view: EditorView): string {
  return view.state.doc.toString()
}

/** 整篇替换。单次 dispatch，⌘Z 一步可撤销 */
export function setFullText(view: EditorView, text: string): boolean {
  const current = getFullText(view)
  if (current === text) return false
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  return true
}

export function replaceSelection(view: EditorView, text: string): void {
  view.dispatch(view.state.replaceSelection(text))
}

export function replaceRange(view: EditorView, from: number, to: number, text: string): void {
  view.dispatch({ changes: { from, to, insert: text } })
}

export function selectAll(view: EditorView): void {
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
}

/** 选区覆盖的行号区间（1 基，闭区间）；无选区时即光标所在行 */
function selectedLineRange(view: EditorView): { first: number; last: number } {
  const { from, to } = view.state.selection.main
  return {
    first: view.state.doc.lineAt(from).number,
    last: view.state.doc.lineAt(to).number,
  }
}

/** 逐行生成变更；fn 返回的偏移量相对行首，这里统一换算成文档绝对位置 */
function changeLines(
  view: EditorView,
  fn: (text: string, lineNumber: number) => { from: number; to: number; insert: string } | null
): void {
  const { first, last } = selectedLineRange(view)
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (let n = first; n <= last; n++) {
    const line = view.state.doc.line(n)
    const change = fn(line.text, n)
    if (change) {
      changes.push({ ...change, from: line.from + change.from, to: line.from + change.to })
    }
  }
  if (changes.length) view.dispatch({ changes })
}

/* ------------------------------------------------------------------ *
 * 内联格式
 * ------------------------------------------------------------------ */

/**
 * 用成对标记包裹选区。
 * - 已有选区：已处于包裹状态则脱掉标记（再点一次 = 取消），否则包起来
 * - 无选区：插入空标记对并把光标放到中间
 */
export function wrapSelection(
  view: EditorView,
  prefix: string,
  suffix: string,
  placeholder = ''
): void {
  const sel = getSelection(view)

  if (sel.empty) {
    const insert = prefix + placeholder + suffix
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + prefix.length + placeholder.length },
    })
    return
  }

  const isWrapped =
    sel.text.startsWith(prefix) &&
    sel.text.endsWith(suffix) &&
    sel.text.length >= prefix.length + suffix.length

  const insert = isWrapped
    ? sel.text.slice(prefix.length, sel.text.length - suffix.length)
    : prefix + sel.text + suffix

  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from, head: sel.from + insert.length },
  })
}

/** 常见内联标记，长的排前面，避免 ** 被 * 先吃掉 */
const INLINE_PATTERNS: RegExp[] = [
  /\*\*([\s\S]+?)\*\*/g,
  /__([\s\S]+?)__/g,
  /~~([\s\S]+?)~~/g,
  /==([\s\S]+?)==/g,
  /`([^`]+?)`/g,
  /<\/?sub>/gi,
  /<\/?sup>/gi,
  /(?<![*\w])\*(?!\*)([\s\S]+?)(?<!\*)\*(?![*\w])/g,
  /(?<![_\w])_(?!_)([\s\S]+?)(?<!_)_(?![_\w])/g,
]

/** 循环剥掉内联标记（可能有嵌套，如 **`code`**） */
export function stripInlineFormat(text: string): string {
  let result = text
  for (let round = 0; round < 4; round++) {
    let next = result
    for (const pattern of INLINE_PATTERNS) {
      // 用函数式替换：<sub>/<sup> 这类模式没有捕获组，传 $1 会被当成字面量
      next = next.replace(pattern, (_match, captured?: string) => typeof captured === 'string' ? captured : '')
    }
    if (next === result) break
    result = next
  }
  return result
}

/** 选区（或光标所在行）清除内联格式 */
export function unwrapSelection(view: EditorView): void {
  const sel = getSelection(view)
  if (!sel.empty) {
    const cleaned = stripInlineFormat(sel.text)
    if (cleaned === sel.text) return
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: cleaned },
      selection: { anchor: sel.from, head: sel.from + cleaned.length },
    })
    return
  }
  changeLines(view, (text) => {
    const cleaned = stripInlineFormat(text)
    return cleaned === text ? null : { from: 0, to: text.length, insert: cleaned }
  })
}

/* ------------------------------------------------------------------ *
 * 块级结构
 * ------------------------------------------------------------------ */

const HEADING_RE = /^(#{1,6})[ \t]+/

/** 标题级别切换；level 传 0 表示「正文」（去掉标题标记）。再点同一级别即取消。 */
export function setHeading(view: EditorView, level: number): void {
  const { first, last } = selectedLineRange(view)

  let allAtLevel = level > 0
  for (let n = first; n <= last; n++) {
    const match = view.state.doc.line(n).text.match(HEADING_RE)
    if (!match || match[1].length !== level) {
      allAtLevel = false
      break
    }
  }

  changeLines(view, (text) => {
    const match = text.match(HEADING_RE)
    if (allAtLevel || level === 0) {
      return match ? { from: 0, to: match[0].length, insert: '' } : null
    }
    const marker = '#'.repeat(level) + ' '
    return match
      ? { from: 0, to: match[0].length, insert: marker }
      : { from: 0, to: 0, insert: marker }
  })
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 按行切换行首前缀（列表 / 待办 / 引用）。整段都已有该前缀时改为移除，即再点一次取消。 */
export function toggleLinePrefix(view: EditorView, prefix: string, matcher?: RegExp): void {
  const test = matcher ?? new RegExp('^[ \\t]*' + escapeRegex(prefix))
  const { first, last } = selectedLineRange(view)

  let allHave = true
  for (let n = first; n <= last; n++) {
    if (!test.test(view.state.doc.line(n).text)) {
      allHave = false
      break
    }
  }

  changeLines(view, (text) => {
    const indent = (text.match(/^[ \t]*/) || [''])[0]
    if (allHave) {
      const match = text.match(test)
      return match && match[0].length > 0 ? { from: 0, to: match[0].length, insert: '' } : null
    }
    return { from: indent.length, to: indent.length, insert: prefix }
  })
}

/** 有序列表：重排为 1. 2. 3.，整段已是则取消 */
export function toggleOrderedList(view: EditorView): void {
  const ORDERED_RE = /^[ \t]*\d+[.)][ \t]+/
  const { first, last } = selectedLineRange(view)

  let allHave = true
  for (let n = first; n <= last; n++) {
    if (!ORDERED_RE.test(view.state.doc.line(n).text)) {
      allHave = false
      break
    }
  }

  let index = 0
  changeLines(view, (text) => {
    const indent = (text.match(/^[ \t]*/) || [''])[0]
    const match = text.match(ORDERED_RE)
    if (allHave) {
      return match ? { from: 0, to: match[0].length, insert: '' } : null
    }
    index += 1
    const marker = index + '. '
    return match
      ? { from: 0, to: match[0].length, insert: marker }
      : { from: indent.length, to: indent.length, insert: marker }
  })
}

/** 缩进增减：加两个空格 / 去掉最多两个前导空格或一个 Tab */
export function indentLines(view: EditorView, delta: number): void {
  changeLines(view, (text) => {
    if (!text.trim()) return null
    if (delta > 0) {
      return { from: 0, to: 0, insert: '  '.repeat(delta) }
    }
    const lead = (text.match(/^[ \t]*/) || [''])[0]
    if (!lead) return null
    const removed = lead.startsWith('\t') ? 1 : Math.min(lead.length, 2)
    return { from: 0, to: removed, insert: '' }
  })
}

export function trimTrailingSpaces(view: EditorView): void {
  changeLines(view, (text) => {
    const trimmed = text.replace(/[ \t]+$/, '')
    return trimmed === text ? null : { from: 0, to: text.length, insert: trimmed }
  })
}

export function sortLines(view: EditorView, descending = false): void {
  const { first, last } = selectedLineRange(view)
  if (first === last) return
  const lines: string[] = []
  for (let n = first; n <= last; n++) lines.push(view.state.doc.line(n).text)
  const sorted = [...lines].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  if (descending) sorted.reverse()
  if (sorted.join('\n') === lines.join('\n')) return
  view.dispatch({
    changes: {
      from: view.state.doc.line(first).from,
      to: view.state.doc.line(last).to,
      insert: sorted.join('\n'),
    },
  })
}

/** 行去重：保留首次出现顺序，丢掉后续重复行 */
export function dedupeLines(view: EditorView): void {
  const { first, last } = selectedLineRange(view)
  if (first === last) return
  const lines: string[] = []
  for (let n = first; n <= last; n++) lines.push(view.state.doc.line(n).text)
  const seen = new Set<string>()
  const kept = lines.filter((line) => {
    if (seen.has(line)) return false
    seen.add(line)
    return true
  })
  if (kept.length === lines.length) return
  view.dispatch({
    changes: {
      from: view.state.doc.line(first).from,
      to: view.state.doc.line(last).to,
      insert: kept.join('\n'),
    },
  })
}

const MD_SPECIAL = /[\\`*_{}[\]()#+\-.!|>~]/g

export function escapeMarkdownChars(text: string): string {
  return text.replace(MD_SPECIAL, '\\$&')
}

export function unescapeMarkdownChars(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
}

/* ------------------------------------------------------------------ *
 * 撤销 / 重做
 * ------------------------------------------------------------------ */

/** Cherry 的 EditorView 上就是 contentDOM；兜底从文档里找 .cm-content */
function getEditableDom(view: EditorView): HTMLElement | null {
  const dom = view.contentDOM as HTMLElement | undefined
  if (dom) return dom
  return document.querySelector<HTMLElement>('.cm-content')
}

/**
 * 往内容区派发 beforeinput。CM6 的 history 扩展监听 beforeinput，inputType 为
 * historyUndo / historyRedo 时直接走 history 的 undo / redo，不依赖键位绑定。
 */
function syntheticHistoryInput(
  view: EditorView,
  inputType: 'historyUndo' | 'historyRedo'
): boolean {
  const dom = getEditableDom(view)
  if (!dom || typeof InputEvent !== 'function') return false
  const before = getFullText(view)
  dom.dispatchEvent(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }))
  return getFullText(view) !== before
}

/**
 * 合成键盘事件。实机验证：往 .cm-content 上派发 Ctrl/Cmd+Z，CM6 的 keymap 会
 * 正常响应。注意顶层 @codemirror/commands 的 undo() 不能用 —— Cherry 内联了
 * 自己那份 @codemirror/*，historyField 的 identity 不同，调用会静默失效。
 */
function syntheticKey(view: EditorView, key: string, shift: boolean): boolean {
  const dom = getEditableDom(view)
  if (!dom) return false
  const before = getFullText(view)
  dom.focus()
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const upper = key.toUpperCase()
  dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: 'Key' + upper,
      keyCode: upper.charCodeAt(0),
      which: upper.charCodeAt(0),
      ctrlKey: !isMac,
      metaKey: isMac,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    })
  )
  return getFullText(view) !== before
}

function execCommandAction(view: EditorView, name: 'undo' | 'redo'): boolean {
  const dom = getEditableDom(view)
  if (!dom) return false
  dom.focus()
  try {
    return document.execCommand(name)
  } catch {
    return false
  }
}

/**
 * 撤销 / 重做。三条路依次尝试，全部无变化才算「没有可撤销的操作」：
 * 1. beforeinput(historyUndo) —— 不依赖键位绑定
 * 2. 合成 Ctrl/Cmd+Z —— 实机验证有效，作为第二道
 * 3. execCommand('undo') —— 最后兜底（实机里通常返回 false）
 */
export function undo(view: EditorView): boolean {
  return (
    syntheticHistoryInput(view, 'historyUndo') ||
    syntheticKey(view, 'z', false) ||
    execCommandAction(view, 'undo')
  )
}

export function redo(view: EditorView): boolean {
  return (
    syntheticHistoryInput(view, 'historyRedo') ||
    syntheticKey(view, 'z', true) ||
    syntheticKey(view, 'y', false) ||
    execCommandAction(view, 'redo')
  )
}
