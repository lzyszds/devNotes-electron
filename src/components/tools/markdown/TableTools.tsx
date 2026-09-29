import { useCallback, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import type { EditorView } from '@milkdown/kit/prose/view'
import { addColAfterCommand, addRowAfterCommand } from '@milkdown/preset-gfm'
import { callCommand } from '@milkdown/kit/utils'
import { Columns3, Rows3 } from 'lucide-react'
import Tooltip from '../../ui/Tooltip'
import { useFloatingBar } from './FloatingBar'

export type TableToolsProps = {
  editor: Editor | null
  providerRef: MutableRefObject<TooltipProvider | null>
}

/**
 * 找到光标所在的表格节点与它在文档里的位置。
 *
 * 从选区位置往上逐层找，直到遇见 table —— 表格可以嵌在列表里，
 * 所以不能只看 depth 1；找不到就是没在表格里。
 */
function tableAtCursor(view: EditorView): { pos: number; node: NonNullable<ReturnType<typeof view.state.doc.nodeAt>> } | null {
  const { $from } = view.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'table') {
      return { pos: $from.before(depth), node }
    }
  }
  return null
}

/** 光标在表格里、且编辑器可编辑时才浮出来 */
function hasCursorInTable(view: EditorView): boolean {
  if (!view.editable || !view.hasFocus()) return false
  return tableAtCursor(view) != null
}

/**
 * 光标所在单元格的矩形（视口坐标）。不在表格里、或 DOM 还没渲染出来时返回 null。
 *
 * 取 `td/th` 而不是直接用 domAtPos 的结果：选中的可能是格内的文字节点，
 * 它的矩形只有那一行那么高，按钮会浮到格子中间而不是下沿。
 */
function cellRectAt(view: EditorView): DOMRect | null {
  if (!tableAtCursor(view)) return null
  const dom = view.domAtPos(view.state.selection.from)
  const el =
    dom.node instanceof HTMLElement ? dom.node : (dom.node.parentElement as HTMLElement | null)
  const cell = el?.closest<HTMLElement>('td, th') ?? null
  return cell?.getBoundingClientRect() ?? null
}

/**
 * 表格的悬浮操作按钮。
 *
 * 光标停在某个单元格里时，那一格的**右下角**浮出一对小按钮：加一行、加一列。
 * 都在「当前所在行列」之后插入，符合「在光标这一行下面加」的直觉。
 *
 * 为什么不做成 Notion 那样在表格边线上悬停出按钮：那需要在表格四周各挂一个
 * 跟随鼠标的浮层，而本文档的编辑区滚动容器与浮层坐标系不同（浮层挂在 body 下），
 * 边缘定位在滚动/缩放时容易飘。钉在光标所在格上最稳，也不用猜用户想操作哪一行。
 */
export default function TableTools({ editor, providerRef }: TableToolsProps) {
  /**
   * 光标是否真的落在一个能定位的单元格上。
   *
   * 只当作渲染开关用（false 就不渲染内容）—— 位置由 pinRect 算，
   * 那个必须每帧现算（浮层会被滚动、编辑推着走），所以不能存进 state。
   */
  const [inCell, setInCell] = useState(false)

  const sync = useCallback((view: EditorView) => {
    setInCell(cellRectAt(view) != null)
  }, [])

  const { renderPortal } = useFloatingBar(editor, providerRef, {
    hostClassName: 'fehelper-table-tools',
    shouldShow: hasCursorInTable,
    /*
     * 钉在光标所在那一格的右下角。用格子的矩形而不是整张表 ——
     * 表很长时光标在中间，按整表定位按钮会跑出屏幕。
     */
    pinRect: (view) => {
      const rect = cellRectAt(view)
      return rect ? { top: rect.bottom, right: rect.right } : null
    },
    onEvaluate: sync,
    /*
     * 按下去就收起来是不行的：这几个按钮是「点一下执行一次」，
     * 收起来的过程中鼠标还在按钮上，会让点击落空。
     */
    hideWhilePointerDown: false,
  })

  /**
   * 执行插入命令。
   *
   * 用 Milkdown gfm **自己的**命令，不是 prosemirror-tables 的同名通用命令 ——
   * 两者的表格模型不一样：这套 schema 的表头是**行级**的（table_header_row，
   * 且整表只允许一个、必须在最前），而通用命令是按「格级表头」写的。
   * 拿通用命令在表头行旁边插，插出来的是一个普通行里塞着表头格（违反 schema），
   * 表现就是「新行莫名其妙带着表头样式」。
   *
   * gfm 的 addRowAfterCommand 走 addRowWithAlignment，固定建普通行 + 继承对齐属性，
   * 这在这套 schema 下才是对的。
   */
  const run = useCallback(
    (command: typeof addRowAfterCommand) => {
      if (!editor) return
      editor.action((ctx) => {
        callCommand(command.key)(ctx)
        ctx.get(editorViewCtx).focus()
      })
    },
    [editor]
  )

  if (!inCell) return null

  return renderPortal(
    <div className="flex items-center gap-1 rounded-lg border border-slate-200/80 bg-white/95 p-1 shadow-lg backdrop-blur-xl dark:border-dark-border dark:bg-dark-panel/95">
      <Tooltip content="在当前行下方插入一行" placement="top">
        <button
          type="button"
          onClick={() => run(addRowAfterCommand)}
          aria-label="插入行"
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:scale-105 hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-400"
        >
          <Rows3 className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <Tooltip content="在当前列右侧插入一列" placement="top">
        <button
          type="button"
          onClick={() => run(addColAfterCommand)}
          aria-label="插入列"
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:scale-105 hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-400"
        >
          <Columns3 className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  )
}
