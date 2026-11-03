import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../../lib/utils'

/*
 * shadcn Button（vanilla 源码 + 本项目 token 微调）。
 *
 * 外观对齐现设计的 BTN 常量：h-8 / rounded-lg / #1C1C1C 主按钮 /
 * active 轻按压。语义色来自 tailwind.config 的 shadcn token 段 ——
 * primary=#1C1C1C、accent=#F3F3F1、border=#E6E6E3，改一处全局生效。
 */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] cursor-pointer [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-[#1C1C1C] text-white shadow-xs hover:bg-black',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline: 'border border-border bg-background shadow-xs hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground border border-border hover:bg-accent',
        ghost: 'hover:bg-accent',
        link: 'text-brand-600 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-4',
        sm: 'h-7 rounded-md px-2.5 text-xs',
        lg: 'h-10 rounded-lg px-6',
        icon: 'size-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...(asChild ? {} : { type: type ?? 'button' })}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
