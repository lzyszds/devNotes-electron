/**
 * Cherry 的大纲与阅读位置支持。
 *
 * 两个内核的正文结构不同，但标题都是真的 <h1>~<h6>，所以这里一律按 DOM 里的
 * 标题元素来定位与测量，与 readingBookmark 那套锚点换算共用同一套判据。
 *
 * 刻意**不**解析 markdown 源文本来取标题：Cherry 的双栏两侧是同一份内容的两种视图，
 * 文本匹配稍有出入就会与 DOM 里的标题对不上。直接按 DOM 顺序读渲染后的 h1~h6，
 * 跳转与测量就都在同一套坐标系里。
 */
import {
  collectHeadingElements,
  findActiveHeadingIndex,
  flashElement,
  jumpToBookmarkLanding,
  readPercentOf,
} from './readingBookmark'

/** Cherry 渲染后的正文区。双栏时是右侧预览，单栏时整个可见区 */
const PREVIEWER_SELECTOR = '.cherry-previewer'

/**
 * 当前可见的预览区元素，不可见时返回 null。
 *
 * `offsetParent === null` 是「自身或祖先 display:none」的可靠判据，且不用去读
 * getComputedStyle（那会强制同步布局）。Cherry 切单栏就是给预览区加 display:none。
 */
function cherryPreviewer(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null
  const previewer = root.querySelector<HTMLElement>(PREVIEWER_SELECTOR)
  if (!previewer || previewer.offsetParent === null) return null
  return previewer
}

/**
 * 用于算阅读进度与书签坐标的滚动容器。
 *
 * 预览区自己就是滚动容器（Cherry 在它上面设了 overflow），所以有它就用它 ——
 * 正文的阅读位置只跟预览区有关，源码区滚到哪无关紧要。
 * 预览区不可见（单栏编辑态）时返回 null：那会儿屏幕上没有渲染后的正文，
 * 既量不出进度，也没有可锚的标题。
 */
export function cherryScrollContainer(root: HTMLElement | null): HTMLElement | null {
  return cherryPreviewer(root)
}

/** 当前阅读进度与所在章节 */
export function measureCherryReading(root: HTMLElement | null): {
  container: HTMLElement | null
  activeIndex: number
  percent: number
  heading: string
} {
  const container = cherryScrollContainer(root)
  if (!container) return { container: null, activeIndex: -1, percent: 0, heading: '' }

  const headings = collectHeadingElements(container)
  const activeIndex = findActiveHeadingIndex(container, headings)
  return {
    container,
    activeIndex,
    percent: readPercentOf(container),
    heading: activeIndex >= 0 ? headings[activeIndex]?.textContent?.trim() ?? '' : '',
  }
}

/** 把某一节滚进视野并高亮，与 Milkdown 侧同一套视觉反馈 */
export function revealCherryOutlineItem(root: HTMLElement | null, index: number): void {
  const container = cherryScrollContainer(root)
  if (!container) return
  const target = collectHeadingElements(container)[index]
  if (!target) return
  // scroll-margin-top（index.css）会把标题推到工具栏下方，不会被盖住
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  flashElement(target)
}

/**
 * 跳转只需要「哪个标题 + 节内多深」这两样。
 *
 * 用最小结构而不是完整的 ReadingBookmark：总线上的跳转目标不带 id / percent
 * 这些只跟存储有关的字段（见 editorBus 的 ReadingJumpTarget），
 * 而 resolveReadingBookmark 本来也只读这两样。
 */
type JumpAnchor = { heading: string; offset: number }

/** 跳到书签位置并闪一下落点 */
export function jumpToCherryBookmark(root: HTMLElement | null, bookmark: JumpAnchor): void {
  const container = cherryScrollContainer(root)
  if (!container) return
  // 滚动 + 到位后高亮落点所在的那一块，两个内核共用同一条实现
  jumpToBookmarkLanding(container, bookmark)
}
