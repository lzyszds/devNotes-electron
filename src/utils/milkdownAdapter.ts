/**
 * EditorAdapter 的 Milkdown（ProseMirror）实现。
 *
 * 与 Cherry 那侧最大的不同：ProseMirror 的文档是**节点树**，没有「空行」「行前缀」
 * 这类纯文本概念。所以不能照搬 editorText.ts 的行变换（那把列表压成段落、
 * 把 marks 抹掉），必须走结构命令或节点重排。
 *
 * 三条基本原则：
 *   1. 行内改文字 → 逐文本节点 insertText，marks 不动
 *   2. 块级重排 → tr.replaceWith 搬完整节点，块内格式不动
 *   3. 结构变更 → 能用现成命令就用（wrapInBulletListCommand 等），不自己拼字符串
 */
import type { RefObject } from 'react'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  liftListItemCommand,
  sinkListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { AllSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { callCommand, getHTML, getMarkdown, insert, replaceAll, setAttr } from '@milkdown/kit/utils'
import type { EditorAdapter, EditorSelection } from './editorAdapter'
import { collapseBlankLinesInText, stripInlineFormat, wrapText } from './editorText'
import { toggleMilkdownTaskList } from '../components/tools/markdown/milkdownCommands'

/**
 * 内联前后缀 → ProseMirror 命令。
 *
 * 菜单传的是字面的 `**` / `*` / `` ` `` 等，Milkdown 侧不能拼字符串
 * （那会变成字面文本），必须映射到 mark 级命令。
 *
 * 表里存的是 thunk：`$Command.key` 只在插件函数体内被赋值，模块加载期读到的
 * 是 undefined（milkdownCommands.ts 里有同一处坑的详细注释）。推迟到点击时求值。
 */
const MARK_COMMANDS: Record<string, () => (ctx: Ctx) => boolean> = {
  '**': () => callCommand(toggleStrongCommand.key),
  '*': () => callCommand(toggleEmphasisCommand.key),
  '~~': () => callCommand(toggleStrikethroughCommand.key),
  '`': () => callCommand(toggleInlineCodeCommand.key),
}

export type MilkdownAdapterOptions = {
  /** 「导出…」由宿主接管（Cherry 侧走原生导出菜单，能力更全） */
  onExport?: () => void
}

export function createMilkdownAdapter(
  editorRef: RefObject<Editor | null>,
  options: MilkdownAdapterOptions = {}
): EditorAdapter {
  const withView = <T,>(fn: (view: EditorView) => T, fallback: T): T => {
    const editor = editorRef.current
    if (!editor) return fallback
    try {
      return editor.action((ctx) => fn(ctx.get(editorViewCtx)))
    } catch (error) {
      console.error('[Milkdown] 适配器操作失败:', error)
      return fallback
    }
  }

  /** 选区覆盖的顶层块（无选区时取光标所在块），返回 [{node, pos, end}] */
  const selectedBlocks = (view: EditorView) => {
    const { from, to } = view.state.selection
    const blocks: Array<{ node: ProseNode; pos: number }> = []
    view.state.doc.nodesBetween(from, to, (node, pos) => {
      if (view.state.doc.resolve(pos).depth !== 0) return true
      if (!node.isBlock) return true
      blocks.push({ node, pos })
      return false
    })
    if (blocks.length) return blocks
    // 空选区落在文档边界时 nodesBetween 可能什么都没给，退化成光标所在顶层块
    const $from = view.state.doc.resolve(Math.min(from, view.state.doc.content.size))
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if (depth === 1) {
        const node = $from.node(1)
        return [{ node, pos: $from.before(1) }]
      }
    }
    return blocks
  }

  return {
    engine: 'milkdown',

    getFullText: () => {
      const editor = editorRef.current
      if (!editor) return ''
      try {
        return editor.action(getMarkdown())
      } catch {
        return ''
      }
    },

    getHtml: () => {
      const editor = editorRef.current
      if (!editor) return ''
      try {
        return editor.action(getHTML())
      } catch {
        return ''
      }
    },

    getSelection: (): EditorSelection => {
      const editor = editorRef.current
      if (!editor) return { text: '', empty: true, from: 0, to: 0 }
      try {
        return editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const { from, to } = view.state.selection
          return { from, to, text: view.state.doc.textBetween(from, to, '\n'), empty: from === to }
        })
      } catch {
        return { text: '', empty: true, from: 0, to: 0 }
      }
    },

    replaceRange: (from, to, text) => {
      withView((view) => {
        view.dispatch(view.state.tr.insertText(text, from, to))
        view.focus()
      }, undefined)
    },

    insertSnippet: (text, cursorFromStart) => {
      const editor = editorRef.current
      if (!editor) return
      try {
        // 按 Markdown 解析后以节点插入。直接塞字符串会原样显示成 `**加粗**`，
        // MilkdownMarkdownEditor 的 registerInsertHandler 已踩过同一个坑。
        // cursorFromStart 在 ProseMirror 下无法精确表达，退化为「光标落在片段末尾」。
        void cursorFromStart
        editor.action(insert(text))
      } catch (error) {
        console.error('[Milkdown] 插入片段失败:', error)
      }
    },

    insertAtStart: (text) => {
      const editor = editorRef.current
      if (!editor) return false
      try {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          view.dispatch(view.state.tr.insertText(text, 0, 0))
          view.focus()
        })
        return true
      } catch (error) {
        console.error('[Milkdown] 插入文首失败:', error)
        return false
      }
    },

    setFullText: (text) => {
      const editor = editorRef.current
      if (!editor) return false
      try {
        const current = editor.action(getMarkdown())
        if (current === text) return false
        // flush 默认 false，整篇替换仍然只占一步撤销
        editor.action(replaceAll(text))
        return true
      } catch (error) {
        console.error('[Milkdown] 整篇替换失败:', error)
        return false
      }
    },

    transformTarget: (fn) => {
      withView((view) => {
        const { from, to, empty } = view.state.selection
        if (empty) {
          // 无选区时作用于光标所在文本块整体
          const $from = view.state.selection.$from
          const blockStart = $from.start()
          const blockEnd = $from.end()
          const source = view.state.doc.textBetween(blockStart, blockEnd, '\n')
          const next = fn(source)
          if (next === source) return
          view.dispatch(view.state.tr.insertText(next, blockStart, blockEnd))
          return
        }
        // 有选区时逐文本节点变换，marks 不丢
        const tr = view.state.tr
        const edits: Array<{ from: number; to: number; text: string }> = []
        view.state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText || !node.text) return true
          const start = Math.max(pos, from)
          const end = Math.min(pos + node.nodeSize, to)
          if (start >= end) return true
          const piece = view.state.doc.textBetween(start, end, '\n')
          const next = fn(piece)
          if (next !== piece) edits.push({ from: start, to: end, text: next })
          return true
        })
        // 从后往前应用，避免位置偏移
        for (let i = edits.length - 1; i >= 0; i -= 1) {
          tr.insertText(edits[i].text, edits[i].from, edits[i].to)
        }
        if (tr.docChanged) view.dispatch(tr)
      }, undefined)
    },

    selectAll: () => {
      withView((view) => {
        view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
        view.focus()
      }, undefined)
    },

    focus: () => {
      editorRef.current?.action((ctx) => ctx.get(editorViewCtx).focus())
    },

    undo: () => {
      const editor = editorRef.current
      if (!editor) return false
      return editor.action(callCommand(undoCommand.key))
    },

    redo: () => {
      const editor = editorRef.current
      if (!editor) return false
      return editor.action(callCommand(redoCommand.key))
    },

    // —— 行内 ——

    wrapSelection: (prefix, suffix, placeholder = '') => {
      const editor = editorRef.current
      if (!editor) return

      // `<sup>` / `<sub>` / `==` 这类没有对应 mark，走 html 节点（见 milkdownHtmlView.ts）
      const resolve = MARK_COMMANDS[prefix]
      if (resolve && suffix === prefix) {
        editor.action(resolve())
        return
      }

      withView((view) => {
        const { from, to, empty } = view.state.selection
        if (empty) {
          const content = placeholder || ''
          const text = `${prefix}${content}${suffix}`
          view.dispatch(view.state.tr.insertText(text, from, to))
          return
        }
        const selected = view.state.doc.textBetween(from, to, '\n')
        const { text } = wrapText(selected, prefix, suffix)
        view.dispatch(view.state.tr.insertText(text, from, to))
      }, undefined)
    },

    unwrapSelection: () => {
      withView((view) => {
        const { from, to, empty } = view.state.selection
        if (!empty) {
          const selected = view.state.doc.textBetween(from, to, '\n')
          const cleaned = stripInlineFormat(selected)
          if (cleaned !== selected) view.dispatch(view.state.tr.insertText(cleaned, from, to))
          return
        }
        const $from = view.state.selection.$from
        const blockStart = $from.start()
        const blockEnd = $from.end()
        let tr = view.state.tr
        const edits: Array<{ from: number; to: number; text: string }> = []
        view.state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
          if (!node.isText || !node.text) return true
          const cleaned = stripInlineFormat(node.text)
          if (cleaned !== node.text) edits.push({ from: pos, to: pos + node.nodeSize, text: cleaned })
          return true
        })
        for (let i = edits.length - 1; i >= 0; i -= 1) {
          tr = tr.insertText(edits[i].text, edits[i].from, edits[i].to)
        }
        // 顺带清掉文本上的 marks
        tr = tr.removeMark(blockStart, blockEnd)
        if (tr.docChanged) view.dispatch(tr)
      }, undefined)
    },

    // —— 块级结构：一律走命令，不拼字符串 ——

    setHeading: (level) => {
      const editor = editorRef.current
      if (!editor) return
      if (level < 1) editor.action(callCommand(turnIntoTextCommand.key))
      else editor.action(callCommand(wrapInHeadingCommand.key, Math.min(6, level)))
    },

    toggleLinePrefix: (prefix) => {
      const editor = editorRef.current
      if (!editor) return
      // 待办清单 gfm 没有命令，走自写实现（milkdownCommands.ts）
      if (prefix.startsWith('- [ ]')) {
        toggleMilkdownTaskList(editor)
        return
      }
      if (prefix.startsWith('>')) {
        editor.action(callCommand(wrapInBlockquoteCommand.key))
        return
      }
      editor.action(callCommand(wrapInBulletListCommand.key))
    },

    toggleOrderedList: () => {
      const editor = editorRef.current
      if (!editor) return
      editor.action(callCommand(wrapInOrderedListCommand.key))
    },

    indentLines: (delta) => {
      const editor = editorRef.current
      if (!editor) return
      // 只能对列表项生效。plugin/indent 与 listItemKeymap 都绑 Tab，
      // 优先级取决于注册顺序，所以这里直接调命令，不模拟按键。
      if (delta > 0) editor.action(callCommand(sinkListItemCommand.key))
      else editor.action(callCommand(liftListItemCommand.key))
    },

    trimTrailingSpaces: () => {
      withView((view) => {
        let tr = view.state.tr
        const edits: Array<{ from: number; to: number; text: string }> = []
        view.state.doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return true
          // ProseMirror 里文本节点内部的换行极少见（段落是独立节点），
          // 真正需要处理的是硬换行前后的空白与全角空格
          const cleaned = node.text.replace(/[ \t ]+(?=\n|$)/g, '')
          if (cleaned !== node.text) edits.push({ from: pos, to: pos + node.nodeSize, text: cleaned })
          return true
        })
        for (let i = edits.length - 1; i >= 0; i -= 1) {
          tr = tr.insertText(edits[i].text, edits[i].from, edits[i].to)
        }
        if (tr.docChanged) view.dispatch(tr)
      }, undefined)
    },

    collapseBlankLines: () => {
      const editor = editorRef.current
      if (!editor) return false
      try {
        // 所见即所得里没有「空行」，等价语义是连续空段落。
        // 用 Markdown 往返实现会让整篇重新序列化（有惊动无关格式的风险），
        // 所以只在真有多余空段落时才动，且按节点删除。
        const markdown = editor.action(getMarkdown())
        const collapsed = collapseBlankLinesInText(markdown)
        if (collapsed === markdown) return false

        let removed = false
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const empties: number[] = []
          view.state.doc.forEach((node, offset) => {
            if (node.type.name === 'paragraph' && node.content.size === 0) empties.push(offset)
          })
          if (!empties.length) return
          let tr = view.state.tr
          // 连续的空段落只留一个，从后往前删
          for (let i = empties.length - 1; i > 0; i -= 1) {
            const prev = empties[i - 1]
            const cur = empties[i]
            const prevNode = view.state.doc.nodeAt(prev)
            if (!prevNode) continue
            if (prev + prevNode.nodeSize === cur) {
              const curNode = view.state.doc.nodeAt(cur)
              if (!curNode) continue
              tr = tr.delete(cur, cur + curNode.nodeSize)
              removed = true
            }
          }
          if (tr.docChanged) view.dispatch(tr)
        })
        return removed
      } catch (error) {
        console.error('[Milkdown] 合并空行失败:', error)
        return false
      }
    },

    sortLines: (descending) => {
      withView((view) => {
        const blocks = selectedBlocks(view)
        if (blocks.length <= 1) return
        const sorted = [...blocks].sort((a, b) =>
          a.node.textContent.localeCompare(b.node.textContent, 'zh-Hans-CN')
        )
        if (descending) sorted.reverse()

        // 搬完整节点而非文本往返，块内 marks 不丢
        const first = blocks[0]
        const last = blocks[blocks.length - 1]
        const from = first.pos
        const to = last.pos + last.node.nodeSize
        const tr = view.state.tr.replaceWith(from, to, sorted.map((b) => b.node))
        if (tr.docChanged) view.dispatch(tr)
      }, undefined)
    },

    dedupeLines: () => {
      withView((view) => {
        const blocks = selectedBlocks(view)
        if (blocks.length <= 1) return
        const seen = new Set<string>()
        const kept = blocks.filter((b) => {
          const key = b.node.textContent
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        if (kept.length === blocks.length) return

        // 被丢掉的块要逐个删除，从后往前避免位置偏移
        const dropped = blocks.filter((b) => !kept.includes(b))
        let tr = view.state.tr
        for (let i = dropped.length - 1; i >= 0; i -= 1) {
          tr = tr.delete(dropped[i].pos, dropped[i].pos + dropped[i].node.nodeSize)
        }
        if (tr.docChanged) view.dispatch(tr)
      }, undefined)
    },

    // —— 原生 ——

    invokeNative: (id) => {
      // 目前只有「导出」需要分派，其余原生能力（搜索/全屏）由宿主层接管
      if (id === 'export' && options.onExport) {
        options.onExport()
        return true
      }
      return false
    },

    hasNative: (id) => id === 'export' && !!options.onExport,
  }
}

/** 供菜单「清空全文」等使用：把光标所在块的属性改掉 */
export function setNodeAttr(editor: Editor | null, pos: number, attrs: Record<string, unknown>) {
  if (!editor) return false
  return editor.action(setAttr(pos, (prev) => ({ ...prev, ...attrs })))
}
