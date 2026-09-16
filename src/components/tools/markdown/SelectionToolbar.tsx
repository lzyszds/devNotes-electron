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
  PaintBucket,
  Palette,
  Strikethrough,
  Subscript,
  Superscript,
  TextQuote,
  Underline,
} from 'lucide-react'
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
}: SelectionToolbarProps) {
  // null = 不展开；其余 = 展开对应的小面板
  const [panel, setPanel] = useState<'size' | 'color' | 'bg' | null>(null)

  const { renderPortal } = useFloatingBar(editor, providerRef, {
    /*
      宿主容器由 Provider 搬到 document.body 下并按 floating-ui 算出的坐标写内联
      left/top，显隐靠 data-show。元素本身由 hook 建、不进 React 树（理由见 FloatingBar.tsx），
      类名所以在 index.css 里是**全局**的 —— 搬到 body 后编辑区作用域选择器就匹配不上了。
    */
    hostClassName: 'fehelper-floating-bar',
    shouldShow: hasTextSelection,
    // Cherry 的 bubble 是「居中压在选区上方」的，不是左对齐
    placement: 'top',
    // 浮条一收起来就把小面板复位，免得下次浮出来还挂着一个开着的面板
    onVisibilityChange: (visible) => {
      if (!visible) setPanel(null)
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

  return (
    <>
      {renderPortal(
        /*
         * col-reverse：小面板排在浮条**上方**。
         * 浮条本身是压在选区上方的，面板再往下挂就会盖住正在编辑的那行文字；
         * 反序排列后展开的面板朝上生长，不挡正文。间距随之改成 mb-*（见下）。
         */
        <div className="flex flex-col-reverse items-center">
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
        </div>
      )}
    </>
  )
}
