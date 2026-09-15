import { useCallback, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { FloatingBarShell, useFloatingBar } from './FloatingBar'

export type BlockHandleProps = {
  editor: Editor | null
  /** 由编辑器组件持有，闭包进驱动插件；见 milkdownFloatingBar.ts */
  providerRef: MutableRefObject<TooltipProvider | null>
}

/**
 * 手柄横向落在正文左侧留白里的位置（从编辑区左边缘算起）。
 *
 * 正文的 padding-left 是 48px（见 index.css 的 .milkdown-content），手柄竖排后
 * 约 28px 宽（图标 14 + 按钮内边距 4 + 外壳内边距 8 + 边框 2），居中放就是 10px。
 * 取 12px，右边缘离正文还剩 8px 余量。留白或手柄尺寸一改，这个值要跟着改。
 */
const HANDLE_LEFT = 12

type BlockRange = { from: number; to: number }

/**
 * 光标所在的**顶层块**。
 *
 * `before(1)` 取的是顶层块的位置 —— depth 为 0 时它会抛
 * "There is no position before the top-level node"，所以先挡一道。
 */
function blockAtCursor(view: EditorView): BlockRange | null {
  const { $from } = view.state.selection
  if ($from.depth < 1) return null
  const from = $from.before(1)
  const node = view.state.doc.nodeAt(from)
  if (!node) return null
  return { from, to: from + node.nodeSize }
}

/** 编辑器拿着焦点、且光标落在某个块里时才浮出来 */
function hasCursorInBlock(view: EditorView): boolean {
  if (!view.editable || !view.hasFocus()) return false
  return blockAtCursor(view) != null
}

/**
 * 横向钉死在左侧留白里，**只有纵向跟着光标走**。
 *
 * 这正是这次改动的要点：定位基准从「鼠标悬停在哪一块」换成「光标在哪一行」。
 * y 由 flex 的 left-start 决定 —— 塌陷选区的 posToDOMRect 返回的就是光标那一行
 * 的矩形（coordsAtPos 的 top/bottom 是该行的行高），所以鼠标再怎么晃都不影响。
 */
function pinLeftOfEditor(view: EditorView): number {
  return view.dom.getBoundingClientRect().left + HANDLE_LEFT
}

/** 拖拽落点：插到哪个顶层块的哪一侧，以及指示线该画在哪 */
type DropTarget = {
  pos: number
  lineTop: number
  lineLeft: number
  lineWidth: number
}

function resolveDropTarget(view: EditorView, clientX: number, clientY: number): DropTarget | null {
  const coords = view.posAtCoords({ left: clientX, top: clientY })
  // 鼠标拖到编辑区外，posAtCoords 返回 null —— 当作取消
  if (!coords) return null

  const $pos = view.state.doc.resolve(coords.pos)
  if ($pos.depth < 1) return null
  const start = $pos.before(1)
  const node = view.state.doc.nodeAt(start)
  const dom = view.nodeDOM(start)
  if (!node || !(dom instanceof HTMLElement)) return null

  const blockRect = dom.getBoundingClientRect()
  // 落在块的上半区就插到它前面，下半区插到后面 —— 与 ProseMirror 自己的落点判定同款
  const after = clientY > blockRect.top + blockRect.height / 2

  const contentRect = view.dom.getBoundingClientRect()
  const style = window.getComputedStyle(view.dom)
  const paddingLeft = parseFloat(style.paddingLeft) || 0
  const paddingRight = parseFloat(style.paddingRight) || 0

  return {
    pos: after ? start + node.nodeSize : start,
    lineTop: after ? blockRect.bottom : blockRect.top,
    lineLeft: contentRect.left + paddingLeft,
    lineWidth: contentRect.width - paddingLeft - paddingRight,
  }
}

/** 把整块搬到 pos 处。pos 落在原范围内（含前后边界）视为没挪动 */
function moveBlock(view: EditorView, source: BlockRange, pos: number) {
  if (pos >= source.from && pos <= source.to) return

  const slice = view.state.doc.slice(source.from, source.to)
  const tr = view.state.tr.delete(source.from, source.to)
  // 先删后插，插入点必须过一遍 mapping，否则删除位置之前的坐标会整体偏掉
  const insertAt = tr.mapping.map(pos)
  tr.insert(insertAt, slice.content)
  tr.setSelection(NodeSelection.create(tr.doc, insertAt))
  view.dispatch(tr)
  view.focus()
}

/**
 * 块操作手柄：光标在哪一行，就在那一行的最左侧浮出来。
 *
 * ⚠️ 这里**没有**用 `@milkdown/plugin-block`。它的 `active` 完全由 service 的
 * mousemove 经 `selectRootNodeByDom` 算出，定位又是按 `active.el.getBoundingClientRect()`
 * 算的 ——「跟着鼠标跑」是刻在它机制里的，没有开关能改成跟光标。所以定位改用
 * 浮条那套（TooltipProvider + 自绘），拖拽也就只能自己实现。
 *
 * 拖拽为什么不用原生 HTML5 drag：手柄按下时必须 `preventDefault`，否则编辑区立刻
 * 失焦、选区消失，要搬的那一块就无从谈起；而 `preventDefault` 恰恰会让浏览器不启动
 * 原生拖拽。两者不可兼得，于是走手动的 mousedown → mousemove → mouseup。
 */
export default function BlockHandle({ editor, providerRef }: BlockHandleProps) {
  // 拖拽中的插入指示线。null = 没在拖，或落点不在编辑区内
  const [dropLine, setDropLine] = useState<Omit<DropTarget, 'pos'> | null>(null)
  const dropPosRef = useRef<number | null>(null)

  const { renderPortal } = useFloatingBar(editor, providerRef, {
    // 宿主元素由 hook 建好并交给 Provider 搬到 body 下，类名只能是全局的
    // （搬到 body 后编辑区的作用域选择器就匹配不上了）
    hostClassName: 'fehelper-block-handle',
    shouldShow: hasCursorInBlock,
    // 贴在光标那一行的左侧、顶对齐。y 就是这一行的 top
    placement: 'left-start',
    pinLeft: pinLeftOfEditor,
    // 按住鼠标时不能收 —— 拖拽就是从这颗按钮上按下去的
    hideWhilePointerDown: false,
  })

  /** 光标所在块之后插入一个空段落，并把光标放进去 */
  const insertBelow = useCallback(() => {
    if (!editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const source = blockAtCursor(view)
      const paragraph = view.state.schema.nodes.paragraph
      if (!source || !paragraph) return
      const tr = view.state.tr.insert(source.to, paragraph.create())
      tr.setSelection(TextSelection.near(tr.doc.resolve(source.to + 1)))
      view.dispatch(tr)
      view.focus()
    })
  }, [editor])

  /** 删除整块 */
  const deleteBlock = useCallback(() => {
    if (!editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const source = blockAtCursor(view)
      if (!source) return

      // 文档只剩这一块时不能直接删空：schema 要求 doc 至少有一个块。
      // 这种情况下换成空段落，等价于「清空这一块」
      const tr =
        view.state.doc.childCount === 1
          ? view.state.tr.replaceWith(source.from, source.to, view.state.schema.nodes.paragraph.create())
          : view.state.tr.delete(source.from, source.to)

      const anchor = Math.min(source.from, tr.doc.content.size)
      tr.setSelection(TextSelection.near(tr.doc.resolve(anchor)))
      view.dispatch(tr)
      view.focus()
    })
  }, [editor])

  /** 按下把手开始拖动 */
  const startDrag = useCallback(
    (event: ReactMouseEvent) => {
      // 拦掉默认行为，编辑区才不会失焦 —— 这一段注释见组件顶部
      event.preventDefault()
      if (!editor) return

      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const source = blockAtCursor(view)
        if (!source) return

        dropPosRef.current = null

        const onMove = (moveEvent: MouseEvent) => {
          const target = resolveDropTarget(view, moveEvent.clientX, moveEvent.clientY)
          if (!target) {
            dropPosRef.current = null
            setDropLine(null)
            return
          }
          dropPosRef.current = target.pos
          setDropLine({ lineTop: target.lineTop, lineLeft: target.lineLeft, lineWidth: target.lineWidth })
        }

        const stop = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          window.removeEventListener('blur', onCancel)
          setDropLine(null)
        }

        const onUp = () => {
          stop()
          const pos = dropPosRef.current
          dropPosRef.current = null
          if (pos != null) moveBlock(view, source, pos)
        }

        // 切到别的应用时 mouseup 收不到，不兜底的话指示线会一直挂在屏幕上，
        // 而且下次在窗口里随手一点会拿旧落点把块搬走
        const onCancel = () => {
          stop()
          dropPosRef.current = null
        }

        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
        window.addEventListener('blur', onCancel)
      })
    },
    [editor]
  )

  return (
    <>
      {renderPortal(
        /*
          竖排三颗，整条宽度只有 20px 出头，正好塞进正文 48px 的左留白。
          改成横排的话左边放不下，floating-ui 默认带的 flip() 会把整条翻到右侧并被裁掉。

          ⚠️ 把手用 draggable="true" 是不行的 —— 原生的 dragstart 起不来，反倒会和
          这里的 mousedown 抢事件（原因见组件顶部注释）。
        */
        <FloatingBarShell className="flex-col">
          <button
            type="button"
            onMouseDown={startDrag}
            title="按住拖动以移动该块"
            className="cursor-grab rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing dark:hover:bg-dark-hover dark:hover:text-slate-200"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={insertBelow}
            title="在下方插入段落"
            className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-dark-hover dark:hover:text-slate-200"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={deleteBlock}
            title="删除该块"
            className="rounded p-0.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/15 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </FloatingBarShell>
      )}

      {/*
        拖拽落点指示线。fixed 定位，所以不受 .milkdown-scroll 的 overflow 裁剪 ——
        与手柄挂在 body 下是同一个理由。
        层级取 85：压过两条浮条（80），低于自绘 Tooltip（90）。
      */}
      {dropLine && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[85] h-0.5 rounded-full bg-brand-500"
          style={{ top: dropLine.lineTop, left: dropLine.lineLeft, width: dropLine.lineWidth }}
        />
      )}
    </>
  )
}
