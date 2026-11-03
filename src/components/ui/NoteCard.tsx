import type { ComponentType, ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Sparkles,
} from 'lucide-react'

export type NoteVariant = 'brand' | 'neutral' | 'warning' | 'danger' | 'success'

export interface NoteCardProps {
  variant?: NoteVariant
  icon?: ComponentType<{ className?: string }> | null
  title?: ReactNode
  children: ReactNode
  action?: ReactNode
  className?: string
}

const VARIANT_CONFIGS: Record<
  NoteVariant,
  {
    container: string
    iconBox: string
    titleText: string
    bodyText: string
    defaultIcon: ComponentType<{ className?: string }>
  }
> = {
  brand: {
    container:
      'bg-brand-50/40  border-brand-200/60 ',
    iconBox: 'bg-brand-100/70  text-brand-600 ',
    titleText: 'text-brand-950  font-semibold',
    bodyText: 'text-brand-900/80 ',
    defaultIcon: Sparkles,
  },
  neutral: {
    container:
      'bg-slate-50/70  border-slate-200/70 ',
    iconBox: 'bg-slate-200/70  text-slate-600 ',
    titleText: 'text-slate-900  font-semibold',
    bodyText: 'text-slate-600 ',
    defaultIcon: Info,
  },
  warning: {
    container:
      'bg-amber-50/40  border-amber-200/60 ',
    iconBox: 'bg-amber-100/70  text-amber-600 ',
    titleText: 'text-amber-950  font-semibold',
    bodyText: 'text-amber-900/80 ',
    defaultIcon: AlertTriangle,
  },
  danger: {
    container:
      'bg-rose-50/40  border-rose-200/60 ',
    iconBox: 'bg-rose-100/70  text-rose-600 ',
    titleText: 'text-rose-950  font-semibold',
    bodyText: 'text-rose-900/80 ',
    defaultIcon: AlertCircle,
  },
  success: {
    container:
      'bg-emerald-50/40  border-emerald-200/60 ',
    iconBox:
      'bg-emerald-100/70  text-emerald-600 ',
    titleText: 'text-emerald-950  font-semibold',
    bodyText: 'text-emerald-900/80 ',
    defaultIcon: CheckCircle2,
  },
}

/**
 * 统一现代轻质感提示条 / 说明卡片（NoteCard）。
 * 摆脱厚重粗暴的纯色色块，采用微透明质感背景、圆润微标与精巧排版。
 */
export default function NoteCard({
  variant = 'brand',
  icon,
  title,
  children,
  action,
  className = '',
}: NoteCardProps) {
  const conf = VARIANT_CONFIGS[variant]
  const Icon = icon === null ? null : icon ?? conf.defaultIcon

  return (
    <div
      className={`relative p-3 rounded-xl border flex items-start gap-2.5 text-xs transition-colors ${conf.container} ${className}`}
    >
      {Icon && (
        <div
          className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 shadow-2xs ${conf.iconBox}`}
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        {title && <div className={`text-xs mb-0.5 ${conf.titleText}`}>{title}</div>}
        <div className={`text-[11px] leading-relaxed ${conf.bodyText}`}>{children}</div>
      </div>
      {action && <div className="flex-shrink-0 ml-1">{action}</div>}
    </div>
  )
}
