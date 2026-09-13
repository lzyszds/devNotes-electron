/** 气泡定位的共用常量与算法：React 版 Tooltip 与命令式 domTooltip 都走这里，避免两套实现各自漂移 */

/** 气泡与触发元素之间的间距 */
export const TOOLTIP_GAP = 8
/** 气泡与视口边缘的最小留白 */
export const TOOLTIP_VIEWPORT_MARGIN = 8
/** 默认打开延迟：鼠标扫过一排工具栏按钮时不至于闪出一串提示 */
export const TOOLTIP_DELAY = 240

/**
 * 由触发元素的位置与气泡实际尺寸算出气泡的 fixed 定位。
 *
 * 默认在触发元素上方；顶到视口上沿就翻到下方。
 * 水平方向与触发元素居中对齐，再夹进视口范围。
 */
export function computeTooltipPosition(
  anchor: DOMRect,
  size: { width: number; height: number }
): { top: number; left: number } {
  let top = anchor.top - TOOLTIP_GAP - size.height
  if (top < TOOLTIP_VIEWPORT_MARGIN) top = anchor.bottom + TOOLTIP_GAP

  const centered = anchor.left + anchor.width / 2 - size.width / 2
  const maxLeft = window.innerWidth - TOOLTIP_VIEWPORT_MARGIN - size.width
  const left = Math.max(TOOLTIP_VIEWPORT_MARGIN, Math.min(centered, maxLeft))

  return { top, left }
}
