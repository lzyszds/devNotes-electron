import { Fragment } from 'react'
import type { ReactNode } from 'react'
import Tooltip from '../../ui/Tooltip'
import { commandsFor } from './toolbarSpec'
import type { MarkdownCommand, MarkdownEngine } from './toolbarSpec'

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
  /** 状态镜像；Cherry 与 Milkdown 侧都没有激活态/禁用态，传空对象即可 */
  state?: Record<string, ToolbarItemState>
  /** 右端插槽：视图模式切换、内核切换等 */
  trailing?: ReactNode
}

/**
 * 自绘工具栏。Cherry 与 Milkdown 共用同一个组件，因此两种内核下这一行的
 * 高度、按钮尺寸、hover、分隔线、图标大小完全一致。
 *
 * 按钮清单与顺序来自 toolbarSpec，两个内核各按自己声明的字段少渲染几颗，
 * 不做任何「补齐」—— 少一颗按钮比多一颗点了没反应的按钮好。
 */
export default function MarkdownToolbar({
  engine,
  onCommand,
  state,
  trailing,
}: MarkdownToolbarProps) {
  const commands = commandsFor(engine)
  const left = commands.filter((item) => item.align !== 'right')
  const right = commands.filter((item) => item.align === 'right')

  const renderButton = (command: MarkdownCommand, previous: MarkdownCommand | undefined) => {
    const current = state?.[command.id]
    if (current?.hidden) return null

    const Icon = command.icon
    const active = Boolean(current?.active)
    // 只在同侧、且跨组的地方放分隔线，避免右端第一颗前面挂一条
    const showDivider = previous !== undefined && previous.group !== command.group

    return (
      <Fragment key={command.id}>
        {showDivider && <span className="mx-1 h-3.5 w-px flex-shrink-0 bg-slate-200 dark:bg-dark-border" />}
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
     */
    <div className="relative z-40 flex h-10 flex-shrink-0 flex-nowrap items-center gap-0.5 overflow-x-auto scrollbar-hide border-b border-slate-200/80 bg-white px-2 dark:border-dark-border dark:bg-dark-panel">
      {left.map((command, index) => renderButton(command, left[index - 1]))}

      {/* 把右端那一组顶到另一端 */}
      <span className="min-w-2 flex-1" />

      {right.map((command, index) => renderButton(command, right[index - 1]))}

      {trailing && <span className="ml-1.5 flex flex-shrink-0 items-center">{trailing}</span>}
    </div>
  )
}
