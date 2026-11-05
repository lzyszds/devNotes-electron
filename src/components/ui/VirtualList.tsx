import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

export interface VirtualListProps<T> {
  items: T[]
  /**
   * 固定行高（px）。虚拟化按「每行等高」计算窗口，行高不固定的列表会跳。
   * 用之前先保证行内容全部 truncate / 定高，长文本不换行。
   */
  rowHeight: number
  getRowKey: (item: T, index: number) => string
  renderRow: (item: T, index: number) => ReactNode
  className?: string
  /** 视口外上下多渲染几行做缓冲，避免快速滚动时出现空白帧 */
  overscan?: number
}

/**
 * 极简固定行高虚拟列表（针对几十到几百行的排行榜场景）。
 *
 * 没引 react-window 之类：这类库为了变高行、无限滚动等能力有十几 KB 的
 * 体积和一堆受控 API，这里只需要「等高行 + 内部滚动」一个能力，
 * 60 行代码的绝对定位方案反而好读好改。超过千行的长表再考虑上库。
 *
 * 容器本体就是滚动容器：外层想限高就传 className（如 max-h-*），
 * 视口高度用 ResizeObserver 实时量，分类侧栏拖宽拖窄都不会算错。
 */
export default function VirtualList<T>({
  items,
  rowHeight,
  getRowKey,
  renderRow,
  className,
  overscan = 4,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  /** 视口高度先给个合理初值，挂载后会被真实测量值立刻覆盖 */
  const [viewport, setViewport] = useState(456)
  /** scrollTop 必须进 state：窗口位置变了要重算该渲染哪几行 */
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setViewport(el.clientHeight)
    const ro = new ResizeObserver(() => setViewport(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const contentHeight = items.length * rowHeight
  // 数据变少（搜索过滤）后浏览器会把 scrollTop 自动收回来，但不一定立刻带动
  // onScroll；渲染前先夹住，避免 start 算出窗口外导致整屏空白
  const clampedTop = Math.min(scrollTop, Math.max(0, contentHeight - viewport))
  const start = Math.max(0, Math.floor(clampedTop / rowHeight) - overscan)
  const end = Math.min(
    items.length,
    Math.ceil((clampedTop + viewport) / rowHeight) + overscan,
  )

  return (
    <div
      ref={containerRef}
      className={`${className ?? ''} overflow-y-auto overflow-x-hidden`}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* 撑起真实滚动高度：只渲染 start..end 这一小段行，绝对定位在正确位置 */}
      <div style={{ height: contentHeight, position: 'relative' } as CSSProperties}>
        {items.slice(start, end).map((item, i) => {
          const index = start + i
          const rowStyle: CSSProperties = {
            position: 'absolute',
            top: index * rowHeight,
            left: 0,
            right: 0,
            height: rowHeight,
          }
          return (
            <div key={getRowKey(item, index)} style={rowStyle}>
              {renderRow(item, index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
