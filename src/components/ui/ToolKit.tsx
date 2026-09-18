import type { ComponentType, ReactNode } from 'react'

/*
 * 工具页的公共零件。
 *
 * 全站工具共用同一套表面、标题条、按钮和状态样式，避免每个工具各写一份
 * 近似但不一致的类名 —— 改动只在这里发生，各工具只负责往里放内容。
 */

type IconComponent = ComponentType<{ size?: number | string; className?: string }>

/* ---------------- 表面与文本 ---------------- */

/** 卡片容器：白底 + 极淡描边 + 双层柔和投影 */
export const CARD =
  'bg-white dark:bg-dark-panel rounded-[14px] border border-slate-200/70 dark:border-dark-border shadow-[0_1px_3px_rgba(0,0,0,0.03),0_6px_16px_-4px_rgba(0,0,0,0.03)] flex flex-col min-h-0'

/** 卡片标题条：浅灰工作条，左侧粗体标题 + 彩色小标签，右侧胶囊操作 */
const CARD_HEAD =
  'flex items-center justify-between gap-2 px-3.5 h-[42px] shrink-0 border-b border-slate-200/60 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/30'

/** 卡片底栏 */
const CARD_FOOT =
  'flex items-center justify-between gap-3 px-3.5 h-9 shrink-0 border-t border-slate-200/60 dark:border-dark-border bg-slate-50/70 dark:bg-dark-hover/30 text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums'

/** 卡片正文区的内边距 */
export const CARD_BODY = 'flex-1 min-h-0 p-4 flex flex-col'

/** 正文文本域：卡片内部直接铺满的无边框输入 */
export const BODY_TEXTAREA =
  'w-full flex-1 bg-transparent resize-none outline-none font-mono text-[13px] leading-6 text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 disabled:cursor-not-allowed'

/** 只读结果区 */
export const BODY_OUTPUT =
  'flex-1 min-h-0 overflow-y-auto select-text whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-slate-800 dark:text-slate-100'

/** 卡片内的次要说明文字 */
export const META = 'text-[11px] text-slate-400 dark:text-slate-500'

/** 等宽数值（字符数、计数等） */
export const META_MONO = 'font-mono text-[11px] text-slate-400 dark:text-slate-500'

/** 卡内小标题（分组用） */
export const SECTION_LABEL =
  'text-[11px] font-semibold text-slate-500 dark:text-slate-400'

/* ---------------- 按钮 ---------------- */

export const BTN = {
  primary:
    'inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-brand-600 text-[13px] font-semibold text-white shadow-sm shadow-brand-600/20 transition-all duration-150 hover:bg-brand-700 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[10px] border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel text-xs font-semibold text-slate-600 dark:text-slate-300 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none dark:hover:border-slate-600 dark:hover:bg-dark-hover dark:hover:text-white whitespace-nowrap',
  ghost:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-[10px] text-xs font-semibold text-slate-500 dark:text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-800 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none dark:hover:bg-dark-hover dark:hover:text-slate-200 whitespace-nowrap',
  danger:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[10px] border border-rose-200 dark:border-rose-500/30 bg-white dark:bg-dark-panel text-xs font-semibold text-rose-600 dark:text-rose-400 transition-all duration-150 hover:bg-rose-50 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none dark:hover:bg-rose-500/10 whitespace-nowrap',
} as const

export type ButtonVariant = keyof typeof BTN

export function buttonClass(variant: ButtonVariant, extra = '') {
  return `${BTN[variant]} ${extra}`
}

/** 顶栏「当前正在查看」类按钮的选中态 */
export const BTN_ACTIVE =
  'ring-2 ring-brand-500/15 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400'

/* ---------------- 图标按钮 ---------------- */

const ICON_TONES = {
  neutral:
    'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-dark-hover dark:hover:text-slate-200',
  brand:
    'text-slate-400 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-500 dark:hover:bg-brand-500/10 dark:hover:text-brand-400',
  danger:
    'text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-400',
} as const

export type IconTone = keyof typeof ICON_TONES

/** 卡片标题条上的小图标按钮（复制、清空、下载…） */
export function iconButtonClass(tone: IconTone = 'neutral', extra = '') {
  return `inline-flex items-center justify-center h-7 w-7 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none ${ICON_TONES[tone]} ${extra}`
}

/* ---------------- 分段控件 ---------------- */

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  icon?: IconComponent
}

interface SegmentedProps<T extends string> {
  value: T
  options: readonly SegmentOption<T>[]
  onChange: (value: T) => void
  className?: string
}

/** 分段控件：白胶囊滑块，用于「文本 / 树形」这类互斥切换 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: SegmentedProps<T>) {
  return (
    <div
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-[10px] bg-slate-100 dark:bg-dark-hover ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-all ${
              active
                ? 'bg-white text-brand-600 shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:bg-dark-panel dark:text-brand-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {Icon && <Icon size={12} />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- 语言/筛选用胶囊 ---------------- */

export function pillClass(active: boolean, extra = '') {
  return `inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] transition-colors shrink-0 ${
    active
      ? 'font-semibold border border-brand-200/70 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300'
      : 'border border-transparent font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-dark-hover dark:hover:text-slate-200'
  } ${extra}`
}

/* ---------------- 小标签 ---------------- */

/** 撞色小标签（绿「有效」、灰「3 词条」这类），挂在卡片标题旁 */
const TAG_TONES = {
  brand:
    'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400',
  emerald:
    'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  slate: 'bg-slate-200/60 text-slate-600 dark:bg-dark-hover dark:text-slate-400',
} as const

export type TagTone = keyof typeof TAG_TONES

/** 卡片标题旁的小彩色标签（UTF-8 / 3 项 / 就绪 这类） */
export function ToolTag({
  tone = 'slate',
  children,
}: {
  tone?: TagTone
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[10px] font-semibold shrink-0 ${TAG_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/* ---------------- 空状态 ---------------- */

interface ToolEmptyProps {
  icon: IconComponent
  title: string
  hint?: string
  className?: string
}

/** 空状态：圆底淡图标 + 一句说明 */
export function ToolEmpty({ icon: Icon, title, hint, className = '' }: ToolEmptyProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 px-6 py-10 text-center ${className}`}
    >
      <span className="w-14 h-14 rounded-full border-2 border-slate-200/80 dark:border-dark-border border-dashed flex items-center justify-center text-slate-300 dark:text-slate-600">
        <Icon size={24} />
      </span>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{title}</p>
      {hint && (
        <p className="text-[11px] text-slate-400 dark:text-slate-600 max-w-[280px] break-words">
          {hint}
        </p>
      )}
    </div>
  )
}

/* ---------------- 提示条 ---------------- */

const NOTICE_TONES = {
  error:
    'border-rose-200/70 bg-rose-50/60 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300',
  warn: 'border-amber-200/70 bg-amber-50/60 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300',
  info: 'border-slate-200/70 bg-slate-50 text-slate-600 dark:border-dark-border dark:bg-dark-hover/40 dark:text-slate-300',
} as const

export type NoticeTone = keyof typeof NOTICE_TONES

interface ToolNoticeProps {
  tone?: NoticeTone
  icon?: IconComponent
  children: ReactNode
  className?: string
}

/** 页面级提示条（错误、告警、说明） */
export function ToolNotice({ tone = 'info', icon: Icon, children, className = '' }: ToolNoticeProps) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed shrink-0 ${NOTICE_TONES[tone]} ${className}`}
    >
      {Icon && <Icon size={14} className="mt-px shrink-0 opacity-80" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/* ---------------- 卡片与标题条 ---------------- */

interface ToolCardProps {
  children: ReactNode
  className?: string
  /** 是否让卡片在栅格里撑满高度（默认撑满） */
  fill?: boolean
}

export function ToolCard({ children, className = '', fill = true }: ToolCardProps) {
  return <div className={`${CARD} ${fill ? '' : 'flex-none'} ${className}`}>{children}</div>
}

interface ToolCardHeaderProps {
  title: ReactNode
  icon?: IconComponent
  /** 标题右侧带底色的补充说明（如 UTF-8、来源引擎） */
  sublabel?: ReactNode
  /** 标题右侧的次要信息（渲染成彩色小标签） */
  meta?: ReactNode
  /** 标题条最右侧的操作区 */
  actions?: ReactNode
  className?: string
}

export function ToolCardHeader({
  title,
  icon: Icon,
  sublabel,
  meta,
  actions,
  className = '',
}: ToolCardHeaderProps) {
  return (
    <div className={`${CARD_HEAD} ${className}`}>
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon size={14} className="text-brand-500 dark:text-brand-400 shrink-0" />}
        <span className="text-[13px] font-bold text-slate-900 dark:text-white truncate shrink-0">
          {title}
        </span>
        {sublabel && (
          <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 truncate">
            {sublabel}
          </span>
        )}
        {meta && (
          <span className="inline-flex items-center h-[18px] px-1.5 rounded-md bg-slate-200/50 dark:bg-dark-hover text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums truncate">
            {meta}
          </span>
        )}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  )
}

interface ToolCardFooterProps {
  children: ReactNode
  className?: string
}

export function ToolCardFooter({ children, className = '' }: ToolCardFooterProps) {
  return <div className={`${CARD_FOOT} ${className}`}>{children}</div>
}

/* ---------------- 底部动作条 ---------------- */

interface ToolActionBarProps {
  /** 左侧说明文字或开关 */
  info?: ReactNode
  /** 右侧按钮组 */
  children: ReactNode
  className?: string
}

/** 页面底部的动作托架（Dock）：左侧遥测说明、右侧渐变主按钮 */
export function ToolActionBar({ info, children, className = '' }: ToolActionBarProps) {
  return (
    <div
      className={`bg-white dark:bg-dark-panel rounded-[10px] border border-slate-200/70 dark:border-dark-border shadow-[0_1px_3px_rgba(0,0,0,0.03),0_6px_16px_-4px_rgba(0,0,0,0.03)] px-4 h-12 flex items-center justify-between gap-3 flex-wrap shrink-0 ${className}`}
    >
      {info && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 min-w-0 flex items-center gap-2.5">
          {info}
        </div>
      )}
      <div className={`flex items-center gap-2 ${info ? 'ml-auto' : ''}`}>{children}</div>
    </div>
  )
}

/* ---------------- 统计小格 ---------------- */

interface StatTileProps {
  label: string
  value: ReactNode
  tone?: 'neutral' | 'emerald' | 'rose' | 'amber' | 'brand'
}

const STAT_TONES = {
  neutral: 'text-slate-500 dark:text-slate-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  brand: 'text-brand-600 dark:text-brand-400',
} as const

/** 数值统计格 */
export function StatTile({ label, value, tone = 'neutral' }: StatTileProps) {
  return (
    <div className="bg-white dark:bg-dark-panel rounded-xl border border-slate-200/70 dark:border-dark-border px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className={`text-[11px] font-medium mb-0.5 ${STAT_TONES[tone]}`}>{label}</p>
      <p className="text-xl font-bold text-slate-800 dark:text-white tabular-nums leading-tight">
        {value}
      </p>
    </div>
  )
}
