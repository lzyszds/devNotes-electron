import type { ComponentType, ReactNode } from 'react'

type IconComponent = ComponentType<{ size?: number | string; className?: string }>

export type ToolBadgeTone = 'brand' | 'emerald' | 'amber' | 'rose'

const BADGE_TONES: Record<ToolBadgeTone, { box: string; dot: string }> = {
  brand: {
    box: 'border-brand-200/70 bg-brand-50 text-brand-700 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
  emerald: {
    box: 'border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  amber: {
    box: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  rose: {
    box: 'border-rose-200/70 bg-rose-50 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
}

export interface ToolBadgeProps {
  tone?: ToolBadgeTone
  /** 左侧状态点 */
  dot?: boolean
  /** 状态点呼吸效果，用于「在线 / 进行中」 */
  pulse?: boolean
  /** 传了就渲染成按钮，用于「未配置，点此填写」这类入口 */
  onClick?: () => void
  /** 追加类名，如窄屏隐藏用 hidden sm:flex */
  className?: string
  children: ReactNode
}

/** 标题右侧的状态徽章 */
export function ToolBadge({
  tone = 'emerald',
  dot = true,
  pulse = false,
  onClick,
  className: extraClassName = '',
  children,
}: ToolBadgeProps) {
  const { box, dot: dotClass } = BADGE_TONES[tone]
  const className = `flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border transition ${box} ${extraClassName}`
  const content = (
    <>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotClass} ${pulse ? 'animate-pulse' : ''}`} />}
      <span>{children}</span>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} hover:brightness-[0.98]`}>
        {content}
      </button>
    )
  }
  return <span className={className}>{content}</span>
}

export interface ToolShellProps {
  /** 顶栏左侧图标（lucide 组件） */
  icon: IconComponent
  /** 图标块色调。muted 用于「未连接 / 未就绪」这类状态 */
  iconTone?: 'brand' | 'muted'
  title: string
  /** 标题下方的说明文字 */
  subtitle?: ReactNode
  /** 标题右侧的状态徽章，通常传 <ToolBadge> */
  badge?: ReactNode
  /** 顶栏右侧操作区：引擎下拉、历史记录按钮等 */
  actions?: ReactNode
  /**
   * 内容区是否套一层带内边距的滚动容器（默认套）。
   * 满高双栏这类自己要管滚动的布局传 false。
   */
  scroll?: boolean
  /** 追加到内容区容器上的类名 */
  contentClassName?: string
  /** 浮层（历史记录等）。必须挂在根节点下 —— .history-overlay 靠 absolute 定位 */
  overlay?: ReactNode
  children: ReactNode
}

/**
 * 工具页统一外壳：顶栏（图标 + 标题 + 状态徽章 + 右侧操作）+ 内容区。
 *
 * 所有工具共用这一套骨架，改版式只动这里。内容区的间距、底色、
 * 深色变体也都在这里定，各工具只管往里放自己的卡片。
 */
export default function ToolShell({
  icon: Icon,
  iconTone = 'brand',
  title,
  subtitle,
  badge,
  actions,
  scroll = true,
  contentClassName = '',
  overlay,
  children,
}: ToolShellProps) {
  return (
    <div className="relative flex h-full min-h-0 bg-slate-50/60 dark:bg-dark-bg overflow-hidden text-slate-900 dark:text-slate-100">
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex-wrap gap-3 px-4 py-3 md:px-8 md:py-4 bg-white dark:bg-dark-panel border-b border-slate-200/80 dark:border-dark-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                iconTone === 'brand'
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/20'
                  : 'bg-slate-100 text-slate-400 dark:bg-dark-hover dark:text-slate-500'
              }`}
            >
              <Icon size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900 dark:text-white leading-none">
                  {title}
                </h2>
                {badge}
              </div>
              {subtitle && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 truncate">{subtitle}</p>
              )}
            </div>
          </div>

          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </header>

        {scroll ? (
          <div
            className={`flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 flex flex-col gap-4 ${contentClassName}`}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </div>

      {overlay}
    </div>
  )
}
