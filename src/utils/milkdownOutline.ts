/**
 * 从 Milkdown 文档里收集大纲条目，并支持跳转。
 *
 * 刻意不用 `@milkdown/kit/utils` 的 `outline()` 宏 —— 它返回 `{ text, level, id }`，
 * 而 heading 的 `id` 属性默认是空串，DOM 上的 id 是 toDOM 里用 getId(node) 现算的、
 * 且 toMarkdown 根本不写它。也就是说拿 `outline()` 的 id 去定位文档位置必然失败。
 *
 * 这里直接遍历文档树，顺手把 `pos` 记下来 —— 有了真实的文档位置，
 * 跳转就是 posToDOMRect 一次换算的事。
 */
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'

export interface OutlineItem {
  text: string
  level: number
  /** 文档绝对位置，供跳转用 */
  pos: number
}

/** 收集全文标题。没有标题时返回空数组 */
export function collectOutline(editor: Editor | null): OutlineItem[] {
  if (!editor) return []
  try {
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const items: OutlineItem[] = []
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          const level = Number(node.attrs.level) || 1
          items.push({ text: node.textContent || '(空标题)', level, pos })
        }
        return true
      })
      return items
    })
  } catch {
    return []
  }
}

/** 把某条大纲对应的标题滚进视野并高亮一下 */
export function revealOutlineItem(editor: Editor | null, item: OutlineItem): void {
  if (!editor) return
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      // 用 domAtPos 拿真实 DOM 再 scrollIntoView，比 posToDOMRect 少一层坐标换算
      const dom = view.domAtPos(item.pos)
      const el =
        dom.node instanceof HTMLElement ? dom.node : (dom.node.parentElement as HTMLElement | null)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      view.focus()
    })
  } catch (error) {
    console.error('[Milkdown] 大纲跳转失败:', error)
  }
}
