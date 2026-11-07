import React, { useCallback, useRef, useState } from 'react'
import { ScanEye, X } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogTitle } from './shadcn/dialog'
import CopyButton from './CopyButton'
import { iconButtonClass } from './ToolKit'

/**
 * 一键预览弹窗：把工具里任意「输入 / 解析结果 / 输出 / 日志」原样放进一个
 * 全屏面板里看全文 —— 列表有截断、行有省略、表格只盯得下一段的时候用。
 *
 * 内核已经换成 shadcn Dialog（Radix）：Esc / 点遮罩关闭 / Portal / 焦点圈 /
 * 退出动画全部由原语托管，本组件不再是又一份手写 keydown 的浮层。
 * 视觉保持应用卡片面板：灰背 44px 标题条 + 白身 + 灰脚，外壳 class 原样保留。
 */
export interface PreviewModalState {
  /** 面板标题，如「解析结果」 */
  title: string
  /** 预览正文。就是字符串 —— 排版交给 whitespace-pre-wrap，不二次加工 */
  content: string
  /** 出处说明（如来源工具名），显示在标题右侧的小徽章里，可不传 */
  source?: string
}

export const PreviewModal = React.memo(function PreviewModal({
  state,
  onClose,
}: {
  state: PreviewModalState | null
  onClose: () => void
}) {
  /*
   * Radix 退出动画期间会继续渲染 content，但彼时 state 已经是 null ——
   * 用 ref 捏住最后一次非空内容，退出动画播的是原内容而不是空白。
   */
  const last = useRef<PreviewModalState | null>(state)
  if (state) last.current = state
  const shown = state ?? last.current

  const open = state != null
  const setClosed = useCallback(() => onClose(), [onClose])

  if (!shown) {
    // 从未打开过：Dialog 里没有可显示的东西（open 恒 false 不会真正渲染）
    return (
      <Dialog open={false}>
        <div />
      </Dialog>
    )
  }

  const text = shown.content
  const lineCount = text ? text.split('\n').length : 0
  const charCount = text.length

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        className="w-full max-w-3xl h-[86vh] max-h-[760px] p-0 gap-0 overflow-hidden"
      >
        {/* 标题条：同卡片头部设计的灰背 44px 条 */}
        <div className="flex items-center justify-between gap-2 px-3.5 h-[44px] shrink-0 border-b border-[#E6E6E3] bg-[#FBFBFA]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#1C1C1C] shrink-0" />
            <DialogTitle className="text-xs font-bold text-[#191918] truncate">
              {shown.title || '内容预览'}
            </DialogTitle>
            {shown.source && (
              <span className="h-5 px-1.5 shrink-0 rounded-full border border-[#E6E6E3] bg-white text-[10px] text-[#787774] flex items-center">
                {shown.source}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <CopyButton value={text} disabled={charCount === 0} />
            <DialogClose
              className={`${iconButtonClass('neutral')} cursor-pointer`}
              aria-label="关闭预览"
            >
              <X size={15} />
            </DialogClose>
          </div>
        </div>

        {/* 正文：全文铺排，换行保留但不撕单词 */}
        <div className="flex-1 min-h-0 overflow-auto p-4 select-text">
          {charCount === 0 ? (
            <div className="h-full flex items-center justify-center text-[11px] text-[#787774]/60">
              这里没有内容
            </div>
          ) : (
            <pre className="m-0 font-mono text-[12.5px] leading-6 whitespace-pre-wrap break-words text-[#191918]">
              {text}
            </pre>
          )}
        </div>

        {/* 页脚：同卡片底部设计的灰细条 */}
        <div className="px-3.5 h-8 shrink-0 border-t bg-[#FBFBFA] flex items-center justify-between text-[10px] text-[#787774] tabular-nums">
          <span>
            {lineCount} 行 · {charCount.toLocaleString()} 字符
          </span>
          <button
            type="button"
            onClick={setClosed}
            className="cursor-pointer transition-colors hover:text-[#191918]"
          >
            关闭（Esc）
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
})

/**
 * 自带弹窗的预览按钮 —— 集成一行搞定。
 *
 * 弹窗状态收在按钮自己体内：调用方不用接 state / 不用渲染 modal，
 * 往卡片头部设计的 actions 槽里并排放一个 <PreviewButton …> 即可。
 * content 传函数可延迟取值（与 CopyButton 的 value 同一个思路，
 * 渲染期不用为了这个按钮拼一遍大字符串）。
 */
export const PreviewButton = React.memo(function PreviewButton({
  title,
  content,
  source,
  disabled = false,
  className = '',
}: {
  title: string
  /** 预览正文或取值函数（点击时才读，拿到的是当下最新值） */
  content: string | (() => string)
  /** 标题旁的出处徽章（选填） */
  source?: string
  disabled?: boolean
  className?: string
}) {
  const [state, setState] = useState<PreviewModalState | null>(null)

  const handleOpen = useCallback(() => {
    const text = typeof content === 'function' ? content() : content
    setState({ title, content: text, source })
  }, [content, title, source])

  return (
    <>
      <button
        type="button"
        title="一键预览全文"
        aria-label="一键预览全文"
        onClick={handleOpen}
        disabled={disabled}
        className={`${iconButtonClass('neutral')} cursor-pointer ${className}`}
      >
        <ScanEye size={15} />
      </button>
      <PreviewModal state={state} onClose={() => setState(null)} />
    </>
  )
})
