import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '../../../lib/utils'

/*
 * shadcn Dialog（vanilla 源码 + 本项目外观微调）。
 *
 * 与项目既有手写浮层的差异说明：
 *  - Radix 自带 Presence：data-[state=closed] 的退出动画播完才真正卸载，
 *    所以「关闭也有动画」不再依赖 usePresence 的挂卸编排；
 *  - Esc 关闭/焦点圈/滚动锁定/Portal 由 Radix 托管，各调用方不再自抄 keydown；
 *  - 动画 token（overlay-show/hide、content-show/hide）与时长定义在
 *    tailwind.config，节奏与手写浮层时期的 fe-fade/fe-modal 一致。
 * 差异点仅保留在有意的位置：遮罩 bg-black/40 + backdrop-blur-2xs（原设计），
 * 面板默认 rounded-2xl + shadow-2xl + border-[#E6E6E3]（原卡片语言）。
 *
 * Select / 二级菜单会 portal 到 body（.fe-pop）。Radix 把这当成「点了对话框外」，
 * 默认 preventDefault，选项的 click 根本到不了 —— 设置里模型下拉点了没反应就是这个。
 */

/** 点在挂到 body 的浮层上时，别让 Dialog 当成外部交互吞掉 */
function isPortaledPopoverTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('.fe-pop') ||
      target.closest('.context-menu') ||
      target.closest('[data-devnotes-portal]') ||
      target.closest('[role="listbox"]') ||
      target.closest('[data-radix-select-viewport]') ||
      target.closest('[data-radix-popper-content-wrapper]'),
  )
}

/** Radix Outside 事件挂在 originalEvent.target 上；兼容 detail 与直接 target */
function outsideEventTarget(
  event: { target: EventTarget | null; detail?: { originalEvent?: Event } },
): EventTarget | null {
  return event.detail?.originalEvent?.target ?? event.target
}

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-[60] bg-black/40 backdrop-blur-2xs',
      'data-[state=open]:animate-overlay-show data-[state=closed]:animate-overlay-hide',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /**
   * 是否渲染右上角的原生关闭按钮。自定义头部（如预览弹窗的卡片式标题条）
   * 用 DialogClose 自绘 X 时传 false，避免出现两颗关闭按钮。
   */
  showClose?: boolean
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      showClose = true,
      onPointerDownOutside,
      onInteractOutside,
      onFocusOutside,
      ...props
    },
    ref,
  ) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-[60] w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
          /*
           * overflow-hidden 必须有：否则圆角只画在外壳 border 上，里头顶栏/白底
           * 仍是直角，角上会露出一圈「圆角描边 + 直角内容」的错位台阶。
           */
          'flex flex-col overflow-hidden rounded-2xl border border-[#E6E6E3] bg-white shadow-2xl',
          'data-[state=open]:animate-content-show data-[state=closed]:animate-content-hide',
          className,
        )}
        onPointerDownOutside={(event) => {
          if (isPortaledPopoverTarget(outsideEventTarget(event))) {
            event.preventDefault()
          }
          onPointerDownOutside?.(event)
        }}
        onInteractOutside={(event) => {
          if (isPortaledPopoverTarget(outsideEventTarget(event))) {
            event.preventDefault()
          }
          onInteractOutside?.(event)
        }}
        onFocusOutside={(event) => {
          if (isPortaledPopoverTarget(outsideEventTarget(event))) {
            event.preventDefault()
          }
          onFocusOutside?.(event)
        }}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 rounded-lg p-1 text-[#787774] transition-colors hover:bg-accent hover:text-[#191918] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label="关闭"
          >
            <X size={15} />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
)
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 text-center sm:text-left', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2', className)} {...props} />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold leading-none tracking-tight text-[#191918]', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-xs text-[#787774]', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
