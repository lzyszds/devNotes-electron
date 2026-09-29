/**
 * 定位一个位置所需的最小信息。
 *
 * 抽出来是因为「跳转」与「存储」要的字段不一样：存储的 ReadingBookmark 还带
 * id / percent / at 这些只跟合并与展示有关的字段，而换算坐标只看标题与偏移。
 * 让换算函数只收它真正用到的两个字段，调用方（比如总线上的跳转目标）就不必
 * 凭空造一份完整书签出来。
 */
export type BookmarkAnchor = Pick<
  ReadingBookmark,
  'heading' | 'offset' | 'blockIndex' | 'blockText'
>

/**
 * 阅读位置书签：把「我现在读到哪」在「滚动容器」与「可存储的锚点」之间来回换算。
 *
 * 存的是锚点而非 scrollTop —— 理由见 notesStore 里 ReadingBookmark 的注释。
 * 这里只做纯换算，不碰 React、不碰存储，好让两个编辑器内核共用同一套判定。
 *
 * 两个内核的正文结构不同（Cherry 是 `.cherry-previewer` / CodeMirror，Milkdown 是
 * ProseMirror 的 contenteditable），但标题都是真的 `<h1>`~`<h6>` 元素，所以锚点
 * 一律以「第 n 个标题 + 该标题内的偏移比例」表达，两边都吃得下。
 */
import type { ReadingBookmark } from './notesStore'

/** 与大纲的判定口径保持一致：标题顶边进入容器顶部这么多像素内，就算读到了 */
const ACTIVE_OFFSET = 140

/**
 * 跳转后目标上方要留出的空间。
 *
 * 格式工具栏（h-10 = 40px）压在正文上方，贴着容器顶边跳过去会被它盖住一截。
 * 这个值要与 index.css 里 `.fe-outline-flash { scroll-margin-top }` 保持一致 ——
 * 那里管「浏览器自己的滚动」（scrollIntoView），这里管「我们手算的 scrollTo」，
 * 两条路径都得留出同样的空间，否则大纲跳转和书签跳转的落点会差一截。
 */
export const SCROLL_MARGIN = 56

/**
 * 等 smooth 滚动停下来再高亮。
 *
 * 滚动期间视口一直在动，这时用坐标取元素会命中错误的一块（见 blockAtContentPoint）。
 * 长度取略大于浏览器 smooth 滚动的实际耗时，保证取元素时画面已经停稳。
 */
export const SCROLL_SETTLE_MS = 480

/** 高亮停留时长。要长于 CSS 动画（900ms），否则动画没跑完 class 就被摘了 */
const FLASH_KEEP_MS = 1100

/**
 * 闪一下某个元素，让跳转的落点看得见。两个内核共用同一套视觉反馈。
 *
 * 先摘 class、强制一次 reflow、再加回去 —— 否则对**同一个元素**连续闪两次时，
 * 第二次加 class 是空操作（class 已经在身上），浏览器不会重新播动画，
 * 表现就是「第一次能闪、之后再点不闪了」。
 */
export function flashElement(el: HTMLElement | null | undefined): void {
  if (!el) return
  el.classList.remove('fe-outline-flash')
  // 读一次布局属性强制 reflow，让上面那次移除立即生效
  void el.offsetWidth
  el.classList.add('fe-outline-flash')
  window.setTimeout(() => el.classList.remove('fe-outline-flash'), FLASH_KEEP_MS)
}

/**
 * 容器里的全部标题元素，按文档序。
 *
 * 传进来的必须是**正文滚动容器**（Milkdown 是 .milkdown-scroll，Cherry 是
 * .cherry-previewer）。这两个容器里只有正文，右侧大纲胶囊是它们的兄弟节点、
 * 不在其内 —— 所以这里不需要额外排除导航类元素。胶囊里那个「本文目录大纲」
 * 用的是真 <h3>，若哪天把胶囊挪进容器内，这里就会多算一个标题。
 */
export function collectHeadingElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
}

/**
 * 找出当前读到哪个标题（返回下标），没有标题返回 -1。
 *
 * 判据是「标题顶部越过容器顶部往下 ACTIVE_OFFSET 像素」的最后一个 ——
 * 越靠后的越新，所以顺序遍历取最后一个满足的即可。
 */
export function findActiveHeadingIndex(
  container: HTMLElement,
  headings: HTMLElement[]
): number {
  if (!headings.length) return -1
  const containerTop = container.getBoundingClientRect().top
  let active = 0
  headings.forEach((el, index) => {
    if (el.getBoundingClientRect().top - containerTop <= ACTIVE_OFFSET) active = index
  })
  return active
}

/** 当前阅读进度 0~100 */
export function readPercentOf(container: HTMLElement): number {
  const max = container.scrollHeight - container.clientHeight
  if (max <= 0) return 100
  return Math.min(100, Math.max(0, Math.round((container.scrollTop / max) * 100)))
}

/**
 * 抓取当前阅读位置。返回 null 表示这里没有可锚的章节。
 *
 * 记的是**容器顶边**落在哪一节、节内多深，而不是某一节的标题。
 *
 * 光标落在第一个标题**之前**（引言、封面区）时没有可锚的标题 ——
 * 这种位置存下来只能在「回到顶部」和「跳到第一章」之间二选一，都是错的，
 * 所以返回 null，由调用方提示「请先滚到正文再记录」。
 */
export function captureReadingBookmark(
  container: HTMLElement,
  id: string,
  note?: string
): ReadingBookmark | null {
  const headings = collectHeadingElements(container)
  if (!headings.length) return null

  /*
   * 用「容器顶边所在的**那一节**」来算 offset，而不是拿当前高亮的那一节去量。
   *
   * 这两者在长文里会分道扬镳：一节只有几百像素、而屏幕能显示一节多的文档里，
   * 容器顶边早已进入下一节，高亮却仍是上一节的标题。若按高亮那节算，
   * scrolledPast 会超过 span、offset 被夹到 1，跳回来就落在这一节的开头（差出几百像素）。
   */
  const section = locateSection(headings, container, container.scrollTop)
  if (!section.heading) return null
  /*
   * 标记要标在「容器顶边所在的那一块」上 —— 那正是用户此刻读到的地方。
   * 取不到（比如顶边落在两块之间的空白上）就不带块标识，标记不显示，
   * 但书签本身照旧能记、能跳。
   */
  const block = blockAtContentPoint(container, container.scrollTop) ?? undefined
  return buildBookmark(id, container, section, note, block)
}

/**
 * 按**某个正文块**抓一条书签（块手柄那颗按钮走这条）。
 *
 * 锚点仍然是「章节 + 节内偏移」，只是基准从「容器顶边」换成「这一块的顶边」——
 * 于是点哪一段就落在哪一段，而不是落在当前滚动到的位置。数据模型不变，
 * 跨设备同步、标题文本兜底那一套原样生效。
 *
 * 块在第一个标题**之前**（封面、引言区）时无处可锚，返回 null。
 */
export function captureBlockBookmark(
  container: HTMLElement,
  block: HTMLElement,
  id: string,
  note?: string
): ReadingBookmark | null {
  const headings = collectHeadingElements(container)
  if (!headings.length) return null

  const blockTop = absoluteTop(block, container)
  const section = locateSection(headings, container, blockTop)
  if (section.heading === null) return null
  return buildBookmark(id, container, section, note, block)
}

/**
 * 把「落在哪一节、节内多深」组装成一条书签。两条 capture 路径共用。
 *
 * `block` 是这一次记书签时命中的那一块（可选）。带上它，正文左侧才能标出
 * 「这儿有书签」——只存章节目录的话，正文里无从知道该标在哪一段上。
 */
function buildBookmark(
  id: string,
  container: HTMLElement,
  section: { heading: HTMLElement; offset: number },
  note?: string,
  block?: HTMLElement
): ReadingBookmark {
  const identity = block ? blockIdentity(container, block) : null
  return {
    id,
    heading: section.heading.textContent?.trim() || '(空标题)',
    level: Number(section.heading.tagName[1]) || 1,
    offset: section.offset,
    percent: readPercentOf(container),
    ...(note && note.trim() ? { note: note.trim().slice(0, 200) } : {}),
    ...(identity ?? {}),
    at: Date.now(),
  }
}

/**
 * 一块在正文里的身份：第几个顶层块 + 开头那段文字。
 *
 * 两者缺一不可：序号定位快、但正文里插删段落会让它整体错位；
 * 文本能校验序号是否还指着原来那一块（段落被改了也能靠它找回来）。
 * 与「下标 + 标题文本」是同一个思路，只是这里作用在块上。
 */
function blockIdentity(
  container: HTMLElement,
  block: HTMLElement
): { blockIndex: number; blockText: string } | null {
  const blocks = collectBlocks(container)
  const index = blocks.indexOf(block)
  if (index < 0) return null
  return { blockIndex: index, blockText: blockTextOf(block) }
}

/** 一块的文本指纹：开头若干字，够区分同一篇里的不同段落即可 */
function blockTextOf(block: HTMLElement): string {
  return (block.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
}

/**
 * 正文里的全部顶层块，按文档序。
 *
 * 与 collectHeadingElements 一样，只认正文容器内的元素 ——
 * 大纲胶囊、块手柄都是它的兄弟节点，不在其内。
 */
function collectBlocks(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  const content = container.querySelector<HTMLElement>('.milkdown-content, .cherry-previewer')
  const scope = content ?? container
  return Array.from(scope.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !el.hasAttribute('data-fe-ignore-block')
  )
}

/**
 * 把一条书签落到正文里对应的那一块上，供左侧标记使用。
 *
 * 先按序号取，再用文本校验；对不上就全篇按文本找一遍。
 * 找不到返回 null —— 标记不显示，但书签本身照旧可用（跳转不依赖它）。
 */
export function findBookmarkBlock(
  container: HTMLElement | null,
  bookmark: Pick<ReadingBookmark, 'blockIndex' | 'blockText'>
): HTMLElement | null {
  if (!container) return null
  if (bookmark.blockIndex === undefined || bookmark.blockText === undefined) return null

  const blocks = collectBlocks(container)
  const byIndex = blocks[bookmark.blockIndex]
  if (byIndex && blockTextOf(byIndex) === bookmark.blockText) return byIndex

  // 序号错位（正文里插删过段落）：按文本全篇找一遍，取第一个对得上的
  return blocks.find((block) => blockTextOf(block) === bookmark.blockText) ?? null
}

/**
 * 某个位置（内容坐标）落在哪一节、节内多深。与当前滚动位置无关。
 *
 * 判据是「这一节的顶边在该位置之上」——取最后一个满足的标题，
 * 那个位置就落在它的节里。这样 offset 天然落在 [0,1)，与 resolveReadingBookmark 严格互逆。
 *
 * 不用 ACTIVE_OFFSET（那是给「当前读到哪一节」的高亮用的参考线，带 140px 容差）——
 * 带容差会把「位置其实还在这一节上方」也算进来，offset 变负数被夹到 0，
 * 往返就不再精确。
 *
 * 位置在第一个标题**之前**时返回 null：那种地方没有可锚的章节，
 * 存下来只能在「回到顶部」和「跳到第一章」之间二选一，都是错的。调用方据此提示用户。
 */
function locateSection(
  headings: HTMLElement[],
  container: HTMLElement,
  anchor: number
): { heading: HTMLElement; offset: number } | { heading: null; offset: 0 } {
  let index = -1
  for (let i = 0; i < headings.length; i++) {
    if (absoluteTop(headings[i], container) <= anchor) index = i
  }
  if (index < 0) return { heading: null, offset: 0 }

  const heading = headings[index]
  const scrolledPast = Math.max(0, anchor - absoluteTop(heading, container))
  const span = headingSpan(heading, headings, container)
  return { heading, offset: Math.min(1, scrolledPast / span) }
}

/**
 * 一个标题「管到哪」：从它自己到下一个标题之间的高度。
 *
 * 用下一个标题算跨度而不是拿整篇高度，是为了让 offset 描述的是「这一节里读到哪」——
 * 否则长文档里 0.1 的差可能跨越好几节。
 */
function headingSpan(
  heading: HTMLElement,
  headings: HTMLElement[],
  container: HTMLElement
): number {
  const index = headings.indexOf(heading)
  const next = index >= 0 ? headings[index + 1] : undefined

  /*
   * 全部用**内容坐标**（绝对位置 = 视口位置 - 容器视口位置 + scrollTop），
   * 不用 getBoundingClientRect 的视口差值 —— 后者随滚动变化，
   * 让 span 变成滚动的函数，offset 就不再是位置的线性量，resolve 会算错。
   *
   * 有下一节：跨度取到下一个标题的顶边，并减掉它的 margin-top ——
   * 那段「下一节的抬头空白」（项目里 h2 约 60px）不属于本节内容，
   * 不减掉会让本节跨度虚增、offset 偏小，跳回来落在偏上的地方。
   */
  const headingTop = absoluteTop(heading, container)
  if (next) {
    const nextTop = absoluteTop(next, container)
    return Math.max(1, nextTop - headingTop - headingMarginTop(next))
  }

  /*
   * 最后一节：没有下一个标题可量，用「距正文内容底部还有多远」。
   *
   * 此前这里用 `heading.height + innerHeight * 0.6`，那个值与正文实际有多长无关，
   * 让末节的 offset 依赖窗口高度 —— 换个窗口，同一条书签的落点会飘出几百像素，
   * 恰好违背了「换窗口不偏」这个设计前提。
   */
  return Math.max(1, container.scrollHeight - headingTop)
}

/** 元素相对容器**内容**顶部的绝对位置。与滚动位置无关 */
function absoluteTop(el: HTMLElement, container: HTMLElement): number {
  return (
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  )
}

/** 元素的 margin-top，取不到就按 0 —— 只用于把下一节的抬头空白从跨度里剔除 */
function headingMarginTop(el: HTMLElement): number {
  const raw = window.getComputedStyle(el).marginTop
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/**
 * 把书签还成「该滚到哪」，返回目标像素（容器滚动空间里的 top）。
 *
 * 认领方式从准到糙：
 *   1. 下标对得上，且那儿的标题文本与记录一致 —— 最准
 *   2. 下标对不上（前面插了/删了标题），按标题文本全篇搜一个同名的 —— 次准
 * 都对不上返回 null，调用方告诉用户「书签已失效」，而不是硬跳到一个错的地方。
 */
export function resolveReadingBookmark(container: HTMLElement, target: BookmarkAnchor): number | null {
  const landing = resolveBookmarkLanding(container, target)
  return landing ? landing.top : null
}

/**
 * 书签的落点：滚到哪、以及落点在内容坐标里的位置。
 *
 * 返回 `contentPos` 是为了让调用方**滚动完成后**再拿它去取高亮元素
 * （见 blockAtContentPoint 的说明：smooth 滚动期间视口还没到位，
 * 那时调 elementFromPoint 只会命中起点的元素）。
 */
export function resolveBookmarkLanding(
  container: HTMLElement,
  target: BookmarkAnchor
): { top: number; contentPos: number } | null {
  const headings = collectHeadingElements(container)
  if (!headings.length) return null

  const heading = findBookmarkHeading(container, target)
  if (!heading) return null

  const headingTop = absoluteTop(heading, container)
  const span = headingSpan(heading, headings, container)
  /*
   * 落点 = 内容坐标位置 - 页面上方留白。
   *
   * 减掉 SCROLL_MARGIN 是为了让目标落在工具栏**下方**，而不是被它压住。
   * 这是手算 scrollTo 的路径，浏览器不会替我们应用 scroll-margin-top。
   */
  const contentPos = headingTop + span * target.offset
  return { top: Math.max(0, contentPos - SCROLL_MARGIN), contentPos }
}

/**
 * 跳到某个落点，并在滚动到位后高亮那一块。
 *
 * 两个内核共用这一条：位置换算与高亮是同一套，只是滚动容器不同。
 *
 * 高亮目标优先用书签自己存的**块标识**（blockIndex/blockText）—— 那是记账时就
 * 记准的，比事后用坐标去猜可靠得多：坐标探针会被浮层挡住、也会在滚动途中
 * 读到还没到位的视口。只有老数据没有块标识时，才退回按坐标找。
 */
export function jumpToBookmarkLanding(
  container: HTMLElement,
  target: BookmarkAnchor
): void {
  const landing = resolveBookmarkLanding(container, target)
  if (!landing) return
  container.scrollTo({ top: landing.top, behavior: 'smooth' })

  window.setTimeout(() => {
    const own = findBookmarkBlock(container, target)
    flashElement(own ?? blockAtContentPoint(container, landing.contentPos))
  }, SCROLL_SETTLE_MS)
}

/**
 * 落点位置上的那个块级元素。
 *
 * 用坐标命中而不是遍历找「最接近的块」：位置换算在两个内核里不一样，
 * 而「点到哪就是哪」是浏览器给的、与内核无关。
 *
 * ⚠️ 必须在**滚动完成之后**调用。elementFromPoint 读的是当下视口，
 * 而 smooth 滚动要几百毫秒才到位 —— 滚动发起前就探，命中的是起点的元素。
 */
export function blockAtContentPoint(
  container: HTMLElement,
  contentPos: number
): HTMLElement | null {
  const rect = container.getBoundingClientRect()
  // 内容坐标 → 当下视口坐标
  const viewportTop = rect.top + (contentPos - container.scrollTop)
  // 探针夹在容器可视区内，往下探一点，避开落点正好压在边界上的情况
  const probeY = Math.min(Math.max(viewportTop + 6, rect.top + 6), rect.bottom - 6)
  const hit = container.ownerDocument.elementFromPoint(rect.left + rect.width / 2, probeY)
  if (!(hit instanceof HTMLElement)) return null

  // 命中处可能落在段落内的行内元素上（<code>/<em>…），往上找到直属正文的顶层块
  const content = container.querySelector('.milkdown-content, .cherry-previewer') ?? container
  let node: HTMLElement | null = hit
  while (node && node.parentElement && node.parentElement !== content) {
    node = node.parentElement
  }
  if (!node || node === content) return null
  return node
}

/**
 * 找到书签对应的那个标题元素。
 *
 * 书签只存标题文本，不存下标 —— 文本匹配可能撞上同名标题，取第一个；
 * 比起硬按错位的下标跳，至少落在同一个章节名上。
 */
function findBookmarkHeading(
  container: HTMLElement,
  anchor: BookmarkAnchor
): HTMLElement | null {
  const wanted = anchor.heading.trim()
  const match = (el: HTMLElement) => (el.textContent?.trim() || '(空标题)') === wanted
  const headings = collectHeadingElements(container)
  return headings.find(match) ?? null
}

/** 书签还能不能认领到位置（用来决定按钮是「跳过去」还是「已失效，可清除」） */
export function isBookmarkResolvable(
  container: HTMLElement | null,
  bookmark: BookmarkAnchor | undefined
): boolean {
  if (!container || !bookmark) return false
  return resolveReadingBookmark(container, bookmark) !== null
}

/** 生成一条新书签的 id。与笔记 id 用一个路子，够用且不会撞 */
export function createBookmarkId(): string {
  return `bm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
