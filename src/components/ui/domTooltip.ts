/**
 * 命令式悬浮提示：接管**第三方组件自己渲染出来的 DOM**（Cherry 的工具栏与弹层）。
 *
 * 为什么不能直接用 Tooltip.tsx：那个组件靠 cloneElement 给「React 渲染出来的子元素」挂事件与 ref，
 * 而编辑器的按钮是它们自己 createElement 出来的，React 根本不认识这些节点，挂不上去。
 *
 * 做法：把第三方元素上的提示文案（aria-label / title）搬到一个 `data-qtip` 属性上，
 * 再用事件委托 + 一个挂在 body 上的单例气泡统一显示，样式复用 index.css 里的 `.tooltip-bubble`，
 * 观感与 React 版完全一致。
 *
 * 两个必须处理的坑：
 * - 第三方用 `aria-label` 当无障碍名称时**只能关掉它的视觉气泡，不能删属性**（靠调用方传 nativeOffClass）
 * - Cherry 的原生 `title` 会弹出系统灰框，必须**摘掉**，否则和我们自己的气泡一起冒出来
 */

import { TOOLTIP_DELAY, computeTooltipPosition } from './tooltipPosition'

export interface AttachDomTooltipsOptions {
  /** 命中这些元素才接管，例：'.cherry-toolbar [title], .cherry-dropdown [title]' */
  selector: string
  /** 加到容器根上的类名，用来关掉第三方自带的 CSS 气泡 */
  nativeOffClass?: string
}

interface Session {
  container: HTMLElement
  options: AttachDomTooltipsOptions
  observer: MutationObserver
  /** 已处理过的元素 → 它原本的 title（'' 表示本来就没有），dispose 时按此还原 */
  processed: Map<HTMLElement, string>
  rafId: number | null
}

/** 当前已挂载的接管会话，用于判断全局监听该不该拆 */
const sessions = new Set<Session>()

// ---------------------------------------------------------------- 单例气泡

let host: HTMLDivElement | null = null
let bubble: HTMLDivElement | null = null

function ensureBubble(): void {
  if (host && bubble && host.isConnected) return

  host = document.createElement('div')
  host.className = 'pointer-events-none fixed z-[90]'
  host.style.opacity = '0'

  bubble = document.createElement('div')
  bubble.className = 'tooltip-bubble'
  bubble.setAttribute('role', 'tooltip')

  host.appendChild(bubble)
  document.body.appendChild(host)
}

/** 正在显示提示的元素 */
let activeEl: HTMLElement | null = null
/** 已排期但还没到时间弹出的元素 */
let pendingEl: HTMLElement | null = null
let timerId: number | null = null
/** 鼠标按下过就抑制随后的 focus 弹出，否则「点一下按钮」会顺带弹一个提示出来 */
let suppressFocus = false

function clearTimer(): void {
  if (timerId !== null) {
    window.clearTimeout(timerId)
    timerId = null
  }
}

function hide(): void {
  clearTimer()
  pendingEl = null
  activeEl = null
  if (host) host.style.opacity = '0'
}

function show(el: HTMLElement): void {
  const text = el.dataset.qtip
  if (!text) return

  ensureBubble()
  const node = bubble!
  node.textContent = text

  // 气泡是复用的同一个节点，不重放动画的话第二次就不淡入了
  node.style.animation = 'none'
  void node.offsetWidth
  node.style.animation = ''

  // 先量尺寸再定位，且全程同步完成，不会闪在错误位置
  const anchor = el.getBoundingClientRect()
  const { top, left } = computeTooltipPosition(anchor, node.getBoundingClientRect())
  host!.style.top = `${top}px`
  host!.style.left = `${left}px`
  host!.style.opacity = '1'
}

function scheduleShow(el: HTMLElement): void {
  // 在同一个元素的子节点之间移动会反复触发 mouseover，不能因此重置计时器
  if (activeEl === el || pendingEl === el) return
  clearTimer()
  pendingEl = el
  timerId = window.setTimeout(() => {
    timerId = null
    pendingEl = null
    // 延迟期间元素可能已经卸载（切换内核、关闭浮层）
    if (el.isConnected) {
      activeEl = el
      show(el)
    }
  }, TOOLTIP_DELAY)
}

// ---------------------------------------------------------------- 事件委托

function findTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  const el = node.closest('[data-qtip]')
  return el instanceof HTMLElement ? el : null
}

function onMouseOver(event: MouseEvent): void {
  const el = findTarget(event.target)
  if (el) scheduleShow(el)
}

function onMouseOut(event: MouseEvent): void {
  const el = findTarget(event.target)
  if (!el) return
  // 移到自己的子节点不算离开
  const related = event.relatedTarget
  if (related instanceof Node && el.contains(related)) return
  if (el === pendingEl || el === activeEl) hide()
}

function onMouseDown(event: MouseEvent): void {
  // 已经点下去了就不必再解释它是什么，顺手收起
  if (findTarget(event.target)) {
    suppressFocus = true
    hide()
  }
}

function onFocusIn(event: Event): void {
  if (suppressFocus) return
  const el = findTarget(event.target)
  if (el) scheduleShow(el)
}

function onFocusOut(event: Event): void {
  suppressFocus = false
  const el = findTarget(event.target)
  if (el && (el === activeEl || el === pendingEl)) hide()
}

function startListening(): void {
  // 挂在 document 上而不是容器上：Cherry 全屏时工具栏节点可能被整体搬走，
  // 只认 data-qtip 标记就不会因此失灵
  document.addEventListener('mouseover', onMouseOver, true)
  document.addEventListener('mouseout', onMouseOut, true)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  // 显示期间位置随时可能失效：滚动、改窗口大小、切走窗口，一律收起
  window.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
  window.addEventListener('blur', hide)
}

function stopListening(): void {
  document.removeEventListener('mouseover', onMouseOver, true)
  document.removeEventListener('mouseout', onMouseOut, true)
  document.removeEventListener('mousedown', onMouseDown, true)
  document.removeEventListener('focusin', onFocusIn, true)
  document.removeEventListener('focusout', onFocusOut, true)
  window.removeEventListener('scroll', hide, true)
  window.removeEventListener('resize', hide)
  window.removeEventListener('blur', hide)
}

// ---------------------------------------------------------------- 文案搬运

function prepare(session: Session, el: HTMLElement): void {
  const aria = el.getAttribute('aria-label')
  const title = el.getAttribute('title')
  const text = (aria || title || '').trim()
  if (!text) return

  if (el.dataset.qtip !== text) el.dataset.qtip = text

  if (title !== null) {
    // 原始 title 先存下来，Cherry 的那个必须摘掉，否则会和我们自己的气泡叠在一起弹系统灰框
    if (!session.processed.has(el)) session.processed.set(el, title)
    el.removeAttribute('title')
  } else if (!session.processed.has(el)) {
    session.processed.set(el, '')
  }
}

function scan(session: Session): void {
  session.container.querySelectorAll(session.options.selector).forEach((node) => {
    if (node instanceof HTMLElement) prepare(session, node)
  })
}

// ---------------------------------------------------------------- 对外入口

/**
 * 接管 `container` 子树里第三方渲染的提示。
 * 返回 dispose 函数；同一容器重复 attach 是幂等的。
 */
export function attachDomTooltips(
  container: HTMLElement,
  options: AttachDomTooltipsOptions
): () => void {
  const session: Session = {
    container,
    options,
    processed: new Map(),
    rafId: null,
    observer: new MutationObserver(() => {
      // 合并同一帧内的多次变更，避免 Cherry 批量建按钮时反复全量扫描
      if (session.rafId !== null) return
      session.rafId = window.requestAnimationFrame(() => {
        session.rafId = null
        scan(session)
      })
    }),
  }

  if (options.nativeOffClass) container.classList.add(options.nativeOffClass)

  // 工具栏可能是异步建出来的（Cherry 要等内核初始化），所以先扫一遍再挂观察者
  scan(session)
  session.observer.observe(container, {
    childList: true,
    subtree: true,
    // 全屏按钮之类会改自身 title，跟着重新搬运
    attributes: true,
    attributeFilter: ['title'],
  })

  if (sessions.size === 0) startListening()
  sessions.add(session)

  return () => {
    if (!sessions.has(session)) return
    sessions.delete(session)

    session.observer.disconnect()
    if (session.rafId !== null) window.cancelAnimationFrame(session.rafId)
    if (options.nativeOffClass) container.classList.remove(options.nativeOffClass)

    // 正在显示的就是这个容器里的元素，先收起来再还原属性
    if (activeEl && container.contains(activeEl)) hide()

    session.processed.forEach((originalTitle, el) => {
      delete el.dataset.qtip
      if (originalTitle) el.setAttribute('title', originalTitle)
    })
    session.processed.clear()

    if (sessions.size === 0) {
      hide()
      stopListening()
    }
  }
}
