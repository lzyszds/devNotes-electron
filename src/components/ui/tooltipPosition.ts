/** 气泡定位的共用常量与算法：React 版 Tooltip 与命令式 domTooltip 都走这里，避免两套实现各自漂移 */

/** 气泡与触发元素之间的间距 */
export const TOOLTIP_GAP = 8
/** 气泡与视口边缘的最小留白 */
export const TOOLTIP_VIEWPORT_MARGIN = 8
/** 默认打开延迟：鼠标扫过一排工具栏按钮时不至于闪出一串提示 */
export const TOOLTIP_DELAY = 240

/**
 * 气泡优先出现的方向。
 * top  —— 默认，浮在触发元素上方
 * right / left —— 贴在触发元素侧面并与它垂直居中（一侧放不下会自动翻到另一侧）
 */
export type TooltipPlacement = 'top' | 'right' | 'left'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

/**
 * 由触发元素的位置与气泡实际尺寸算出气泡的 fixed 定位。
 *
 * 默认在触发元素上方；顶到视口上沿就翻到下方。
 * 水平方向与触发元素居中对齐，再夹进视口范围。
 *
 * 指定 right / left 时改为侧向放置：垂直方向与触发元素居中对齐，
 * 该侧宽度不够就翻到另一侧，两侧都放不下再退回默认的「上方」逻辑。
 */
export function computeTooltipPosition(
  anchor: DOMRect,
  size: { width: number; height: number },
  placement: TooltipPlacement = 'top'
): { top: number; left: number } {
  const maxLeft = window.innerWidth - TOOLTIP_VIEWPORT_MARGIN - size.width
  const maxTop = window.innerHeight - TOOLTIP_VIEWPORT_MARGIN - size.height

  if (placement === 'right' || placement === 'left') {
    const centeredTop = clamp(
      anchor.top + anchor.height / 2 - size.height / 2,
      TOOLTIP_VIEWPORT_MARGIN,
      maxTop
    )
    const rightEdge = anchor.right + TOOLTIP_GAP
    const leftEdge = anchor.left - TOOLTIP_GAP - size.width

    const fitsRight = rightEdge <= maxLeft
    const fitsLeft = leftEdge >= TOOLTIP_VIEWPORT_MARGIN

    if (placement === 'right' && fitsRight) return { top: centeredTop, left: rightEdge }
    if (fitsLeft) return { top: centeredTop, left: leftEdge }
    if (fitsRight) return { top: centeredTop, left: rightEdge }
    // 两侧都塞不下（触发元素几乎占满视口宽度），退回上下放置
  }

  let top = anchor.top - TOOLTIP_GAP - size.height
  if (top < TOOLTIP_VIEWPORT_MARGIN) top = anchor.bottom + TOOLTIP_GAP

  const centered = anchor.left + anchor.width / 2 - size.width / 2
  const left = Math.max(TOOLTIP_VIEWPORT_MARGIN, Math.min(centered, maxLeft))

  return { top, left }
}
