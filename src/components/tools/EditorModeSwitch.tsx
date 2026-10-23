import type { ComponentType } from 'react'
import { Columns2, PenLine } from 'lucide-react'
import Tooltip from '../ui/Tooltip'

/** cherry = 双栏源码+预览 / milkdown = 所见即所得(类 Typora,基于 Milkdown,默认) */
const MODES = ['cherry', 'milkdown'] as const
export type EditorMode = (typeof MODES)[number]

const STORAGE_KEY = 'fehelper-editor-mode'

const MODE_ITEMS: {
  key: EditorMode
  label: string
  hint: string
  icon: ComponentType<{ className?: string }>
}[] = [
  {
    key: 'cherry',
    label: '双栏',
    hint: 'Cherry 双栏:左侧源码、右侧预览,支持 ::: 面板/时间线等专有语法',
    icon: Columns2,
  },
  {
    key: 'milkdown',
    label: '所见即所得',
    hint: '类 Typora:直接排版,不显示 Markdown 标记。不支持 Cherry 的 ::: 专有语法',
    icon: PenLine,
  },
]

/**
 * 读取上次选择的模式。
 * 没选过时默认所见即所得(直接排版,对新手最省事)。
 * 值非法时也走同一个默认值 —— 这同时兜住了老版本存下的 'ir' / 'wysiwyg'
 * (Vditor 时代的两个模式已被替换成 Milkdown 的所见即所得)。
 */
export function readEditorMode(): EditorMode {
  const saved = localStorage.getItem(STORAGE_KEY)
  return MODES.find((mode) => mode === saved) ?? 'milkdown'
}

export function persistEditorMode(mode: EditorMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
}

type EditorModeSwitchProps = {
  value: EditorMode
  onChange: (mode: EditorMode) => void
  /**
   * 紧凑模式：只留图标，不带文字。
   *
   * 摆在编辑器工具栏上时用这个 —— 工具栏横向空间紧张，而右端紧挨着 Cherry
   * 自己的视图三态（也有一个「双栏」图标），两处都写「双栏」更容易看混。
   */
  compact?: boolean
}

export default function EditorModeSwitch({
  value,
  onChange,
  compact = false,
}: EditorModeSwitchProps) {
  if (compact) {
    return (
      <div className="flex items-center rounded-lg border border-slate-200/70 bg-slate-100/80 p-0.5 dark:border-dark-border dark:bg-dark-hover">
        {MODE_ITEMS.map((item) => {
          const active = item.key === value
          const Icon = item.icon
          return (
            <Tooltip key={item.key} content={`${item.label}：${item.hint}`}>
              <button
                type="button"
                onClick={() => onChange(item.key)}
                aria-pressed={active}
                aria-label={item.label}
                data-editor-mode={item.key}
                className={`flex items-center justify-center rounded-md p-1 transition-colors ${
                  active
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-dark-panel dark:text-white'
                    : 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-dark-hover dark:hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex items-center bg-slate-100 dark:bg-dark-hover p-0.5 rounded-lg border border-slate-200/50 dark:border-dark-border text-[11px]">
      {MODE_ITEMS.map((item) => {
        const active = item.key === value
        const Icon = item.icon
        return (
          <Tooltip key={item.key} content={item.hint}>
            <button
              type="button"
              onClick={() => onChange(item.key)}
              aria-pressed={active}
              data-editor-mode={item.key}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-all ${
                active
                  ? 'bg-white dark:bg-dark-panel shadow-2xs font-semibold text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3 h-3" />
              <span>{item.label}</span>
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
