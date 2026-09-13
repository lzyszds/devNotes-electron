import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { BlockProvider, block } from '@milkdown/kit/plugin/block'
import { NodeSelection } from '@milkdown/kit/prose/state'
import { GripVertical, Plus, Trash2 } from 'lucide-react'

export { block }

export type BlockHandleProps = {
  editor: Editor | null
}

/**
 * 块拖拽手柄。
 *
 * `BlockProvider` 负责「当前悬停在哪一块」以及拖拽移动的落点计算，
 * 手柄本身是 React 渲染的，通过 createPortal 挂进 provider 的容器。
 *
 * 拖动用的是 HTML5 原生 DnD —— provider 自己在宿主元素上挂好了
 * dragstart/dragover/drop，我们只要把 draggable 与 data-* 属性铺上去即可。
 */
export default function BlockHandle({ editor }: BlockHandleProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const providerRef = useRef<BlockProvider | null>(null)

  useEffect(() => {
    if (!editor || !host) return

    const provider = new BlockProvider({
      ctx: editor.ctx,
      content: host,
    })
    providerRef.current = provider

    return () => {
      provider.destroy()
      providerRef.current = null
    }
  }, [editor, host])

  /** 选中当前悬停的整块 —— 比让用户在块内三击选段落直观得多 */
  const selectBlock = () => {
    const active = providerRef.current?.active
    if (!active || !editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, active.$pos.before()))
      )
      view.focus()
    })
  }

  /** 删除当前块 */
  const deleteBlock = () => {
    const active = providerRef.current?.active
    if (!active || !editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const from = active.$pos.before()
      view.dispatch(view.state.tr.delete(from, from + active.node.nodeSize))
      view.focus()
    })
    providerRef.current?.hide()
  }

  return (
    <div ref={setHost} className="pointer-events-none absolute left-0 top-0 z-30">
      {host &&
        createPortal(
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-white px-0.5 py-0.5 shadow-md dark:border-dark-border dark:bg-dark-panel">
            {/* draggable 与 data-* 是 provider 认的契约，别改 */}
            <button
              type="button"
              draggable="true"
              data-drag-handle
              onClick={selectBlock}
              title="拖动以移动，点击选中整块"
              className="cursor-grab rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing dark:hover:bg-dark-hover dark:hover:text-slate-200"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={selectBlock}
              title="选中整块"
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
          </div>,
          host
        )}
    </div>
  )
}
