import { forwardRef } from "react";
import type { ComponentType, ReactNode, Ref } from "react";

type IconComponent = ComponentType<{
  size?: number | string;
  className?: string;
}>;

export type ToolBadgeTone = "brand" | "emerald" | "amber" | "rose";

/* 
 * 状态徽章：Notion 极简暖灰阶风格，去霓虹感，仅保留微彩色小圆点 
 */
const BADGE_TONES: Record<ToolBadgeTone, { box: string; dot: string }> = {
  brand: {
    box: "border-[#E6E6E3] bg-[#F3F3F1] text-[#191918]",
    dot: "bg-[#1C1C1C]",
  },
  emerald: {
    box: "border-[#E6E6E3] bg-[#F3F3F1] text-[#191918]",
    dot: "bg-[#22C55E]",
  },
  amber: {
    box: "border-[#E6E6E3] bg-[#F3F3F1] text-[#191918]",
    dot: "bg-[#F97316]",
  },
  rose: {
    box: "border-[#E6E6E3] bg-[#F3F3F1] text-[#191918]",
    dot: "bg-[#EC4899]",
  },
};

export interface ToolBadgeProps {
  tone?: ToolBadgeTone;
  /** 左侧状态点 */
  dot?: boolean;
  /** 状态点呼吸效果，用于「在线 / 进行中」 */
  pulse?: boolean;
  /** 传了就渲染成按钮，用于「未配置，点此填写」这类入口 */
  onClick?: () => void;
  /** 追加类名，如窄屏隐藏用 hidden sm:flex */
  className?: string;
  children: ReactNode;
}

/**
 * 标题右侧的状态徽章。
 *
 * 必须转发 ref：Tooltip 是用 cloneElement 把 ref 挂到子元素上来定位气泡的，
 * 函数组件不接 ref 的话，外面套一层 Tooltip 就会报警告、气泡也定位不到。
 */
export const ToolBadge = forwardRef<HTMLElement, ToolBadgeProps>(
  function ToolBadge(
    {
      tone = "emerald",
      dot = true,
      pulse = false,
      onClick,
      className: extraClassName = "",
      children,
    },
    ref,
  ) {
    const { box, dot: dotClass } = BADGE_TONES[tone];
    const className = `inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-medium border transition min-w-0 shrink-[6] ${box} ${extraClassName}`;
    const content = (
      <>
        {dot && (
          <span
            className={`w-1.5 h-1.5 rounded-full ${dotClass} ${pulse ? "animate-pulse" : ""
              }`}
          />
        )}
        <span className="truncate">{children}</span>
      </>
    );

    if (onClick) {
      return (
        <button
          ref={ref as Ref<HTMLButtonElement>}
          type="button"
          onClick={onClick}
          className={`${className} hover:bg-[#EAEAE7] cursor-pointer`}
        >
          {content}
        </button>
      );
    }
    return (
      <span ref={ref as Ref<HTMLSpanElement>} className={className}>
        {content}
      </span>
    );
  },
);

export interface ToolShellProps {
  /** 顶栏左侧图标（lucide 组件） */
  icon: IconComponent;
  /** 图标块色调。muted 用于「未连接 / 未就绪」这类状态 */
  iconTone?: "brand" | "muted";
  title: string;
  /** 标题下方的说明文字 */
  subtitle?: ReactNode;
  /** 标题右侧的状态徽章，通常传 <ToolBadge> */
  badge?: ReactNode;
  /** 顶栏右侧操作区：引擎下拉、历史记录按钮等 */
  actions?: ReactNode;
  /**
   * 「中控命令轨」：标题下方的一条白色工具栏，放模式切换、引擎选择等高频控件。
   * 传了就在标题与内容区之间渲染一条 command-rail 风格的横条。
   */
  rail?: ReactNode;
  /**
   * 内容区是否套一层带内边距的滚动容器（默认套）。
   * 满高双栏这类自己要管滚动的布局传 false。
   */
  scroll?: boolean;
  /** 追加类名 */
  contentClassName?: string;
  /** 浮层（历史记录等）。必须挂在根节点下 —— .history-overlay 靠 absolute 定位 */
  overlay?: ReactNode;
  children: ReactNode;
}

/**
 * 工具页统一外壳：顶栏（图标 + 标题 + 状态徽章 + 右侧操作）+ 内容区。
 * 遵循 Notion 极简暖灰阶桌面工作台规范。
 */
export default function ToolShell({
  icon: Icon,
  iconTone = "brand",
  title,
  subtitle,
  badge,
  actions,
  rail,
  scroll = true,
  contentClassName = "",
  overlay,
  children,
}: ToolShellProps) {
  return (
    <div className="relative flex h-full min-h-0 bg-[#FFFFFF] overflow-hidden text-[#191918]">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header
          /*
           * 顶栏高度固定 68px（保持 AGENTS.md 约束）：
           * 宽屏锁死 68px，标题过长截断，窄屏允许换行。
           * 底色为纯白，底边框为 1px solid #E6E6E3。
           */
          className="flex flex-wrap md:flex-nowrap h-auto md:h-[68px] gap-3 px-4 py-3 md:py-0 md:px-6 bg-[#FFFFFF] items-center justify-between flex-shrink-0 md:overflow-hidden"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* 炭黑圆角图标，移除彩光 */}
            <div
              className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${iconTone === "brand"
                  ? "bg-[#1C1C1C] text-white"
                  : "bg-[#F3F3F1] text-[#787774] border border-[#E6E6E3]"
                }`}
            >
              <Icon size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-[16px] font-bold tracking-[-0.2px] text-[#191918] leading-none truncate">
                  {title}
                </h2>
                {badge}
              </div>
              {subtitle && (
                <p className="text-xs text-[#787774] mt-1 truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {actions && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actions}
            </div>
          )}
        </header>

        {rail && (
          <div className="px-4 md:px-6 py-2.5 shrink-0 bg-[#F9F9F8] border-b border-[#E6E6E3]">
            <div className="bg-[#FFFFFF] border border-[#E6E6E3] rounded-lg px-3 py-1.5 flex items-center justify-between gap-3 flex-wrap">
              {rail}
            </div>
          </div>
        )}

        {scroll ? (
          <div
            className={`flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4 bg-[#FFFFFF] ${contentClassName}`}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </div>

      {overlay}
    </div>
  );
}
