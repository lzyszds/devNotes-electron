import { useCallback, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { Editor } from '@milkdown/kit/core'
import type { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  Baseline,
  Bold,
  Code,
  Eraser,
  Highlighter,
  Italic,
  Loader2,
  PaintBucket,
  Palette,
  Sparkles,
  Strikethrough,
  Subscript,
  Superscript,
  TextQuote,
  Underline,
} from 'lucide-react'
import {
  NOTE_AI_ACTIONS,
  runNoteAiStream,
  type NoteAiAction,
  type NoteAiActionId,
} from '../../../utils/noteAi'
import {
  failAiReview,
  finishAiReview,
  startAiReview,
  updateAiReviewStream,
} from '../../../utils/aiReview'
import { useToast } from '../../ui/Toast'
import { FloatingBarButton, FloatingBarDivider, FloatingBarShell, useFloatingBar } from './FloatingBar'
import { BACKGROUND_COLORS, FONT_SIZES, TEXT_COLORS } from './inlinePalette'
import {
  runMilkdownCommand,
  setInlineBackgroundColor,
  setInlineFontSize,
  setInlineTextColor,
  toggleHighlight,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
  type SelectionSnapshot,
} from './milkdownCommands'

export type SelectionToolbarProps = {
  editor: Editor | null
  /** 由编辑器组件持有，闭包进驱动插件；见 milkdownFloatingBar.ts */
  providerRef: MutableRefObject<TooltipProvider | null>
  /**
   * 「清除格式」。实现在适配器上（与格式菜单、右键菜单共用同一份），
   * 这里不重复一份，由宿主透传下来。
   */
  onClearFormat: () => void
  /** 取出当前选中的纯文本，供 AI 改写使用 */
  getSelectedText: () => string
  /** 选区前的上下文，续写时用来理解「接着什么写」 */
  getContextBefore: () => string
  /** 记下选区位置，用户确认插入后再恢复，避免等待期间改动导致写错位置 */
  snapshotSelection: () => SelectionSnapshot | null
  /** 当前笔记 id，结果只对这篇笔记有效 */
  getNoteId: () => string
}

/** 选中了「有内容的」文字才浮出来 */
function hasTextSelection(view: EditorView): boolean {
  const { selection } = view.state
  if (!view.editable || !view.hasFocus()) return false
  if (selection.empty) return false
  // 拖选经过空行时整段可能只有空白字符，这种情况弹出来没意义
  return view.state.doc.textBetween(selection.from, selection.to).trim().length > 0
}

/** 一排色块。文字色与背景色共用，只是取值与回调不同 */
function SwatchGrid({
  colors,
  onPick,
}: {
  colors: readonly string[]
  onPick: (color: string) => void
}) {
  return (
    // 拦住 mousedown，否则点色块会让编辑区失焦、选区随即消失
    <div
      onMouseDown={(event) => event.preventDefault()}
      className="mb-1 grid grid-cols-8 gap-1 rounded-lg border border-slate-200/80 bg-white p-1.5 shadow-lg dark:border-dark-border dark:bg-dark-panel"
    >
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          title={color}
          onClick={() => onPick(color)}
          style={{ backgroundColor: color }}
          className="h-4 w-4 rounded border border-black/10 transition-transform hover:scale-110 dark:border-white/20"
        />
      ))}
    </div>
  )
}

/**
 * 选中文字后浮出的格式菜单。
 *
 * 按钮清单源自 `CherryMarkdownEditor` 里 `toolbars.bubble` 的配置：
 *   bold / italic / underline / strikethrough / sub / sup / quote | size / color
 * 在此之上补了三件主工具栏有、气泡里却缺的行内文本工具：
 *   inline-code / highlight / clear-format
 * （背景色是 Cherry 的 `color` 菜单里「文字颜色 / 背景色」两个页签之一，
 * 这里拆成独立一颗按钮，比 Cherry 少一次点击。）
 *
 * 注意：补的这三件只有 Milkdown 侧有 —— Cherry 的 bubble 菜单清单里没有对应项，
 * 那边的气泡保持原样，两个内核的气泡不再逐项对齐。
 *
 * 命令执行完**不主动隐藏**：加粗之后通常还要接着点斜体，Cherry 的 bubble 也是这个行为。
 * 真正让浮条消失的是选区塌陷（点一下空白处），那时插件自然会问出 false。
 */
export default function SelectionToolbar({
  editor,
  providerRef,
  onClearFormat,
  getSelectedText,
  getContextBefore,
  snapshotSelection,
  getNoteId,
}: SelectionToolbarProps) {
  // null = 不展开；其余 = 展开对应的小面板
  const [panel, setPanel] = useState<'size' | 'color' | 'bg' | 'ai' | null>(null)
  const { showToast } = useToast()
  /** 正在跑的 AI 动作，用来在按钮上转圈并锁住重复点击 */
  const [aiRunning, setAiRunning] = useState<string | null>(null)
  /** 自定义指令 / 目标语言的输入 */
  const [aiInput, setAiInput] = useState('')
  /** 当前展开输入框的动作 id，null 表示没有展开 */
  const [aiInputFor, setAiInputFor] = useState<NoteAiActionId | null>(null)

  const { renderPortal } = useFloatingBar(editor, providerRef, {
    /*
      宿主容器由 Provider 搬到 document.body 下并按 floating-ui 算出的坐标写内联
      left/top，显隐靠 data-show。元素本身由 hook 建、不进 React 树（理由见 FloatingBar.tsx），
      类名所以在 index.css 里是**全局**的 —— 搬到 body 后编辑区作用域选择器就匹配不上了。
    */
    hostClassName: 'fehelper-floating-bar',
    shouldShow: hasTextSelection,
    /*
     * Cherry 的 bubble 是「居中压在选区上方」的，不是左对齐。
     *
     * AI 面板例外：它比浮条高得多，而 flip() 只看浮条本体的高度就把浮条留在
     * 选区上方，面板再往上一长就顶出窗口。展开 AI 时改成下方定位，让它朝下生长。
     */
    placement: panel === 'ai' ? 'bottom' : 'top',
    // 展开的面板会改变浮层高度，变了就重算位置（夹取视口依赖实际高度）
    repositionKey: panel,
    // 浮条一收起来就把小面板复位，免得下次浮出来还挂着一个开着的面板
    onVisibilityChange: (visible) => {
      if (!visible) {
        setPanel(null)
        setAiInputFor(null)
      }
    },
  })

  const pickSize = useCallback(
    (px: number) => {
      setInlineFontSize(editor, px)
      setPanel(null)
    },
    [editor]
  )

  const pickColor = useCallback(
    (color: string) => {
      setInlineTextColor(editor, color)
      setPanel(null)
    },
    [editor]
  )

  const pickBackground = useCallback(
    (color: string) => {
      setInlineBackgroundColor(editor, color)
      setPanel(null)
    },
    [editor]
  )

  /**
   * 跑一个 AI 动作。
   *
   * 点下动作的瞬间就把浮层收掉、把进度交给右侧栏 —— 浮层是用来做即时操作的，
   * 让它在正文上方挂着一个转圈等好几秒，既挡视线又看不出进展。
   * 结果**不直接写进文档**，只进确认栏，由用户看过对比后再决定插不插入。
   */
  const runAi = useCallback(
    async (action: NoteAiAction, extra = '') => {
      if (aiRunning) return
      const text = getSelectedText()
      if (!text.trim()) {
        showToast('请先选中要处理的文字')
        return
      }

      // 先记下选区，用户确认插入时还要定位回去
      const snapshot = snapshotSelection()

      // 立刻收起浮层，进度交给侧栏
      setPanel(null)
      setAiInput('')
      setAiInputFor(null)
      setAiRunning(action.id)

      const task = startAiReview({
        original: text,
        actionId: action.id,
        actionLabel: action.label,
        mode: action.mode,
        noteId: getNoteId(),
        snapshot,
      })

      try {
        const result = await runNoteAiStream({
          action,
          text,
          extra,
          contextBefore: getContextBefore(),
          // 边生成边推给侧栏；取消后不再刷
          onDelta: (streamed) => {
            if (!task.cancelled) updateAiReviewStream(task, streamed)
          },
        })

        // 用户中途点了取消：结果直接丢弃，不覆盖任何状态
        if (task.cancelled) return

        if (!result.ok) {
          failAiReview(task)
          showToast(result.error || 'AI 处理失败', 'error')
          return
        }
        if (!result.text.trim()) {
          failAiReview(task)
          showToast('AI 没有返回内容', 'error')
          return
        }
        finishAiReview(task, result.text, result.elapsedMs)
      } finally {
        setAiRunning(null)
      }
    },
    [aiRunning, getSelectedText, getContextBefore, snapshotSelection, getNoteId, showToast]
  )

  return (
    <>
      {renderPortal(
        /*
         * 面板相对浮条的方向跟着浮条的定位走：
         *  - 浮条在上方（默认）：面板朝上生长（col-reverse + mb-*），不挡正文
         *  - 浮条改到下方（AI 面板）：面板改回朝下生长（col + mt-*），避免顶出窗口
         */
        <div
          className={`flex items-center ${
            panel === 'ai' ? 'flex-col' : 'flex-col-reverse'
          }`}
        >
          <FloatingBarShell>
            <FloatingBarButton
              icon={Bold}
              label="加粗"
              onClick={() => runMilkdownCommand(editor, 'bold')}
            />
            <FloatingBarButton
              icon={Italic}
              label="斜体"
              onClick={() => runMilkdownCommand(editor, 'italic')}
            />
            <FloatingBarButton
              icon={Underline}
              label="下划线"
              onClick={() => toggleUnderline(editor)}
            />
            <FloatingBarButton
              icon={Strikethrough}
              label="删除线"
              onClick={() => runMilkdownCommand(editor, 'strike')}
            />
            <FloatingBarButton
              icon={Code}
              label="行内代码"
              onClick={() => runMilkdownCommand(editor, 'inline-code')}
            />
            <FloatingBarButton
              icon={Subscript}
              label="下标"
              onClick={() => toggleSubscript(editor)}
            />
            <FloatingBarButton
              icon={Superscript}
              label="上标"
              onClick={() => toggleSuperscript(editor)}
            />
            <FloatingBarButton
              icon={TextQuote}
              label="引用"
              onClick={() => runMilkdownCommand(editor, 'quote')}
            />
            <FloatingBarButton
              icon={Highlighter}
              label="高亮"
              onClick={() => toggleHighlight(editor)}
            />
            <FloatingBarButton icon={Eraser} label="清除格式" onClick={onClearFormat} />

            <FloatingBarDivider />

            {/* AI 改写：放在格式按钮之后、字号颜色之前 —— 属于「改内容」而不是「改样式」 */}
            <FloatingBarButton
              icon={aiRunning ? Loader2 : Sparkles}
              label={aiRunning ? 'AI 处理中…' : 'AI 改写'}
              active={panel === 'ai' || !!aiRunning}
              spinning={!!aiRunning}
              onClick={() => {
                setAiInput('')
                setPanel((prev) => (prev === 'ai' ? null : 'ai'))
              }}
            />

            <FloatingBarDivider />

            <FloatingBarButton
              icon={Baseline}
              label="字号"
              active={panel === 'size'}
              onClick={() => setPanel((prev) => (prev === 'size' ? null : 'size'))}
            />
            <FloatingBarButton
              icon={Palette}
              label="字体颜色"
              active={panel === 'color'}
              onClick={() => setPanel((prev) => (prev === 'color' ? null : 'color'))}
            />
            <FloatingBarButton
              icon={PaintBucket}
              label="背景色"
              active={panel === 'bg'}
              onClick={() => setPanel((prev) => (prev === 'bg' ? null : 'bg'))}
            />
          </FloatingBarShell>

          {/* 小面板挂在浮条上方（外层是 col-reverse）。同样要拦住 mousedown，
              否则编辑区一失焦选区就没了 */}
          {panel === 'size' && (
            <div
              onMouseDown={(event) => event.preventDefault()}
              className="mb-1 flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-white px-1 py-0.5 shadow-lg dark:border-dark-border dark:bg-dark-panel"
            >
              {FONT_SIZES.map((item) => (
                <button
                  key={item.px}
                  type="button"
                  title={`${item.label}（${item.px}px）`}
                  onClick={() => pickSize(item.px)}
                  className="rounded-md px-2 py-1 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-dark-hover dark:hover:text-white"
                >
                  <span style={{ fontSize: `${Math.round(item.px * 0.7)}px` }}>{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {panel === 'color' && <SwatchGrid colors={TEXT_COLORS} onPick={pickColor} />}
          {panel === 'bg' && <SwatchGrid colors={BACKGROUND_COLORS} onPick={pickBackground} />}

          {panel === 'ai' && (
            <div
              onMouseDown={(event) => event.preventDefault()}
              // 方向随浮条变（见上），间距的 mb/mt 也跟着换；限高防止长内容撑出窗口
              className={`${
                panel === 'ai' ? 'mt-1' : 'mb-1'
              } max-h-[min(60vh,320px)] w-[260px] overflow-y-auto rounded-lg border border-slate-200/80 bg-white p-1 shadow-lg dark:border-dark-border dark:bg-dark-panel`}
            >
              {NOTE_AI_ACTIONS.map((action) => {
                const busy = aiRunning === action.id
                return (
                  <div key={action.id}>
                    <button
                      type="button"
                      disabled={!!aiRunning}
                      onClick={() => {
                        // 需要补充输入的动作，第一次点击只展开输入框；填好后再点才执行
                        if (action.needsInput && aiInputFor !== action.id) {
                          setAiInputFor(action.id)
                          setAiInput('')
                          return
                        }
                        if (action.needsInput && !aiInput.trim()) return
                        void runAi(action, aiInput.trim())
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-dark-hover"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-brand-600 dark:text-brand-400" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-brand-600 dark:text-brand-400" />
                      )}
                      <span className="flex flex-col">
                        <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                          {action.label}
                        </span>
                        <span className="text-[10px] text-slate-400">{action.hint}</span>
                      </span>
                    </button>

                    {/* 展开输入框后，回车即执行 */}
                    {action.needsInput && aiInputFor === action.id && (
                      <div className="px-2 pb-1.5">
                        <input
                          autoFocus
                          value={aiInput}
                          onChange={(event) => setAiInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                              event.preventDefault()
                              if (aiInput.trim()) void runAi(action, aiInput.trim())
                            }
                          }}
                          placeholder={action.inputPlaceholder}
                          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-dark-border dark:bg-dark-bg dark:text-white"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
              <p className="px-2 pb-1 pt-1 text-[10px] leading-relaxed text-slate-400">
                使用「设置 → AI 渠道」里的模型；未配置时会报错。
              </p>
            </div>
          )}
        </div>
      )}
    </>
  )
}
