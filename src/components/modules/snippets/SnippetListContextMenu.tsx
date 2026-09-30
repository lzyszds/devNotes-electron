import type { ReactNode } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Copy, Pencil, Star, Trash2 } from 'lucide-react'
import { useContextMenu } from '../../ui/ContextMenu'
import { useToast } from '../../ui/Toast'
import { copyText } from '../../../utils/clipboard'
import { useSnippets, PLACEHOLDER_RE, type Snippet } from './useSnippets'

/**
 * 片段列表行的右键菜单。
 *
 * 和侧栏里其他模块（笔记、工具列表）保持一致：右键给出这一项能做的事，
 * 顺手把「复制内容 / 复制标题」这类不用打开详情就能完成的动作放前面。
 */
export default function SnippetListContextMenu({
  item,
  onStar,
  children,
}: {
  item: Snippet
  /** 收藏态由行内自己维护，这里只负责把动作转出去 */
  onStar: () => void
  children: ReactNode
}) {
  const { openContextMenu } = useContextMenu()
  const { showToast } = useToast()
  const { remove } = useSnippets()

  const handleContextMenu = (e: ReactMouseEvent) => {
    openContextMenu(e, [
      {
        id: 'snip-copy',
        label: '复制内容',
        icon: <Copy className="w-3.5 h-3.5" />,
        onSelect: async () => {
          const ok = await copyText(item.code)
          if (!ok) {
            showToast('复制失败', 'error')
            return
          }
          const placeholders = item.code.match(PLACEHOLDER_RE)
          showToast(
            placeholders?.length
              ? `已复制，记得替换 ${Array.from(new Set(placeholders)).join('、')}`
              : '已复制到剪贴板',
          )
        },
      },
      {
        id: 'snip-copy-title',
        label: '复制标题',
        icon: <Copy className="w-3.5 h-3.5" />,
        disabled: !item.title,
        onSelect: async () => {
          const ok = await copyText(item.title)
          showToast(ok ? '已复制标题' : '复制失败', ok ? 'default' : 'error')
        },
      },
      { id: 'snip-sep-1', separator: true },
      {
        id: 'snip-edit',
        label: '编辑',
        icon: <Pencil className="w-3.5 h-3.5" />,
        onSelect: () => {
          // 编辑面板在主区，用事件把它唤起来
          window.dispatchEvent(new CustomEvent('snippets:edit', { detail: item.id }))
        },
      },
      {
        id: 'snip-star',
        label: item.starred ? '取消收藏' : '收藏置顶',
        icon: <Star className="w-3.5 h-3.5" />,
        onSelect: onStar,
      },
      { id: 'snip-sep-2', separator: true },
      {
        id: 'snip-delete',
        label: '删除片段',
        danger: true,
        icon: <Trash2 className="w-3.5 h-3.5" />,
        onSelect: () => {
          if (!window.confirm(`删除片段「${item.title || '未命名'}」？此操作不可撤销。`)) return
          void remove(item.id)
          showToast('已删除')
        },
      },
    ])
  }

  return <div onContextMenu={handleContextMenu}>{children}</div>
}
