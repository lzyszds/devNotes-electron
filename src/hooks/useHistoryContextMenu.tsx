import { useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Copy, CornerUpLeft, Trash2 } from 'lucide-react'
import { useContextMenu } from '../components/ui/ContextMenu'
import type { ContextMenuItem } from '../components/ui/ContextMenu'
import { useToast } from '../components/ui/Toast'
import { copyText } from '../utils/clipboard'
import type { HistoryItem } from './useToolHistory'

interface HistoryMenuOptions<T> {
  /** 「使用此记录」的动作(与列表项左键点击一致),不传则不显示该项 */
  onUse?: (item: HistoryItem<T>) => void
  /** 「使用此记录」的文案,默认「使用此记录」 */
  useLabel?: string
  /** 复制内容时的文本化方式,默认字符串原样、其余对象转格式化 JSON */
  toText?: (data: T, item: HistoryItem<T>) => string
  /** 删除单条记录(useToolHistory 的 removeHistoryItem) */
  onRemove?: (id: string) => void
}

function defaultToText(data: unknown): string {
  if (typeof data === 'string') return data
  if (data == null) return ''
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

/**
 * 工具历史记录项的统一右键菜单工厂:
 * 八个工具的历史面板结构一致,动作也只有「使用 / 复制 / 删除」三种,集中在一处维护。
 */
export function useHistoryContextMenu<T = string>(options: HistoryMenuOptions<T> = {}) {
  const { openContextMenu } = useContextMenu()
  const { showToast } = useToast()

  const { onUse, useLabel, toText, onRemove } = options

  return useCallback(
    (event: ReactMouseEvent, item: HistoryItem<T>) => {
      const text = toText ? toText(item.data, item) : defaultToText(item.data)
      // 标题与内容完全一致时(如 WebSocket 记录)不再重复给出「复制标题」
      const showCopyTitle = Boolean(item.title) && item.title !== text

      const copyWithToast = async (value: string, label: string) => {
        const ok = await copyText(value)
        showToast(ok ? label : '复制失败', ok ? 'default' : 'error')
      }

      const items: ContextMenuItem[] = [
        ...(onUse
          ? [
              {
                id: 'history-use',
                label: useLabel || '使用此记录',
                icon: <CornerUpLeft className="w-3.5 h-3.5" />,
                onSelect: () => onUse(item),
              },
              { id: 'history-sep-1', separator: true },
            ]
          : []),
        {
          id: 'history-copy',
          label: '复制内容',
          icon: <Copy className="w-3.5 h-3.5" />,
          disabled: !text,
          onSelect: () => void copyWithToast(text, '已复制内容'),
        },
        ...(showCopyTitle
          ? [
              {
                id: 'history-copy-title',
                label: '复制标题',
                icon: <Copy className="w-3.5 h-3.5" />,
                onSelect: () => void copyWithToast(item.title || '', '已复制标题'),
              },
            ]
          : []),
        ...(onRemove
          ? [
              { id: 'history-sep-2', separator: true },
              {
                id: 'history-remove',
                label: '删除此记录',
                icon: <Trash2 className="w-3.5 h-3.5" />,
                danger: true,
                onSelect: () => onRemove(item.id),
              },
            ]
          : []),
      ]

      openContextMenu(event, items)
    },
    [openContextMenu, showToast, onUse, useLabel, toText, onRemove]
  )
}
