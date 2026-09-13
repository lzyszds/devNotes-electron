import { CHERRY_CLASS_SUFFIX } from './toolbarSpec'

/**
 * 自绘工具栏 → Cherry 的命令派发。
 *
 * Cherry 的原生工具栏被 CSS 压成 0 尺寸并 visibility:hidden，只保留布局盒当作
 * 命令入口与弹层锚点。由此带来两件事，本文件专门处理：
 *   1. 不能用 element.click() 打发 —— Cherry 绑的是 pointerdown/pointerup
 *   2. 弹层的默认落点是按原生按钮算的，必须按我们自己的按钮重新摆一次
 *
 * Milkdown 不需要这一套：它没有 UI 外壳，工具栏命令直连 ProseMirror 命令，
 * 见 milkdownCommands.ts。
 */

/** 把数值夹进 [min, max]；min > max 时以 min 为准 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** 弹层与视口边缘至少留出的间距 */
const POPUP_MARGIN = 8

/**
 * Cherry：合成一次指针手势点到隐形的原生按钮上。
 *
 * 关键点：Cherry 在支持 PointerEvent 的浏览器里绑的是
 *   button.addEventListener('pointerdown', () => { isPointerDown = true })
 *   button.addEventListener('pointerup',   (e) => { isPointerDown && onClick(e, name); isPointerDown = false })
 * 而不是 click（只有不支持 PointerEvent 的环境才退回 click）。
 * 所以 `button.click()` 在这里是空操作，必须按它的顺序补一对 pointer 事件。
 * 事件虽由隐藏元素发出，但 dispatchEvent 不受 visibility / pointer-events 影响，监听器照常触发。
 */
export function execCherryCommand(
  root: HTMLElement,
  menuName: string,
  anchor: HTMLElement | null
): void {
  const suffix = CHERRY_CLASS_SUFFIX[menuName]
  if (!suffix) return

  // 下拉项只有 cherry-dropdown-item，不带 cherry-toolbar-* 类，
  // 所以这个选择器命中的一定是顶层工具栏按钮，不会误伤下拉里的同名项。
  const button = root.querySelector<HTMLElement>(`.cherry-toolbar-button.cherry-toolbar-${suffix}`)
  if (!button) return

  if (typeof PointerEvent === 'function' && 'onpointerup' in window) {
    const base: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
    }
    button.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }))
    button.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }))
  } else {
    button.click()
  }

  // Cherry 的 toggleSubMenu 是同步的：派发返回时弹层已经 display:block 且带着错误坐标。
  // 这里同一帧改掉，用户看不到中间态。
  placeCherryPopup(root, anchor)
  // 少数菜单（导出、主题这类）内容要异步补齐尺寸，补一次兜底。幂等，重复调用无害。
  requestAnimationFrame(() => placeCherryPopup(root, anchor))
}

/**
 * 把 Cherry 刚打开的弹层挪到自绘按钮正下方。
 *
 * 原生按钮在折叠的工具栏里，offsetLeft 与我们按钮的 x 对不上，所以 Cherry 算出来的落点必然偏。
 * 它把弹层 append 到 .cherry（wrapperDom，position:relative），
 * 所以 left/top 是相对 .cherry 的坐标 —— 这里按「我们的按钮」重算一遍。
 *
 * 另外 CSS 里已把 .cherry-dropdown 的 margin-left 归零，
 * 于是 left 就是弹层左边缘（Cherry 原本把它当中心线用）。
 */
export function placeCherryPopup(root: HTMLElement, anchor: HTMLElement | null): void {
  if (!anchor) return

  const wrapper = root.querySelector<HTMLElement>('.cherry')
  if (!wrapper) return

  const opened = Array.from(root.querySelectorAll<HTMLElement>('.cherry-dropdown')).filter(
    (el) => el.style.display === 'block'
  )
  if (opened.length === 0) return

  const wrapperRect = wrapper.getBoundingClientRect()
  const anchorRect = anchor.getBoundingClientRect()

  for (const dropdown of opened) {
    const width = dropdown.offsetWidth || 148
    const left = clamp(
      anchorRect.left,
      wrapperRect.left + POPUP_MARGIN,
      wrapperRect.right - width - POPUP_MARGIN
    )
    dropdown.style.left = `${left - wrapperRect.left}px`
    dropdown.style.top = `${anchorRect.bottom - wrapperRect.top}px`
  }
}
