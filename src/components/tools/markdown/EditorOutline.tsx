import { ListTree, X } from 'lucide-react'
import type { OutlineItem } from '../../../utils/milkdownOutline'
import Tooltip from '../../ui/Tooltip'

export type EditorOutlineProps = {
  items: OutlineItem[]
  /** 当前光标所在的标题位置，用于高亮。没有则为 null */
  activePos: number | null
  onPick: (item: OutlineItem) => void
  onClose: () => void
}

/**
 * 所见即所得的大纲浮层。
 *
 * 与 Cherry 那套（.cherry-flex-toc，由 index.css 里近 200 行规则改造过）观感对齐：
 * 配色复用同一组 --md-toc-* 变量，但选择器是全新的 —— Cherry 那份是写给它自己
 * 生成的 DOM 的，套不到这里来。
 */
export default function EditorOutline({ items, activePos, onPick, onClose }: EditorOutlineProps) {
  return (
    <aside
      className="absolute right-2 top-2 z-20 flex max-h-[calc(100%-1rem)] w-56 flex-col overflow-hidden rounded-lg border shadow-lg backdrop-blur-sm"
      style={{
        background: 'var(--md-toc-bg)',
        borderColor: 'var(--md-toc-border-color)',
      }}
    >
      <header
        className="flex flex-shrink-0 items-center gap-1.5 border-b px-2.5 py-1.5"
        style={{ borderColor: 'var(--md-toc-border-color)' }}
      >
        <ListTree className="h-3.5 w-3.5" style={{ color: 'var(--md-toc-indicator-hover-color)' }} />
        <span className="flex-1 text-[11px] font-semibold" style={{ color: 'var(--md-toc-link-color)' }}>
          大纲
        </span>
        <Tooltip content="收起大纲">
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: 'var(--md-toc-link-color)' }}
          >
            <X className="h-3 w-3" />
          </button>
        </Tooltip>
      </header>

      {items.length === 0 ? (
        <p className="px-2.5 py-3 text-[11px]" style={{ color: 'var(--md-toc-indicator-color)' }}>
          当前文档还没有标题
        </p>
      ) : (
        <nav className="min-h-0 flex-1 overflow-y-auto py-1">
          {items.map((item) => {
            const active = item.pos === activePos
            return (
              <button
                key={`${item.pos}-${item.level}`}
                type="button"
                onClick={() => onPick(item)}
                className="block w-full truncate rounded px-2.5 py-1 text-left text-[11px] transition-colors"
                style={{
                  // 按级别缩进，最多到 6 级
                  paddingLeft: `${0.625 + (item.level - 1) * 0.5}rem`,
                  color: 'var(--md-toc-link-color)',
                  background: active ? 'var(--md-toc-link-active-bg)' : 'transparent',
                  fontWeight: active ? 600 : 400,
                }}
                onMouseEnter={(event) => {
                  if (!active) event.currentTarget.style.background = 'var(--md-toc-link-hover-bg)'
                }}
                onMouseLeave={(event) => {
                  if (!active) event.currentTarget.style.background = 'transparent'
                }}
              >
                {item.text}
              </button>
            )
          })}
        </nav>
      )}
    </aside>
  )
}
