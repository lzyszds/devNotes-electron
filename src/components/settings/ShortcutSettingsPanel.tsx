import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Globe, MonitorSmartphone, RotateCcw, X } from 'lucide-react'
import { useShortcutSettings } from '../../hooks/useShortcutSettings'
import { useToast } from '../ui/Toast'
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

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

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

        <div className="flex items-center gap-1.5 shrink-0">
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
              className={`min-w-[104px] h-8 px-3 rounded-lg border text-xs font-semibold transition-colors tabular-nums ${
                accelerator
                  ? 'border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel text-slate-700 dark:text-slate-200 hover:border-brand-300 hover:text-brand-600 dark:hover:text-brand-400'
                  : 'border-dashed border-slate-300 dark:border-dark-border text-slate-400 dark:text-slate-500 hover:border-brand-300 hover:text-brand-500'
              }`}
            >
              {accelerator ? formatAccelerator(accelerator, isMac) : '未设置'}
            </button>
          )}

          {accelerator && !isRecording && (
            <button
              type="button"
              onClick={() => clearBinding(binding.id)}
              title="清空这个快捷键"
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-dark-hover dark:hover:text-slate-200 transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => resetOne(binding)}
            title="恢复这一条的默认键位"
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-dark-hover dark:hover:text-slate-200 transition-colors"
          >
            <RotateCcw size={14} />
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
   * 框的尺寸写死，且诊断信息一律放到框**外**。
   *
   * 早先把 key=xxx 那行放进框里，内容随按键变化、框宽跟着伸缩，右侧的
   * 清空/重置按钮被推得左右横跳 —— 录制时布局一直在动，很难对准。
   * 固定宽度后，整个条目在录制期间不会有任何位移。
   */
  return (
    <span className="inline-flex items-center gap-2">
      <span
        ref={ref}
        tabIndex={-1}
        title={hint || diagnostic || '按下想用的组合键，Esc 取消'}
        className={`inline-flex items-center justify-center w-[132px] h-8 rounded-lg border text-xs font-semibold outline-none ${
          hint
            ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400'
            : 'border-brand-400 bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400'
        }`}
      >
        <span className="truncate px-2">{hint || live || '按下组合键…'}</span>
      </span>
      {currentAccelerator && (
        <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
          原 {formatAccelerator(currentAccelerator, isMac)}
        </span>
      )}
    </span>
  )
}
