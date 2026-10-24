import type { ComponentType, ReactNode } from 'react'

/*
 * 工具页的公共零件：OpenNotas / Notion 极简暖灰阶规范。
 * 全站工具共用同一套表面、标题条、按钮和状态样式。
 */

type IconComponent = ComponentType<{ size?: number | string; className?: string }>

/* ---------------- 表面与文本 ---------------- */

/** 卡片容器：纯白底 + 1px #E6E6E3 细边框 + 极简微投影 */
export const CARD =
  'bg-white rounded-xl border border-[#E6E6E3] shadow-xs flex flex-col min-h-0'

/** 卡片标题条：浅米灰工作条，左侧粗体标题 + 标签，右侧操作 */
const CARD_HEAD =
  'flex items-center justify-between gap-2 px-3.5 h-[40px] rounded-t-xl shrink-0 border-b border-[#E6E6E3] bg-[#FBFBFA]'

/** 卡片底栏 */
const CARD_FOOT =
  'flex items-center justify-between gap-3 px-3.5 h-8 rounded-b-xl shrink-0 border-t border-[#E6E6E3] bg-[#FBFBFA] text-[10px] font-medium text-[#787774] tabular-nums'

/** 卡片正文区的内边距 */
export const CARD_BODY = 'flex-1 min-h-0 p-4 flex flex-col bg-white'

/** 正文文本域：卡片内部直接铺满的无边框输入 */
export const BODY_TEXTAREA =
  'w-full flex-1 bg-transparent resize-none outline-none font-mono text-[13px] leading-6 text-[#191918] placeholder:text-[#787774]/50 disabled:cursor-not-allowed'

/** 只读结果区 */
export const BODY_OUTPUT =
  'flex-1 min-h-0 overflow-y-auto select-text whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-[#191918]'

/** 卡片内的次要说明文字 */
export const META = 'text-[11px] text-[#787774]'

/** 等宽数值（字符数、计数等） */
export const META_MONO = 'font-mono text-[11px] text-[#787774]'

/** 卡内小标题（分组用） */
export const SECTION_LABEL =
  'text-[11px] font-semibold text-[#787774]'

/* ---------------- 按钮 ---------------- */

export const BTN = {
  primary:
    'inline-flex items-center justify-center gap-2 h-8 px-4 rounded-lg bg-[#1C1C1C] text-[13px] font-semibold text-white transition-all duration-150 hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap shadow-xs cursor-pointer',
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-lg border border-[#E6E6E3] bg-white text-xs font-semibold text-[#191918] transition-all duration-150 hover:bg-[#F3F3F1] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap cursor-pointer',
  ghost:
    'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-[#787774] transition-all duration-150 hover:bg-[#F3F3F1] hover:text-[#191918] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap cursor-pointer',
  danger:
    'inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-rose-600 transition-all duration-150 hover:bg-rose-50 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap cursor-pointer',
} as const

export type ButtonVariant = keyof typeof BTN

export function buttonClass(variant: ButtonVariant, extra = '') {
  return `${BTN[variant]} ${extra}`
}

/** 顶栏「当前正在查看」类按钮的选中态 */
export const BTN_ACTIVE =
  'border-[#1C1C1C] bg-[#1C1C1C] text-white'

/* ---------------- 图标按钮 ---------------- */

const ICON_TONES = {
  neutral:
    'text-[#787774] hover:bg-[#F3F3F1] hover:text-[#191918]',
  brand:
    'text-[#191918] hover:bg-[#F3F3F1] hover:text-[#1C1C1C]',
  danger:
    'text-rose-500 hover:bg-rose-50 hover:text-rose-600',
  emerald:
    'text-[#22C55E] bg-emerald-50 hover:bg-emerald-100',
} as const

export type IconTone = keyof typeof ICON_TONES

/** 卡片标题条上的小图标按钮（复制、清空、下载…） */
export function iconButtonClass(tone: IconTone = 'neutral', extra = '') {
  return `inline-flex items-center justify-center h-7 w-7 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${ICON_TONES[tone]} ${extra}`
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

/** 分段控件：白底与炭黑选中胶囊 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: SegmentedProps<T>) {
  return (
    <div
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[#F3F3F1] border border-[#E6E6E3] ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
              active
                ? 'bg-[#1C1C1C] text-white shadow-2xs'
                : 'text-[#787774] hover:text-[#191918]'
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
  return `inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] transition-colors shrink-0 cursor-pointer ${
    active
      ? 'font-semibold bg-[#1C1C1C] text-white shadow-2xs'
      : 'font-medium text-[#787774] hover:bg-[#F3F3F1] hover:text-[#191918]'
  } ${extra}`
}

/* ---------------- 小标签 ---------------- */

const TAG_TONES = {
  brand: 'bg-[#1C1C1C] text-white',
  emerald: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border border-amber-200',
  slate: 'bg-[#F3F3F1] text-[#787774] border border-[#E6E6E3]',
} as const

export type TagTone = keyof typeof TAG_TONES

export function ToolTag({
  tone = 'slate',
  className = '',
  children,
}: {
  tone?: TagTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[10px] font-semibold shrink-0 ${TAG_TONES[tone]} ${className}`}
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

export function ToolEmpty({ icon: Icon, title, hint, className = '' }: ToolEmptyProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 px-6 py-10 text-center ${className}`}
    >
      <span className="w-12 h-12 rounded-full border border-dashed border-[#E6E6E3] bg-[#F3F3F1] flex items-center justify-center text-[#787774]">
        <Icon size={20} />
      </span>
      <p className="text-xs font-semibold text-[#191918]">{title}</p>
      {hint && (
        <p className="text-[11px] text-[#787774] max-w-[280px] break-words">
          {hint}
        </p>
      )}
    </div>
  )
}

/* ---------------- 提示条 ---------------- */

const NOTICE_TONES = {
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  info: 'border-[#E6E6E3] bg-[#F3F3F1] text-[#191918]',
} as const

export type NoticeTone = keyof typeof NOTICE_TONES

interface ToolNoticeProps {
  tone?: NoticeTone
  icon?: IconComponent
  children: ReactNode
  className?: string
}

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
  fill?: boolean
}

export function ToolCard({ children, className = '', fill = true }: ToolCardProps) {
  return <div className={`${CARD} ${fill ? 'flex-1' : ''} ${className}`}>{children}</div>
}

interface ToolCardHeaderProps {
  title: ReactNode
  icon?: ComponentType<{ size?: number | string; className?: string }>
  sublabel?: ReactNode
  meta?: ReactNode
  tag?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  className?: string
}

export function ToolCardHeader({
  title,
  icon: Icon,
  sublabel,
  meta,
  tag,
  badge,
  actions,
  className = '',
}: ToolCardHeaderProps) {
  return (
    <div className={`${CARD_HEAD} ${className}`}>
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon size={14} className="text-[#787774] shrink-0" />}
        <span className="text-xs font-bold text-[#191918] truncate flex items-center gap-1.5">
          {title}
          {sublabel && <span className="text-[10px] text-[#787774] font-normal font-mono">{sublabel}</span>}
        </span>
        {meta && <span className="text-[11px] text-[#787774] font-normal truncate">{meta}</span>}
        {tag}
        {badge}
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
  info?: ReactNode
  children: ReactNode
  className?: string
}

export function ToolActionBar({ info, children, className = '' }: ToolActionBarProps) {
  return (
    <div
      className={`bg-white rounded-xl border border-[#E6E6E3] shadow-xs px-4 py-2 min-h-[44px] flex items-center justify-between gap-x-3 gap-y-2 flex-wrap shrink-0 ${className}`}
    >
      {info && (
        <div className="text-[11px] text-[#787774] min-w-0 flex items-center gap-2.5">
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
  neutral: 'text-[#787774]',
  emerald: 'text-[#22C55E]',
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  brand: 'text-[#191918]',
} as const

export function StatTile({ label, value, tone = 'neutral' }: StatTileProps) {
  return (
    <div className="bg-white rounded-xl border border-[#E6E6E3] px-4 py-3 shadow-2xs">
      <p className={`text-[11px] font-medium mb-0.5 ${STAT_TONES[tone]}`}>{label}</p>
      <p className="text-xl font-bold text-[#191918] tabular-nums leading-tight">
        {value}
      </p>
    </div>
  )
}
