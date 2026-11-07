import type { ComponentType } from 'react'
import { Columns2, Eye, SquarePen } from 'lucide-react'
import Tooltip from '../../ui/Tooltip'
import { useUiPrefsStore } from '../../../store/uiPrefsStore'

/** 只对 Cherry 有效：所见即所得是无条件单栏内核，塞不进双栏 */
export type EditorViewMode = 'edit' | 'split' | 'preview'

const MODES: EditorViewMode[] = ['edit', 'split', 'preview']

const VIEW_ITEMS: {
  key: EditorViewMode
  label: string
  hint: string
  icon: ComponentType<{ className?: string }>
}[] = [
  { key: 'edit', label: '纯编辑', hint: '只显示源码编辑区', icon: SquarePen },
  { key: 'split', label: '双栏', hint: '左侧源码、右侧预览，中缝可拖拽调整比例', icon: Columns2 },
  { key: 'preview', label: '纯预览', hint: '只显示渲染结果', icon: Eye },
]

export function readViewMode(): EditorViewMode {
  const saved = useUiPrefsStore.getState().editorView
  return MODES.find((mode) => mode === saved) ?? 'split'
}

export function persistViewMode(mode: EditorViewMode): void {
  useUiPrefsStore.getState().setEditorView(mode)
}

export const VIEW_MODE_LABEL: Record<EditorViewMode, string> = {
  edit: '纯编辑',
  split: '双栏',
  preview: '纯预览',
}

type ViewModeSwitchProps = {
  value: EditorViewMode
  onChange: (mode: EditorViewMode) => void
}

export default function ViewModeSwitch({ value, onChange }: ViewModeSwitchProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-slate-200/70 bg-slate-100/80 p-0.5  ">
      {VIEW_ITEMS.map((item) => {
        const active = item.key === value
        const Icon = item.icon
        return (
          <Tooltip key={item.key} content={item.hint}>
            <button
              type="button"
              onClick={() => onChange(item.key)}
              aria-pressed={active}
              data-view-mode={item.key}
              className={`flex items-center justify-center rounded-md p-1 transition-colors ${
                active
                  ? 'bg-white text-slate-900 shadow-2xs  '
                  : 'text-slate-400 hover:text-slate-700  '
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
