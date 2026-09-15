/**
 * 笔记编辑器的画面缩放。
 *
 * 单独抽一层模块级状态（而不是塞进 React state）的原因：缩放要能被三个入口改到 ——
 * 顶部条的按钮、⌘= / ⌘- / ⌘0 快捷键、以及 ⌘+滚轮。三者都在事件回调里，
 * 让它们各自去 setState 会把这份状态散到三处；这里统一收口，UI 只订阅。
 */

export const ZOOM_MIN = 50
export const ZOOM_MAX = 200
export const ZOOM_STEP = 10
export const ZOOM_DEFAULT = 100

const STORAGE_KEY = 'fehelper-editor-zoom'

const listeners = new Set<(zoom: number) => void>()

const clamp = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)))

function readZoom(): number {
  const saved = Number(localStorage.getItem(STORAGE_KEY))
  return Number.isFinite(saved) && saved > 0 ? clamp(saved) : ZOOM_DEFAULT
}

let current = readZoom()

export function getZoom(): number {
  return current
}

/** 设置缩放到指定百分比，返回夹取后的实际值 */
export function setZoom(next: number): number {
  const value = clamp(next)
  if (value === current) return value
  current = value
  localStorage.setItem(STORAGE_KEY, String(value))
  listeners.forEach((notify) => notify(value))
  return value
}

/** 按档位步进，返回夹取后的实际值 */
export function stepZoom(delta: number): number {
  return setZoom(current + delta)
}

export function resetZoom(): number {
  return setZoom(ZOOM_DEFAULT)
}

export function subscribeZoom(notify: (zoom: number) => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

/*
 * 全屏预览的适配倍率。
 *
 * 与上面那份手动倍率互不相干：预览倍率不进 store、不落盘，由 NotesTool 按预览层
 * 当下的宽度现算，所以退出预览不需要「恢复」什么 —— 手动倍率一直是原来那个。
 *
 * 为什么只放大不缩小：预览层比基准宽度窄时，80rem 的版心本来就快铺满了，
 * 再往下缩只会让字变小，与「适配全屏」的目的相反。
 */
export const PREVIEW_BASE_WIDTH = 1600
export const PREVIEW_MAX_ZOOM = 2

/** 按预览层宽度算适配倍率。窄于基准宽度返回 1（不缩小），宽于则等比放大并封顶 */
export function fitZoomFor(stageWidth: number): number {
  if (!Number.isFinite(stageWidth) || stageWidth <= 0) return 1
  const fit = Math.min(PREVIEW_MAX_ZOOM, Math.max(1, stageWidth / PREVIEW_BASE_WIDTH))
  // 取三位小数：够表达倍率，又不会在 resize 时抖出 1.2000000000000002 这种值
  return Math.round(fit * 1000) / 1000
}
