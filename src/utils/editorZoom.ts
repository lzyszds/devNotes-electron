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
