import type { ComponentType } from 'react'
import { menuCommandsFor } from './toolbarSpec'
import type { MarkdownCommand, MarkdownEngine, ToolbarMenuId } from './toolbarSpec'
import { BACKGROUND_COLORS, EMOJI_LIST, FONT_SIZES, TEXT_COLORS } from './inlinePalette'

export type ToolbarMenuContentProps = {
  engine: MarkdownEngine
  menu: ToolbarMenuId
  /**
   * 执行菜单里的一条命令。
   * payload 供字号 / 颜色 / 表情这类「先取一个值再执行」的项使用，
   * 无参命令（下划线、清除格式…）不带它。
   */
  onCommand: (id: string, payload?: string | number) => void
  /** 收起菜单 */
  close: () => void
}

/** 菜单里的一行：图标 + 文字 */
function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-dark-hover dark:hover:text-white"
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 dark:text-slate-500" />
      <span className="truncate">{label}</span>
    </button>
  )
}

/** 菜单里的一段小标题 */
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </div>
  )
}

/** 分组之间的细线 */
function MenuDivider() {
  return <div className="my-1 h-px bg-slate-100 dark:bg-dark-border" />
}

/**
 * 一排色块。
 *
 * 与浮条里的 SwatchGrid 长得一样，但这里不需要再拦 mousedown ——
 * 菜单面板本身已经在 ToolbarMenu 里统一 preventDefault 了，编辑区不会因此失焦。
 */
function SwatchGrid({
  colors,
  onPick,
}: {
  colors: readonly string[]
  onPick: (color: string) => void
}) {
  return (
    <div className="grid grid-cols-8 gap-1 px-2 pb-1 pt-0.5">
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

/** 按 id 取命令的声明（图标 / 文案都写在 toolbarSpec 里，不在这里另抄一份） */
function commandById(engine: MarkdownEngine, menu: ToolbarMenuId, id: string): MarkdownCommand | undefined {
  return menuCommandsFor(engine, menu).find((item) => item.id === id)
}

/** 「格式」菜单：行内样式 + 缩进 + 字号/颜色/背景色 */
function FormatMenuContent({ engine, onCommand, close }: ToolbarMenuContentProps) {
  // 点一下就执行的无参命令。清单顺序即菜单里的顺序
  const simpleIds = ['underline', 'superscript', 'subscript', 'highlight', 'clear-format', 'indent', 'outdent']

  return (
    <div className="flex flex-col">
      {simpleIds.map((id) => {
        const command = commandById(engine, 'format', id)
        if (!command) return null
        return (
          <MenuItem
            key={id}
            icon={command.icon}
            label={command.label}
            onClick={() => {
              onCommand(id)
              close()
            }}
          />
        )
      })}

      <MenuDivider />
      <SectionLabel>字号</SectionLabel>
      {/* mt-0.5 让档位按钮与上方的文字左对齐（色板那两格有 px-2 的内边距） */}
      <div className="flex flex-col gap-0.5 px-1">
        {FONT_SIZES.map((size) => (
          <button
            key={size.px}
            type="button"
            onClick={() => {
              onCommand('font-size', size.px)
              close()
            }}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-dark-hover dark:hover:text-white"
          >
            <span className="w-8 flex-shrink-0 font-semibold tabular-nums" style={{ fontSize: `${Math.min(size.px, 16)}px` }}>
              {size.px}
            </span>
            <span className="text-slate-400 dark:text-slate-500">{size.label}</span>
          </button>
        ))}
      </div>

      <MenuDivider />
      <SectionLabel>文字颜色</SectionLabel>
      <SwatchGrid
        colors={TEXT_COLORS}
        onPick={(color) => {
          onCommand('text-color', color)
          close()
        }}
      />

      <MenuDivider />
      <SectionLabel>背景色</SectionLabel>
      <SwatchGrid
        colors={BACKGROUND_COLORS}
        onPick={(color) => {
          onCommand('bg-color', color)
          close()
        }}
      />
    </div>
  )
}

/** 「插入」菜单：Cherry 专有块的 Milkdown 版 + 目录/脚注/公式 + 表情 */
function InsertMenuContent({ engine, onCommand, close }: ToolbarMenuContentProps) {
  const structuralIds = ['md-panel', 'md-timeline', 'md-chart']
  const textIds = ['md-toc', 'md-footnote', 'md-math']

  const renderItem = (id: string, keepOpen = false) => {
    const command = commandById(engine, 'insert', id)
    if (!command) return null
    return (
      <MenuItem
        key={id}
        icon={command.icon}
        label={command.label}
        onClick={() => {
          onCommand(id)
          if (!keepOpen) close()
        }}
      />
    )
  }

  return (
    <div className="flex flex-col">
      {structuralIds.map((id) => renderItem(id))}

      <MenuDivider />
      {textIds.map((id) => renderItem(id))}

      <MenuDivider />
      <SectionLabel>表情</SectionLabel>
      {/*
        表情点完同样收起菜单。让菜单常开、边插边选中看着更顺，但插入后编辑器会重新
        focus 并可能滚动，工具栏的「滚动即关」守卫会立刻把它收掉 —— 与其留一条
        时灵时不灵的路径，不如与其它项保持同一个行为。
      */}
      <div className="grid grid-cols-8 gap-0.5 px-1.5 pb-1">
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onCommand('md-emoji', emoji)
              close()
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-sm transition-colors hover:bg-slate-100 dark:hover:bg-dark-hover"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 菜单内容分发：新增菜单时在这里挂一个分支即可 */
export default function ToolbarMenuContent(props: ToolbarMenuContentProps) {
  if (props.menu === 'format') return <FormatMenuContent {...props} />
  if (props.menu === 'insert') return <InsertMenuContent {...props} />
  return null
}
