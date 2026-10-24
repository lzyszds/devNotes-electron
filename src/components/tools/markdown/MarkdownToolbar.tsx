import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpToLine } from 'lucide-react'
import Tooltip from '../../ui/Tooltip'
import ToolbarMenu from './ToolbarMenu'
import ToolbarMenuContent from './ToolbarMenus'
import { commandsFor, menusFor } from './toolbarSpec'
import type { MarkdownCommand, MarkdownEngine, MarkdownMenuSpec } from './toolbarSpec'

/** 按钮的实时状态，由各内核的镜像 hook 提供；缺省即「可用、未激活」 */
export type ToolbarItemState = {
  disabled?: boolean
  active?: boolean
  hidden?: boolean
}

export type MarkdownToolbarProps = {
  engine: MarkdownEngine
  /** 点某颗按钮。anchor 是这颗 React 按钮本身，供派发层重摆原生弹层 */
  onCommand: (command: MarkdownCommand, anchor: HTMLElement) => void
  /**
   * 折叠菜单里执行的命令。id 是命令 id，payload 供字号 / 颜色 / 表情这类
   * 「先取一个值再执行」的项使用，无参命令不带它。
   */
  onMenuCommand?: (id: string, payload?: string | number) => void
  /** 状态镜像；Cherry 与 Milkdown 侧都没有激活态/禁用态，传空对象即可 */
  state?: Record<string, ToolbarItemState>
  /** 右端插槽：视图模式切换、内核切换等 */
  trailing?: ReactNode
  /**
   * 左端插槽：宿主页面自己的控件（编辑器内核切换）。
   */
  leading?: ReactNode
  /**
   * 最右端插槽：笔记页自己的控件（缩放）。
   */
  extra?: ReactNode
  /**
   * 「返回顶部」。由宿主给状态（滚离顶部才显示）与回调
   */
  backToTop?: { visible: boolean; onClick: () => void }
  /** 是否隐藏右侧辅助命令（已下移至右侧大纲胶囊下），默认为 true */
  hideRightCommands?: boolean
}

/** 工具栏上的一个渲染单元：一颗平铺按钮，或一个分组折叠菜单 */
type ToolbarEntry =
  | { kind: 'command'; id: string; group: number; command: MarkdownCommand }
  | { kind: 'menu'; id: string; group: number; menu: MarkdownMenuSpec }

/**
 * 自绘工具栏。采用胶囊岛（Floating Capsule）设计，左边距对齐正文大标题。
 */
export default function MarkdownToolbar({
  engine,
  onCommand,
  onMenuCommand,
  state,
  trailing,
  leading,
  extra,
  backToTop,
  hideRightCommands = true,
}: MarkdownToolbarProps) {
  const commands = commandsFor(engine)
  const menus = menusFor(engine)

  const buildSide = (right: boolean): ToolbarEntry[] =>
    [
      ...commands
        .filter((item) => (item.align === 'right') === right)
        .map(
          (item): ToolbarEntry => ({
            kind: 'command',
            id: item.id,
            group: item.group,
            command: item,
          })
        ),
      // 菜单都挂左端（group ≤ 5）
      ...(right ? [] : menus).map(
        (item): ToolbarEntry => ({
          kind: 'menu',
          id: `menu-${item.id}`,
          group: item.group,
          menu: item,
        })
      ),
    ].sort((a, b) => a.group - b.group)

  const left = buildSide(false)
  const right = hideRightCommands ? [] : buildSide(true)

  // 只在同侧、且跨组的地方放分隔线
  const divider = (previous: ToolbarEntry | undefined, entry: ToolbarEntry) =>
    previous !== undefined && previous.group !== entry.group ? (
      <span className="mx-1 h-3.5 w-px flex-shrink-0 bg-black/[0.08]" />
    ) : null

  const renderEntry = (entry: ToolbarEntry, previous: ToolbarEntry | undefined) => {
    if (entry.kind === 'menu') {
      return (
        <Fragment key={entry.id}>
          {divider(previous, entry)}
          <ToolbarMenu
            label={entry.menu.label}
            icon={entry.menu.icon}
            width={entry.menu.width}
            disabled={!onMenuCommand}
          >
            {(close) => (
              <ToolbarMenuContent
                engine={engine}
                menu={entry.menu.id}
                onCommand={(id, payload) => onMenuCommand?.(id, payload)}
                close={close}
              />
            )}
          </ToolbarMenu>
        </Fragment>
      )
    }

    const { command } = entry
    const current = state?.[command.id]
    if (current?.hidden) return null

    const Icon = command.icon
    const active = Boolean(current?.active)

    return (
      <Fragment key={command.id}>
        {divider(previous, entry)}
        <Tooltip content={command.label}>
          <button
            type="button"
            disabled={current?.disabled}
            aria-label={command.label}
            aria-pressed={active || undefined}
            onClick={(event) => onCommand(command, event.currentTarget)}
            className={`flex-shrink-0 rounded-lg p-1.5 transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-35 ${
              active
                ? 'bg-black/[0.08] text-[#191918] font-bold'
                : 'text-[#787774] hover:bg-black/[0.04] hover:text-[#191918]'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </Fragment>
    )
  }

  return (
    <div className="relative z-40 flex flex-shrink-0 items-center overflow-x-auto scrollbar-hide px-3 md:px-12 py-2 select-none max-md:p-0 max-md:border-t max-md:border-black/[0.06] max-md:bg-white">
      <div className="inline-flex items-center gap-0.5 px-2 py-1 rounded-xl bg-white/95 backdrop-blur-md border border-black/[0.08] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] max-md:w-full max-md:rounded-none max-md:border-0 max-md:shadow-none max-md:bg-transparent max-md:px-2 max-md:h-10">
        {backToTop && (
          <Tooltip content="返回顶部">
            <button
              type="button"
              onClick={backToTop.onClick}
              aria-label="返回顶部"
              className={`mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[#787774] transition-colors hover:bg-black/[0.04] hover:text-[#191918] cursor-pointer ${
                backToTop.visible ? '' : 'invisible'
              }`}
            >
              <ArrowUpToLine className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )}

        {leading && (
          <>
            <span className="mr-0.5 flex flex-shrink-0 items-center">{leading}</span>
            <span className="mx-1 h-3.5 w-px flex-shrink-0 bg-black/[0.08]" />
          </>
        )}

        {left.map((entry, index) => renderEntry(entry, left[index - 1]))}

        {right.length > 0 && (
          <>
            <span className="min-w-2 flex-1" />
            {right.map((entry, index) => renderEntry(entry, right[index - 1]))}
          </>
        )}

        {trailing && (
          <>
            <span className="mx-1 h-3.5 w-px flex-shrink-0 bg-black/[0.08]" />
            <span className="flex flex-shrink-0 items-center">{trailing}</span>
          </>
        )}

        {extra && (
          <>
            <span className="mx-1 h-3.5 w-px flex-shrink-0 bg-black/[0.08]" />
            <span className="flex flex-shrink-0 items-center gap-1.5">{extra}</span>
          </>
        )}
      </div>
    </div>
  )
}
