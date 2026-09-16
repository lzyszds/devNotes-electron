import { Fragment } from 'react'
import type { ReactNode } from 'react'
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
}

/** 工具栏上的一个渲染单元：一颗平铺按钮，或一个分组折叠菜单 */
type ToolbarEntry =
  | { kind: 'command'; id: string; group: number; command: MarkdownCommand }
  | { kind: 'menu'; id: string; group: number; menu: MarkdownMenuSpec }

/**
 * 自绘工具栏。Cherry 与 Milkdown 共用同一个组件，因此两种内核下这一行的
 * 高度、按钮尺寸、hover、分隔线、图标大小完全一致。
 *
 * 结构分两层：
 *   - 高频项（加粗/斜体/列表/链接…）平铺，保持一次点击就能执行
 *   - 同类能力（行内样式、结构插入）折进分组菜单，横向不至于滚不到头
 * 两者的相对位置由 group 决定：命令与菜单一起按 group 稳定排序，
 * 同组内命令在前、菜单在后，所以「格式」正好落在行内格式那组之后。
 */
export default function MarkdownToolbar({
  engine,
  onCommand,
  onMenuCommand,
  state,
  trailing,
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
      // 菜单都挂左端（group ≤ 5），右端保持「大纲/搜索/全屏/预览/导出」那一排
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
  const right = buildSide(true)

  // 只在同侧、且跨组的地方放分隔线，避免右端第一颗前面挂一条
  const divider = (previous: ToolbarEntry | undefined, entry: ToolbarEntry) =>
    previous !== undefined && previous.group !== entry.group ? (
      <span className="mx-1 h-3.5 w-px flex-shrink-0 bg-slate-200 dark:bg-dark-border" />
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
            className={`flex-shrink-0 rounded-lg p-1.5 transition-colors disabled:pointer-events-none disabled:opacity-35 ${
              active
                ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-dark-hover dark:hover:text-white'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </Fragment>
    )
  }

  return (
    /*
     * relative z-40：块手柄是 position: fixed + z-index 30，挂在编辑区里浮在光标行左侧，
     * 光标落在首行时会顶到工具栏这一带把它盖住。工具栏本身是静态定位、没有层级，
     * 压不住它 —— 这里显式抬到 40 并建立层叠上下文，配着不透明的底色把手柄挡住。
     * 40 仍低于浮条（80）与 Tooltip（90），光标附近的浮层照常浮在最上面。
     *
     * 注意：z-40 同时建立了层叠上下文，工具栏内的 absolute 子元素都会被压在这一层里。
     * 分组菜单因此走 createPortal + position: fixed 挂到 body 下（见 ToolbarMenu），
     * 否则既会被 overflow-x-auto 裁掉，又会被浮条盖住。
     */
    <div className="relative z-40 flex h-10 flex-shrink-0 flex-nowrap items-center gap-0.5 overflow-x-auto scrollbar-hide border-b border-slate-200/80 bg-white px-2 dark:border-dark-border dark:bg-dark-panel">
      {left.map((entry, index) => renderEntry(entry, left[index - 1]))}

      {/* 把右端那一组顶到另一端 */}
      <span className="min-w-2 flex-1" />

      {right.map((entry, index) => renderEntry(entry, right[index - 1]))}

      {trailing && <span className="ml-1.5 flex flex-shrink-0 items-center">{trailing}</span>}
    </div>
  )
}
