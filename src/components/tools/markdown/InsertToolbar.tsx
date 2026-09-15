import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { Editor } from '@milkdown/kit/core'
import type { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  Heading1,
  Heading2,
  Heading3,
  ListChecks,
  ListOrdered,
  SquareCode,
  Table as TableIcon,
  TextQuote,
} from 'lucide-react'
import { FloatingBarButton, FloatingBarDivider, FloatingBarShell, useFloatingBar } from './FloatingBar'
import { runMilkdownCommand, setMilkdownHeading } from './milkdownCommands'

export type InsertToolbarProps = {
  editor: Editor | null
  /** 由编辑器组件持有，闭包进驱动插件；见 milkdownFloatingBar.ts */
  providerRef: MutableRefObject<TooltipProvider | null>
}

/** Cherry `.cherry-floatmenu` 的横向偏移：`left: 30px` + `margin-left: 60px` */
const FLOAT_MENU_LEFT_OFFSET = 90

/**
 * 光标落在**空行**上时浮出的快捷插入条，对齐双栏内核（Cherry）的 float 工具条。
 *
 * Cherry 那边的判定条件（见 FloatMenu 的类型注释）是「光标处于编辑器新行起始位置」，
 * 「有选中内容、或光标所在行有内容时隐藏」。落到所见即所得里就是：选区塌陷、
 * 光标在一个空的段落里。空标题、空代码块都不算 —— 它们在源码里那行不是空的
 * （`# `、``` 都有内容），Cherry 也不会弹。
 */
function isEmptyLine(view: EditorView): boolean {
  if (!view.editable || !view.hasFocus()) return false

  const { selection } = view.state
  if (!selection.empty) return false

  const { $from } = selection
  const parent = $from.parent
  if (parent.type.name !== 'paragraph' || parent.content.size !== 0) return false

  // depth 至少是 1，node(depth - 1) 就是装着这个段落的容器
  const container = $from.node($from.depth - 1)
  return container.type.name === 'doc' || container.type.name === 'blockquote'
}

/**
 * 横向钉在编辑区左侧固定偏移处，竖向跟着当前行 —— Cherry 的 float 工具条就是这个行为。
 * 用编辑区自身的边界算，不用光标位置：光标贴在左边时浮条会压到文字上。
 */
function pinLeftOfLine(view: EditorView): number {
  return view.dom.getBoundingClientRect().left + FLOAT_MENU_LEFT_OFFSET
}

/**
 * 按钮清单与 `CherryMarkdownEditor` 里 `toolbars.float` 的配置逐项对应：
 *   h1 / h2 / h3 | checklist / quote / table / code / timeline
 *
 * 唯一少的是 `timeline` —— Cherry 的 `::: timeline` 是它私有的容器语法，
 * 不属 CommonMark/GFM，ProseMirror 里没有对应节点，做不了保真（与「面板」「图表」
 * 同一条硬约束）。与其塞一颗点了没反应的按钮，不如不给。
 */
const INSERT_ITEMS = [
  { kind: 'heading', level: 1, label: '标题 1', icon: Heading1 },
  { kind: 'heading', level: 2, label: '标题 2', icon: Heading2 },
  { kind: 'heading', level: 3, label: '标题 3', icon: Heading3 },
  { kind: 'command', id: 'task', label: '任务清单', icon: ListChecks },
  { kind: 'command', id: 'quote', label: '引用', icon: TextQuote },
  { kind: 'command', id: 'table', label: '表格', icon: TableIcon },
  { kind: 'command', id: 'code-block', label: '代码块', icon: SquareCode },
  { kind: 'command', id: 'ol', label: '有序列表', icon: ListOrdered },
] as const

/**
 * 空行快捷插入条。
 *
 * 全部走结构命令而不是插 Markdown 片段：光标正停在一个空段落上，
 * 结构命令（`wrapInHeading` / `wrapInTaskList` / `createCodeBlock` …）能直接把它
 * 换成目标块，比起「插一行 `# ` 再指望 input rule 接住」既准确又少一次解析。
 */
export default function InsertToolbar({ editor, providerRef }: InsertToolbarProps) {
  const { renderPortal } = useFloatingBar(editor, providerRef, {
    // 宿主容器由 hook 建好后交给 Provider 搬到 body 下，见 SelectionToolbar 里的同类注释
    hostClassName: 'fehelper-floating-bar',
    shouldShow: isEmptyLine,
    // 贴在空行下方：空行上方通常是已经写好的正文，浮在上面会挡住它
    placement: 'bottom-start',
    pinLeft: pinLeftOfLine,
  })

  const pick = useCallback(
    (item: (typeof INSERT_ITEMS)[number]) => {
      if (item.kind === 'heading') setMilkdownHeading(editor, item.level)
      else runMilkdownCommand(editor, item.id)
    },
    [editor]
  )

  return (
    <>
      {renderPortal(
        <FloatingBarShell>
          {INSERT_ITEMS.map((item, index) => (
            <span key={item.label} className="flex items-center gap-0.5">
              {/* 标题与块级插入之间断一次，与 Cherry 的 float 工具条同款 */}
              {index === 3 && <FloatingBarDivider />}
              <FloatingBarButton icon={item.icon} label={item.label} onClick={() => pick(item)} />
            </span>
          ))}
        </FloatingBarShell>
      )}
    </>
  )
}
