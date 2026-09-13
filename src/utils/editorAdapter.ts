/**
 * 编辑器能力适配层。
 *
 * 背景：右键菜单原先只服务 Cherry（CM6），内核换成 Milkdown（ProseMirror）后
 * 那 70 项能力全用不了。两者底层文档模型完全不同 —— CM6 是「纯文本 + 位置」，
 * ProseMirror 是「节点树 + marks」—— 但用户视角的操作语义是一致的。
 *
 * 所以这里定义一份共同接口，把差异关在两个实现里：
 *   cherryAdapter.ts   → 转发 CM6 的 dispatch / 现成的 editorView.ts
 *   milkdownAdapter.ts → 转发 ProseMirror 命令与节点操作
 * 菜单树只认这个接口，不再 import 任何一个内核。
 */

export type EditorEngine = 'cherry' | 'milkdown'

export interface EditorSelection {
  text: string
  empty: boolean
  /** 各内核自己的坐标，只用来回传给同一个适配器，外部不要解释它 */
  from: number
  to: number
}

export interface EditorAdapter {
  /** 菜单树据此过滤掉 Cherry 专有项，省得每个菜单项里写 if */
  readonly engine: EditorEngine

  /* ---- 读 ---- */
  getFullText(): string
  getHtml(): string
  getSelection(): EditorSelection

  /* ---- 通用写 ---- */
  replaceRange(from: number, to: number, text: string): void
  /** 插入片段；cursorFromStart 是落点相对片段开头的偏移，默认落末尾 */
  insertSnippet(text: string, cursorFromStart?: number): void
  /** 插到文首（Front Matter 用） */
  insertAtStart(text: string): boolean
  /** 整篇替换；返回 false 表示内容没变 */
  setFullText(text: string): boolean
  /** 对选区做纯文本变换；无选区时作用于光标所在块/行 */
  transformTarget(fn: (text: string) => string): void

  selectAll(): void
  focus(): void
  undo(): boolean
  redo(): boolean

  /* ---- 块级语义：两侧实现不同，签名一致 ---- */
  wrapSelection(prefix: string, suffix: string, placeholder?: string): void
  unwrapSelection(): void
  setHeading(level: number): void
  toggleLinePrefix(prefix: string): void
  toggleOrderedList(): void
  indentLines(delta: 1 | -1): void
  trimTrailingSpaces(): void
  /** 合并多余空行；返回 false 表示本来就没有多余空行 */
  collapseBlankLines(): boolean
  sortLines(descending: boolean): void
  dedupeLines(): void

  /* ---- 引擎原生能力（目前只有 Cherry 的 toolbarHandlers） ---- */
  /** 调用内核自带的工具栏动作；Milkdown 侧恒 false */
  invokeNative(id: string): boolean
  hasNative(id: string): boolean
}

/** 选区是否覆盖了多行（Milkdown 侧要靠它判断「行级操作」是否退化成块级操作） */
export function selectionSpansMultipleBlocks(adapter: EditorAdapter): boolean {
  const sel = adapter.getSelection()
  return !sel.empty && sel.text.includes('\n')
}
