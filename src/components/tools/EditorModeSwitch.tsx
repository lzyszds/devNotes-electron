import type { ComponentType } from 'react'
import { Columns2, PenLine, Type } from 'lucide-react'

/** cherry = 双栏源码+预览(旧行为,默认) / ir = 即时渲染(类 Typora) / wysiwyg = 富文本(类 Word) */
const MODES = ['cherry', 'ir', 'wysiwyg'] as const
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
    hint: 'Cherry 双栏:左侧源码、右侧预览',
    icon: Columns2,
  },
  {
    key: 'ir',
    label: '即时渲染',
    hint: '类 Typora:光标所在行显示 Markdown 标记,离开即渲染成标题、列表',
    icon: PenLine,
  },
  {
    key: 'wysiwyg',
    label: '富文本',
    hint: '类 Word:任何时刻都不显示 Markdown 标记',
    icon: Type,
  },
]

/** 读取上次选择的模式;值非法(旧版本残留、手改过 localStorage)时回退到双栏 */
export function readEditorMode(): EditorMode {
  const saved = localStorage.getItem(STORAGE_KEY)
  return MODES.find((mode) => mode === saved) ?? 'cherry'
}

export function persistEditorMode(mode: EditorMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
}

type EditorModeSwitchProps = {
  value: EditorMode
  onChange: (mode: EditorMode) => void
}

export default function EditorModeSwitch({ value, onChange }: EditorModeSwitchProps) {
  return (
    <div className="flex items-center bg-slate-100 dark:bg-dark-hover p-0.5 rounded-lg border border-slate-200/50 dark:border-dark-border text-[11px]">
      {MODE_ITEMS.map((item) => {
        const active = item.key === value
        const Icon = item.icon
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            title={item.hint}
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
        )
      })}
    </div>
  )
}
