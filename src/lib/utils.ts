import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn 官方的 cn 组合器：clsx 处理条件拼接，tw-merge 处理同组冲突
 * （`px-2.5 px-4` 只认后者），给定时写活「默认样式 + 调用方覆盖」。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
