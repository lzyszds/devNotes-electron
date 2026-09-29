import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Bookmark, Trash2 } from 'lucide-react'
import Tooltip from '../../ui/Tooltip'
import { useContextMenu } from '../../ui/ContextMenu'
import type { ReadingBookmark } from '../../../utils/notesStore'
import { findBookmarkBlock } from '../../../utils/readingBookmark'

export type BookmarkGutterProps = {
  /** 正文滚动容器。拿它算每一块的纵向位置，也拿它当重算的触发源 */
  container: HTMLElement | null
  bookmarks?: ReadingBookmark[]
  /** 正文内容。变了要重量 —— 块的增删会改变高度 */
  content: string
  /** 当前滚动位置。标记层在滚动容器外，靠它把标记挪到可视区里的正确高度 */
  scrollTop: number
  /** 缩放倍率。留白宽度是它换算出来的，标记的横向位置得跟着走 */
  zoom: number
  /** 点了某条标记：跳过去 */
  onJump: (bookmark: ReadingBookmark) => void
  /** 删除某条书签（右键标记走这条） */
  onDelete: (bookmark: ReadingBookmark) => void
}

/** 一条标记：它对应哪条书签、以及纵向该贴在滚动内容里的哪个绝对位置 */
type Marker = { bookmark: ReadingBookmark; center: number }

/**
 * 正文左侧的书签标记。
 *
 * 记过书签的那一块，左边常驻一个小书签图标 —— 一眼看出「这篇里哪儿标过」，
 * 不用展开目录挨个找。有备注的用实心品牌色，没备注的用空心浅灰。
 *
 * 为什么不在正文里插伪元素：ProseMirror 按自己的文档模型认子节点，
 * 往它管的 DOM 里塞元素会被当成内容、还可能被下一次重渲染抹掉。
 * 所以标记是独立的**浮层**，靠坐标贴合，与编辑器的 DOM 完全解耦。
 */
export default function BookmarkGutter({
  container,
  bookmarks,
  content,
  scrollTop,
  zoom,
  onJump,
  onDelete,
}: BookmarkGutterProps) {
  const [markers, setMarkers] = useState<Marker[]>([])
  const { openContextMenu } = useContextMenu()

  /**
   * 右键标记：跳转 / 删除。
   *
   * 删除入口此前只藏在「展开目录 → 悬停那条书签」里，太深了 ——
   * 标记本身就在眼前，右键它是最顺手的删除方式。
   */
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent, bookmark: ReadingBookmark) => {
      openContextMenu(event, [
        {
          id: 'bookmark-jump',
          label: '跳到这里',
          icon: <Bookmark className="h-3.5 w-3.5" />,
          onSelect: () => onJump(bookmark),
        },
        {
          id: 'bookmark-delete',
          label: '删除这条书签',
          icon: <Trash2 className="h-3.5 w-3.5" />,
          danger: true,
          onSelect: () => onDelete(bookmark),
        },
      ])
    },
    [onDelete, onJump, openContextMenu]
  )

  const measure = useCallback(() => {
    if (!container || !bookmarks?.length) {
      setMarkers([])
      return
    }
    const containerTop = container.getBoundingClientRect().top
    const next: Marker[] = []
    bookmarks.forEach((bookmark) => {
      const block = findBookmarkBlock(container, bookmark)
      if (!block) return
      /*
       * 取块的**垂直中心**，不是顶边 —— 图标以自身顶边对齐坐标，
       * 用顶边会让它压在段落上沿（多行段落尤其明显，看着像没对齐）。
       * 与 scrollTop 无关，所以滚动时不必重量。
       */
      const rect = block.getBoundingClientRect()
      const center = rect.top - containerTop + container.scrollTop + rect.height / 2
      next.push({ bookmark, center })
    })
    next.sort((a, b) => a.center - b.center)
    setMarkers(next)
  }, [bookmarks, container])

  // 内容、容器、缩放任一变化都要重量：块高会变，留白宽度也会变
  useLayoutEffect(() => {
    measure()
  }, [measure, content, zoom])

  /*
   * 字体加载完、图片解码完、窗口缩放导致折行变化，正文高度都会变，
   * 先前量的位置就旧了。盯住正文元素的高度，一变就重量。
   */
  useEffect(() => {
    if (!container) return
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    const contentEl = container.querySelector<HTMLElement>('.milkdown-content, .cherry-previewer')
    if (contentEl) observer.observe(contentEl)
    return () => observer.disconnect()
  }, [container, measure])

  if (markers.length === 0) return null

  /*
   * 相邻标记离得太近就只留靠上的那条 —— 一行里挤两个图标会叠在一起看不清。
   * 阈值取图标高（16px）加一点间距。
   */
  const visible: Marker[] = []
  markers.forEach((marker) => {
    const last = visible[visible.length - 1]
    if (last && marker.center - last.center < 20) return
    visible.push(marker)
  })

  return (
    // 盖在滚动容器左留白上，与块手柄**同一列**（手柄也在 left: 12 附近）。
    // 层级取 15，**低于**块手柄（它的浮层在 z-index 更高的一档）——
    // 光标停在某段时手柄浮出来会盖住这一格的标记，那是刻意的：
    // 手柄是「此刻能操作的工具」，标记是「这里标过」的提示，工具优先。
    <div className="pointer-events-none absolute inset-y-0 left-0 z-[15] w-12 overflow-hidden select-none">
      {visible.map(({ bookmark, center }) => (
        <Tooltip
          key={bookmark.id}
          content={
            <span className="block max-w-[16rem]">
              {bookmark.heading}
              {bookmark.note ? `：${bookmark.note}` : ` · 读到 ${bookmark.percent}%`}
            </span>
          }
          placement="right"
        >
          <button
            type="button"
            onClick={() => onJump(bookmark)}
            onContextMenu={(event) => handleContextMenu(event, bookmark)}
            aria-label={`跳到书签：${bookmark.heading}`}
            style={{
              // 图标高 16px，减半让它的**中心**落在块的中心上
              top: center - scrollTop - 8,
              // 与块手柄对齐到同一列（手柄是编辑区左边缘 +12px，图标比它宽 2px，
              // 所以这里多退 1px 让两者中心重合）。除以倍率抵消缩放 ——
              // 外层不在 zoom 层里，而左留白是 zoom 层内换算的
              left: `calc(11px / var(--editor-zoom, 1))`,
            }}
            className={`pointer-events-auto absolute flex h-4 w-4 items-center justify-center rounded transition-transform hover:scale-125 ${
              bookmark.note
                ? 'text-brand-500 hover:text-brand-600 dark:text-brand-400'
                : 'text-slate-300 hover:text-brand-500 dark:text-slate-600'
            }`}
          >
            <Bookmark className={`h-3.5 w-3.5 ${bookmark.note ? 'fill-current' : ''}`} />
          </button>
        </Tooltip>
      ))}
    </div>
  )
}
