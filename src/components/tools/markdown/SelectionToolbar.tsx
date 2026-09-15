import { useCallback, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { Editor } from '@milkdown/kit/core'
import type { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  Baseline,
  Bold,
  Highlighter,
  Italic,
  Palette,
  Strikethrough,
  Subscript,
  Superscript,
  TextQuote,
  Underline,
} from 'lucide-react'
import { FloatingBarButton, FloatingBarDivider, FloatingBarShell, useFloatingBar } from './FloatingBar'
import {
  runMilkdownCommand,
  setInlineBackgroundColor,
  setInlineFontSize,
  setInlineTextColor,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
} from './milkdownCommands'

export type SelectionToolbarProps = {
  editor: Editor | null
  /** 由编辑器组件持有，闭包进驱动插件；见 milkdownFloatingBar.ts */
  providerRef: MutableRefObject<TooltipProvider | null>
}

/** 选中了「有内容的」文字才浮出来 */
function hasTextSelection(view: EditorView): boolean {
  const { selection } = view.state
  if (!view.editable || !view.hasFocus()) return false
  if (selection.empty) return false
  // 拖选经过空行时整段可能只有空白字符，这种情况弹出来没意义
  return view.state.doc.textBetween(selection.from, selection.to).trim().length > 0
}

/**
 * 字号档位。数值与 Cherry 的 Size 菜单一一对应（12/17/24/32），
 * 写出来的标记也一致，两个内核共用一份 Markdown 时必须对齐。
 */
const FONT_SIZES = [
  { px: 12, label: '小' },
  { px: 17, label: '中' },
  { px: 24, label: '大' },
  { px: 32, label: '超大' },
] as const

/**
 * 文字颜色。Cherry 的调色盘是一整块 HSV 拾色器（含最近使用色），
 * 这里只取常用色做成一格小色板 —— 做不了同等保真度，够用即可。
 */
const TEXT_COLORS = [
  '#e60000',
  '#ff8000',
  '#e6b800',
  '#2e9e4f',
  '#0099ff',
  '#6600cc',
  '#999999',
  '#1f2937',
] as const

/**
 * 文字背景色。**带透明度**，不是实色 —— 实色在深色主题下会把正文的字压得看不见，
 * 而底色是写进 Markdown 的内联样式，CSS 覆盖不掉，只能一开始就选一个明暗两种主题
 * 下都读得清的写法。半透明色叠在任意底色上都只是一层淡色，两种主题都不影响阅读，
 * 项目自己的高亮（`<mark>`）走的也是这条路子。
 */
const BACKGROUND_COLORS = [
  'rgba(230, 0, 0, 0.32)',
  'rgba(255, 128, 0, 0.32)',
  'rgba(230, 184, 0, 0.38)',
  'rgba(46, 158, 79, 0.3)',
  'rgba(0, 153, 255, 0.3)',
  'rgba(102, 0, 204, 0.28)',
  'rgba(100, 116, 139, 0.28)',
  'rgba(236, 72, 153, 0.3)',
] as const

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
      className="mt-1 grid grid-cols-8 gap-1 rounded-lg border border-slate-200/80 bg-white p-1.5 shadow-lg dark:border-dark-border dark:bg-dark-panel"
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
 * 选中文字后浮出的格式菜单，对齐双栏内核（Cherry）的 bubble 工具条。
 *
 * 按钮清单与 `CherryMarkdownEditor` 里 `toolbars.bubble` 的配置逐项对应：
 *   bold / italic / underline / strikethrough / sub / sup / quote | size / color
 * （背景色是 Cherry 的 `color` 菜单里「文字颜色 / 背景色」两个页签之一，
 * 这里拆成独立一颗按钮，比 Cherry 少一次点击。）
 * 两个内核的浮条长得一样、点出来的东西也一样，切换内核时不会觉得换了套工具。
 *
 * 命令执行完**不主动隐藏**：加粗之后通常还要接着点斜体，Cherry 的 bubble 也是这个行为。
 * 真正让浮条消失的是选区塌陷（点一下空白处），那时插件自然会问出 false。
 */
export default function SelectionToolbar({ editor, providerRef }: SelectionToolbarProps) {
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
        <div className="flex flex-col items-center">
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
              icon={Highlighter}
              label="背景色"
              active={panel === 'bg'}
              onClick={() => setPanel((prev) => (prev === 'bg' ? null : 'bg'))}
            />
          </FloatingBarShell>

          {/* 小面板挂在浮条下方。同样要拦住 mousedown，否则编辑区一失焦选区就没了 */}
          {panel === 'size' && (
            <div
              onMouseDown={(event) => event.preventDefault()}
              className="mt-1 flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-white px-1 py-0.5 shadow-lg dark:border-dark-border dark:bg-dark-panel"
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
