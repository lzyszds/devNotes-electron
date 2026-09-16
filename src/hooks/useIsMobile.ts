import { useEffect, useState } from 'react'

// 与 Tailwind 的 md 断点对齐：< 768px 视为移动端
const MOBILE_QUERY = '(max-width: 767px)'

/** 监听视口是否处于移动端宽度，用于切换移动端外壳布局 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
