import { useEffect, useState } from 'react'
import {
  getShortcutMap,
  subscribeShortcuts,
  type ShortcutMap,
} from '../utils/shortcutSettings'

/**
 * 订阅快捷键配置。
 *
 * 配置改了要让所有用到它的地方同时更新：按键监听要换键位、设置界面要刷新
 * 显示、速查表要跟着变。走 shortcutSettings 里的订阅广播，比每个组件各自
 * 监听 storage 事件省事，也不依赖存储实现。
 */
export function useShortcutSettings(): ShortcutMap {
  const [map, setMap] = useState<ShortcutMap>(getShortcutMap)

  useEffect(() => subscribeShortcuts(setMap), [])

  return map
}
