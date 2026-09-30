import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  Globe,
  MonitorSmartphone,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'
import { useShortcutSettings } from '../../hooks/useShortcutSettings'
import { useToast } from '../ui/Toast'
import ShortcutGuideModal, { type ShortcutItem } from '../ui/ShortcutGuideModal'
import {
  SHORTCUT_BINDINGS,
  defaultShortcutMap,
  eventToAccelerator,
  findConflicts,
  formatAccelerator,
  isModifierKey,
  setRecordingShortcut,
  saveShortcutMap,
  type ShortcutBinding,
  type ShortcutMap,
} from '../../utils/shortcutSettings'

/**
 * 快捷键行内的图标按钮样式。
 *
 * 固定 32×32 且禁用时只降透明度、不隐藏 —— 按钮一消失，同行其余按钮
 * 就会横向挪位，鼠标下的目标会跑掉。
 */
/**
 * 键位框 / 录制框共用的宽度。
 *
 * 两态必须严格同宽：录制框若宽出一截，行内靠右的几个按钮会被顶开，
 * 退出录制又弹回来 —— 用户正在操作的按钮会在指针底下跑掉。
 */
const ROW_FIELD_WIDTH = 'w-[132px]'

const ROW_ICON_BTN =
  'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-dark-hover dark:hover:text-slate-200 transition-colors disabled:opacity-30 disabled:pointer-events-none'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)


/**
 * accelerator -> 演示用的按键数据。
 *
 * 引导动画支持的是 ⌘ / ⌥ / ⇧ / Ctrl 这几个修饰键的图示，而用户录进去的
 * 键位可能是 Alt+Shift+F 这种写法。这里做一次映射，认不出的（比如功能键
 * 组合里的 F5）就原样带上，动画里会当成普通字符展示。
 */
function demoItemFor(binding: ShortcutBinding): ShortcutItem {
  const accelerator = binding.defaultAccelerator
  const parts = accelerator.split('+')
  const display = parts
    .map((part) => {
      switch (part) {
        case 'Command':
        case 'CommandOrControl':
          return '⌘'
        case 'Control':
          return '⌃'
        case 'Alt':
          return '⌥'
        case 'Shift':
          return '⇧'
        case 'Return':
          return '↵'
        case 'Space':
          return '空格'
        default:
          return part
      }
    })
    .filter(Boolean)

  return {
    id: binding.id,
    keys: display.join(' '),
    keyParts: display,
    label: binding.label,
    description: binding.description,
    category: binding.scope === 'global' ? '全局快捷键' : '应用内快捷键',
    icon: binding.scope === 'global' ? Globe : MonitorSmartphone,
  }
}

/**
 * 快捷键设置。
 *
 * 全局键与应用内键分两组显示：前者即使应用没聚焦也生效、会跟系统和其他
 * 应用抢；后者只在窗口聚焦时生效。混在一起用户没法判断某个键为什么没反应。
 */
export default function ShortcutSettingsPanel() {
  const saved = useShortcutSettings()
  const [draft, setDraft] = useState<ShortcutMap>(saved)
  /** 正在录制的绑定 id，null 表示没在录 */
  const [recording, setRecording] = useState<string | null>(null)
  /** 注册失败的 id（键位被系统或其他应用占用） */
  const [failed, setFailed] = useState<string[]>([])
  const { showToast } = useToast()
  /** 速查表里点开的条目，非空时弹出按键引导动画 */
  const [activeShortcut, setActiveShortcut] = useState<ShortcutItem | null>(null)


  // 外部改了配置（比如另一处重置）时同步草稿
  useEffect(() => {
    setDraft(saved)
  }, [saved])

  const conflicts = useMemo(() => findConflicts(draft), [draft])
  const dirty = useMemo(
    () => SHORTCUT_BINDINGS.some((b) => draft[b.id] !== saved[b.id]),
    [draft, saved],
  )

  const globalBindings = SHORTCUT_BINDINGS.filter((b) => b.scope === 'global')
  const appBindings = SHORTCUT_BINDINGS.filter((b) => b.scope === 'app')

  const startRecording = (id: string) => {
    setRecording(id)
    setFailed([])
  }

  const cancelRecording = () => setRecording(null)

  /** 清空某条绑定（用户不想要这个快捷键了） */
  const clearBinding = (id: string) => {
    setDraft((prev) => ({ ...prev, [id]: '' }))
    setFailed((prev) => prev.filter((f) => f !== id))
  }

  const resetAll = () => {
    setDraft(defaultShortcutMap())
    setFailed([])
    showToast('已恢复默认键位，记得保存')
  }

  const resetOne = (binding: ShortcutBinding) => {
    setDraft((prev) => ({ ...prev, [binding.id]: binding.defaultAccelerator }))
    setFailed((prev) => prev.filter((f) => f !== binding.id))
  }

  const apply = async () => {
    const result = await saveShortcutMap(draft)
    setFailed(result.failed)
    if (result.failed.length) {
      // 不能静默成功：键位被别的应用占着，用户会以为设上了
      showToast(`${result.failed.length} 个快捷键被系统或其他应用占用`, 'error')
    } else {
      showToast('快捷键已生效')
    }
  }

  const renderRow = (binding: ShortcutBinding) => {
    const accelerator = draft[binding.id] ?? ''
    const isRecording = recording === binding.id
    const hasFailed = failed.includes(binding.id)
    const conflictIds = conflicts.get(accelerator) ?? []
    const hasConflict = Boolean(accelerator) && conflictIds.length > 1

    return (
      <div
        key={binding.id}
        className="flex items-center gap-4 py-3 border-b border-slate-200/60 dark:border-dark-border last:border-b-0"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
              {binding.label}
            </span>
            {hasFailed && (
              <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
                <AlertCircle size={12} />
                被占用
              </span>
            )}
            {hasConflict && !hasFailed && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertCircle size={12} />
                与同组其他快捷键重复
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            {binding.description}
          </p>
        </div>

        {/*
          动作区。
          三个按钮一律常驻、宽高写死：清空键位时按钮若跟着消失，整行的
          内容宽度会变，右侧几个图标会横向挪位；录制框与键位框高度也不一样，
          切换时行高会跳。都占住位置，只改 disabled / 透明度，布局就不动。
        */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 键位框固定宽度，内容长短不一（⌘K / ⌥⇧N）时右侧按钮不会跟着挪。
              宽度与 RecordingField 共用同一个常量，两态必须严格同宽 */}
          <span className={`inline-flex ${ROW_FIELD_WIDTH} shrink-0`}>
            {isRecording ? (
              <RecordingField
                currentAccelerator={accelerator}
                onCapture={(next) => {
                  setDraft((prev) => ({ ...prev, [binding.id]: next }))
                  setRecording(null)
                  setFailed((prev) => prev.filter((f) => f !== binding.id))
                }}
                onCancel={cancelRecording}
              />
            ) : (
              <button
                type="button"
                onClick={() => startRecording(binding.id)}
                className={`w-full h-8 px-3 rounded-lg border text-xs font-semibold transition-colors tabular-nums truncate ${
                  accelerator
                    ? 'border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel text-slate-700 dark:text-slate-200 hover:border-brand-300 hover:text-brand-600 dark:hover:text-brand-400'
                    : 'border-dashed border-slate-300 dark:border-dark-border text-slate-400 dark:text-slate-500 hover:border-brand-300 hover:text-brand-500'
                }`}
              >
                {accelerator ? formatAccelerator(accelerator, isMac) : '未设置'}
              </button>
            )}
          </span>

          <button
            type="button"
            onClick={() => clearBinding(binding.id)}
            // 没设置键位时按钮仍在，只是不可点 —— 见上方关于「不要跳动」的说明
            disabled={!accelerator || isRecording}
            title="清空这个快捷键"
            className={ROW_ICON_BTN}
          >
            <X size={14} />
          </button>
          <button
            type="button"
            onClick={() => resetOne(binding)}
            disabled={isRecording}
            title="恢复这一条的默认键位"
            className={ROW_ICON_BTN}
          >
            <RotateCcw size={14} />
          </button>

          {/* 演示放最右：它只是「看一眼」的次要动作，不该挤在键位框前面
              抢走主操作（录制 / 清空 / 恢复）的位置 */}
          <button
            type="button"
            onClick={() => setActiveShortcut(demoItemFor(binding))}
            title="播放按键演示动画"
            className={ROW_ICON_BTN}
          >
            <Play size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          点键位框后直接按下想要的组合。<span className="font-semibold">全局</span>
          键在应用没聚焦时也生效；<span className="font-semibold">应用内</span>
          键只在 devNotes 窗口里生效。
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[10px] border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors"
          >
            <RotateCcw size={13} />
            全部恢复默认
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={!dirty}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-brand-600 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Check size={13} />
            保存并生效
          </button>
        </div>
      </div>

      <section>
        <div className="flex items-center gap-2 mb-1">
          <Globe size={13} className="text-brand-500" />
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            全局快捷键
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            在其他应用里也能唤起 devNotes
          </span>
        </div>
        <div>{globalBindings.map(renderRow)}</div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-1">
          <MonitorSmartphone size={13} className="text-brand-500" />
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            应用内快捷键
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            仅窗口聚焦时生效
          </span>
        </div>
        <div>{appBindings.map(renderRow)}</div>
      </section>

      {/* 按键引导动画：点某行右侧的「演示」时弹出来，把这套键位敲一遍 */}
      <ShortcutGuideModal
        shortcut={activeShortcut}
        onClose={() => setActiveShortcut(null)}
        onTriggerAction={() => {
          /*
           * 只演示、不执行。
           *
           * 原先挂在「通用」面板下时能顺手改主题、恢复侧栏宽度；搬到快捷键页后
           * 这些回调不在手边。何况用户点「演示」只是想看看这组键长什么样，
           * 顺手把主题改了会很意外。
           */
        }}
      />
    </div>
  )
}

/**
 * 录制中的键位框。
 *
 * 用 window 的 keydown 捕获而不是给这个元素挂 onKeyDown：录制期间用户可能
 * 点过别处，但只要还在录制就该收到按键。capture 阶段拦下并 preventDefault，
 * 免得按 ⌘K 时把命令面板真给呼出来了。
 */
function RecordingField({
  currentAccelerator,
  onCapture,
  onCancel,
}: {
  currentAccelerator: string
  onCapture: (accelerator: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLSpanElement>(null)
  /** 录不进来的原因。静默忽略会让用户以为是自己没按对 */
  const [hint, setHint] = useState('')
  /** 已按下的修饰键，如 '⌘⇧'，让用户看到录制在进行中 */
  const [live, setLive] = useState('')
  /** 完整事件诊断，挂在 title 上备用（修饰键识别异常时排查用） */
  const [diagnostic, setDiagnostic] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        onCancel()
        return
      }

      // 框里只显示「已经按下的修饰键」，让用户看到录制在进行中。
      // 完整的事件诊断（key/code/flags）只在看不出来时才有意义，
      // 常驻显示会让框里内容一直变，所以挪去 title 里备用
      const held = [
        event.metaKey && '⌘',
        event.ctrlKey && '⌃',
        event.altKey && '⌥',
        event.shiftKey && '⇧',
      ].filter(Boolean).join('')
      setLive(held || '')
      setDiagnostic(`flags=${[
        event.metaKey && 'meta',
        event.ctrlKey && 'ctrl',
        event.altKey && 'alt',
        event.shiftKey && 'shift',
      ].filter(Boolean).join('+') || 'none'} key=${event.key} code=${event.code}`)

      const accelerator = eventToAccelerator(event)
      if (!accelerator) {
        // 单个修饰键是正常的中间状态，不提示；其余情况说明这个键认不出来
        if (!isModifierKey(event.key)) setHint('这个键不支持，换一个试试')
        return
      }
      // 没有修饰键的组合会跟普通打字冲突，必须带一个
      if (!/Command|Control|Alt|Shift/.test(accelerator)) {
        setHint('需要带上 ⌘ / Ctrl / ⌥ / ⇧ 这类修饰键')
        return
      }
      setHint('')
      onCapture(accelerator)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel, onCapture])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  /**
   * 录制期间关掉所有快捷键。
   *
   * 放在 effect 里而不是 startRecording 里：取消、保存、组件卸载（比如切到
   * 别的设置分类）都要恢复，统一挂在生命周期上不会漏掉某条退出路径。
   */
  useEffect(() => {
    setRecordingShortcut(true)
    return () => setRecordingShortcut(false)
  }, [])

  /*
   * 尺寸写死，且宽度与行内键位框完全一致（见 ROW_FIELD_WIDTH）。
   *
   * 早先这里用 w-[132px]，而键位框那格只有 104px —— 录制时这一格突然变宽，
   * 把右侧的清空/重置按钮顶出去，两个按钮叠在一起糊成一团。
   * 现在两者同宽，进入与退出录制都不会让任何元素横向移动。
   *
   * 「原 ⌥⇧N」的提示也不再挂在框外：那会额外占宽。改成把原键位塞进 title，
   * 鼠标悬停就能看到，不再影响布局。
   */
  return (
    <span
      ref={ref}
      tabIndex={-1}
      title={
        hint ||
        diagnostic ||
        (currentAccelerator
          ? `按下想用的组合键，Esc 取消；当前为 ${formatAccelerator(currentAccelerator, isMac)}`
          : '按下想用的组合键，Esc 取消')
      }
      className={`inline-flex items-center justify-center w-full h-8 rounded-lg border text-xs font-semibold outline-none ${
        hint
          ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-brand-400 bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400'
      }`}
    >
      <span className="truncate px-2">{hint || live || '按下组合键…'}</span>
    </span>
  )
}
