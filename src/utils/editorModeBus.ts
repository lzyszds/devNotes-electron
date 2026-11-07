import { persistEditorMode, readEditorMode, type EditorMode } from '../components/tools/EditorModeSwitch'
import { useUiPrefsStore } from '../store/uiPrefsStore'

type Listener = (mode: EditorMode) => void
const listeners = new Set<Listener>()

let currentMode: EditorMode = readEditorMode()

/** persist 异步灌完后同步模块缓存，避免笔记页一直停在 hydrate 前的默认内核 */
useUiPrefsStore.persist.onFinishHydration(() => {
  const next = readEditorMode()
  if (next === currentMode) return
  currentMode = next
  listeners.forEach((fn) => fn(next))
})

export function getEditorMode(): EditorMode {
  return currentMode
}

export function setEditorMode(mode: EditorMode): void {
  currentMode = mode
  persistEditorMode(mode)
  listeners.forEach((fn) => fn(mode))
}

export function subscribeEditorMode(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
