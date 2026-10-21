/*
 * 笔记的保存策略。
 *
 * 与「云同步策略」分开：这里只管「编辑的内容什么时候写进本机磁盘」——
 * 那是每一次敲键盘都会碰到的事，频率直接决定卡顿感与磁盘寿命；
 * 云同步那边管「要不要推到 Cloudflare」，见 cloudflareSync.ts。
 */

export interface NotesSaveSettings {
  /** 停止编辑后自动落盘。关掉后只在切文档 / 隐藏窗口 / 退出 / ⌘S 时写 */
  autoSaveEnabled: boolean
  /** 自动落盘的防抖时长（毫秒）。停止编辑这么久才真正写一次，期间继续打字则顺延 */
  autoSaveDelayMs: number
}

export const NOTES_SAVE_STORAGE_KEY = 'fehelper-notes-save-settings'

export const DEFAULT_NOTES_SAVE: NotesSaveSettings = {
  /*
   * 默认关。
   *
   * 边写边落盘会让「改一个小东西」也触发整份状态重写，与云同步的自动拉取
   * 叠在一起时还会把正文整篇换掉、格式全乱（见 NotesContext 的注释）。
   * 需要自动保存的用户在「设置 → 通用」里打开，并自己选间隔。
   */
  autoSaveEnabled: false,
  autoSaveDelayMs: 1500,
}

/** 间隔档位。给设置面板的下拉用 */
export const AUTO_SAVE_DELAY_OPTIONS: { value: number; label: string }[] = [
  { value: 500, label: '0.5 秒' },
  { value: 1000, label: '1 秒' },
  { value: 1500, label: '1.5 秒' },
  { value: 3000, label: '3 秒' },
  { value: 5000, label: '5 秒' },
  { value: 10000, label: '10 秒' },
  { value: 30000, label: '30 秒' },
]

/** 夹到合法区间：存到脏值（0、负数、NaN）时不能退化成「每次输入都写盘」 */
export function clampAutoSaveDelay(ms: unknown): number {
  const value = typeof ms === 'number' && Number.isFinite(ms) ? Math.round(ms) : DEFAULT_NOTES_SAVE.autoSaveDelayMs
  return Math.min(30000, Math.max(500, value))
}

export function mergeNotesSave(partial?: Partial<NotesSaveSettings> | null): NotesSaveSettings {
  return {
    autoSaveEnabled: partial?.autoSaveEnabled ?? DEFAULT_NOTES_SAVE.autoSaveEnabled,
    autoSaveDelayMs: clampAutoSaveDelay(partial?.autoSaveDelayMs),
  }
}

export async function loadNotesSaveSettings(): Promise<NotesSaveSettings> {
  try {
    let raw: unknown = null
    if (window.electronAPI?.storeGet) {
      raw = await window.electronAPI.storeGet(NOTES_SAVE_STORAGE_KEY)
    }
    if (raw == null) {
      const local = localStorage.getItem(NOTES_SAVE_STORAGE_KEY)
      if (local) raw = JSON.parse(local)
    }
    return mergeNotesSave(raw as Partial<NotesSaveSettings> | null)
  } catch {
    return mergeNotesSave()
  }
}

export async function saveNotesSaveSettings(settings: NotesSaveSettings): Promise<void> {
  const payload = mergeNotesSave(settings)
  try {
    if (window.electronAPI?.storeSet) {
      await window.electronAPI.storeSet(NOTES_SAVE_STORAGE_KEY, payload)
    }
  } catch {
    // fallback below
  }

  try {
    localStorage.setItem(NOTES_SAVE_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota errors
  }
}
