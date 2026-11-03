import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '../../../lib/utils'

/*
 * shadcn Tooltip（vanilla）。注意：这是给新代码用的原语，
 * 现有 ui/Tooltip.tsx（40 处调用、cloneElement 定位 + placement 支持）
 * 保留原样 —— 迁移期两套并存，老用法不动，避免一次改 40 个文件。
 */

// Provider 单独导出，供设置 delayDuration / skipDelayDuration 全局节奏
const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[90] overflow-hidden rounded-lg bg-[#1C1C1C] px-2.5 py-1.5 text-xs text-white shadow-md',
        'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
