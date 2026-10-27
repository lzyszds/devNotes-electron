/**
 * 全局按钮点击涟漪（Material 式，配色按本应用的暖灰调）。
 *
 * 果冻系列（缩放/扭动）弃用了：小图标按钮一缩就变形，而且「何时回弹」的
 * 手感怎么调都不对。涟漪完全不碰按钮的形状与布局 —— 从指针落点绽开一圈
 * 淡墨水波，扩散淡出后自删；深色按钮（炭黑主按钮等）自动换白色涟漪。
 *
 * 实现：pointerdown 往按钮里塞一个绝对定位的圆 span，WAAPI 播完自删；
 * 按钮的 position:relative / overflow:hidden（涟漪贴圆角裁切的关键）由
 * index.css 的 button 基础规则兜底 —— Tailwind v3 下 .absolute /
 * .overflow-visible 这类工具类按特异性照常能覆盖它。
 */
const RIPPLE_DURATION = 500

function spawnRipple(
  button: HTMLButtonElement,
  clientX: number,
  clientY: number
): void {
  const rect = button.getBoundingClientRect()
  // 直径取按钮长边 2.2 倍：无论从哪个角落点下去，圆都铺得满整个按钮
  const size = Math.max(rect.width, rect.height) * 2.2

  // 深色按钮上黑涟漪看不见：按背景亮度换白色（透明/半透明底按与白纸面混合后算）
  const bg = getComputedStyle(button).backgroundColor
  const nums = bg.match(/[\d.]+/g)?.map(Number) ?? []
  const alpha = nums.length >= 4 ? nums[3] : 1
  const lightness =
    nums.length >= 3
      ? (nums[0] * 0.299 + nums[1] * 0.587 + nums[2] * 0.114) * alpha +
        255 * (1 - alpha)
      : 255
  const color =
    lightness < 128 ? 'rgba(255, 255, 255, 0.35)' : 'rgba(28, 28, 28, 0.10)'

  const ripple = document.createElement('span')
  ripple.style.cssText = [
    'position: absolute',
    'border-radius: 9999px',
    'pointer-events: none',
    `width: ${size}px`,
    `height: ${size}px`,
    `left: ${clientX - rect.left - size / 2}px`,
    `top: ${clientY - rect.top - size / 2}px`,
    `background: ${color}`,
  ].join(';')
  button.appendChild(ripple)

  ripple
    .animate(
      [
        { transform: 'scale(0)', opacity: 1 },
        { transform: 'scale(1)', opacity: 0 },
      ],
      { duration: RIPPLE_DURATION, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
    )
    .addEventListener('finish', () => ripple.remove())
}

export function installClickRipple(): void {
  if (typeof document === 'undefined') return

  document.addEventListener(
    'pointerdown',
    (e) => {
      // 只响应主键（左键 / 触屏主输入），右键菜单不算点击
      if (e.button !== 0) return
      // 系统开了「减少动态效果」就不动，尊重无障碍设置
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      const target = e.target as HTMLElement | null
      const button = target?.closest?.('button') as HTMLButtonElement | null
      // 禁用态不弹，与视觉上的不可用保持一致
      if (!button || button.disabled) return

      // 复选框与开关属于高频状态切换微控件，不走按钮涟漪，避免强制重排与动画竞争导致卡顿
      const role = button.getAttribute('role')
      if (
        role === 'checkbox' ||
        role === 'switch' ||
        button.hasAttribute('data-no-ripple') ||
        button.closest('[role="checkbox"]') ||
        button.closest('[role="switch"]')
      ) {
        return
      }

      spawnRipple(button, e.clientX, e.clientY)
    },
    // 捕获阶段：按钮内部 stopPropagation 也不影响触发
    true
  )
}
