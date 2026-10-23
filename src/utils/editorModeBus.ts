import { persistEditorMode, readEditorMode, type EditorMode } from '../components/tools/EditorModeSwitch'

type Listener = (mode: EditorMode) => void
const listeners = new Set<Listener>()

let currentMode: EditorMode = readEditorMode()

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
