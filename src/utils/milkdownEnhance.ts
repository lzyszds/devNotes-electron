/**
 * 所见即所得的高级排版增强（容器面板 / 手风琴 / 目录 / 图表 / 行号）。
 *
 * ⚠️ 全部走 ProseMirror 的 **Decoration**（装饰器）机制，绝不再直接往
 * `.milkdown-content` 里插节点或克隆段落。
 *
 * 为什么必须这样：contenteditable 的 DOM 与文档位置之间存在一一映射，
 * 手工 insertBefore / cloneNode / style.display 会让映射错位 —— 表现就是
 * 标记（超链接、下划线等）外溢到正文、光标跳错位置、文字莫名并入链接。
 * 装饰器产出的 DOM 由 ProseMirror 自己托管，它知道哪些不是文档内容，
 * 因此不会污染映射。
 *
 * 具体分工：
 *   - 块级插入（图表卡片、目录卡片、标注头、行号轴、折叠按钮）→ Decoration.widget
 *   - 行/块级换肤（容器面板、标注卡片）                      → Decoration.node
 *   - 隐藏语法标记（::: info、[!NOTE]、[TOC]）               → Decoration.inline
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import mermaid from 'mermaid'
import { copyText } from './clipboard'
import { canonicalLanguageId, LANGUAGE_OPTIONS } from './milkdownShiki'

/*
 * 开发期强制整页重载。
 *
 * 编辑器实例是长生命周期的：改这个文件时，Vite 会把更新冒泡到引入它的
 * MilkdownMarkdownEditor.tsx，而那是个 React Fast Refresh 边界 ——
 * 组件会重渲染，但 `useEffect(..., [])` 里建 ProseMirror 的那段不会重跑。
 * 结果是实例仍握着**旧插件**（闭包里是旧的 buildDecorations），
 * 改动看起来「改了没用」，非要切一次笔记或整页刷新才生效。
 *
 * 主动 invalidate 让 Vite 走整页重载，省掉这个反复踩的坑。
 */
const hot = (
  import.meta as unknown as {
    hot?: { accept: (cb: () => void) => void; invalidate: () => void }
  }
).hot
if (hot) hot.accept(() => hot.invalidate())

export const enhancePluginKey = new PluginKey<EnhanceState>('fehelper-enhance')

/* ============================ 1. 容器面板 ::: type 标题 ============================ */

/**
 * 图标一律用内联 SVG，不再用 emoji。
 *
 * emoji 的问题在排版上：各平台字形宽度不一、基线与正文对不齐、颜色还锁死在字体里，
 * 没法跟着主题走。这里取 Lucide 的描边路径，`stroke: currentColor` 直接继承卡片主色。
 */
const ICON_PATHS: Record<string, string> = {
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  note: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  tip: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
  success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  warning:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  danger:
    '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
  accordion:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  timeline: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  important:
    '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  wrap: '<path d="M3 6h18"/><path d="M3 12h13a3 3 0 1 1 0 6h-4"/><path d="m9 21-3-3 3-3"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  caret: '<path d="m6 9 6 6 6-6"/>',
}

/** 渲染成一段可直接塞进 innerHTML 的 SVG */
function svgIcon(name: string): string {
  const path = ICON_PATHS[name] ?? ICON_PATHS.info
  return `<svg class="fe-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
}

const CONTAINERS: Record<string, { icon: string }> = {
  info: { icon: 'info' },
  note: { icon: 'note' },
  tip: { icon: 'tip' },
  success: { icon: 'success' },
  warning: { icon: 'warning' },
  danger: { icon: 'danger' },
  accordion: { icon: 'accordion' },
  timeline: { icon: 'timeline' },
}

/**
 * 时间线条目的状态 → 圆点配色。
 * 取值与 Cherry 保持一致（done / doing / todo / error 各类写法都归一到这几个桶）。
 */
const TIMELINE_STATUS: Record<string, string> = {
  done: 'done',
  success: 'done',
  finished: 'done',
  doing: 'doing',
  process: 'doing',
  processing: 'doing',
  error: 'error',
  fail: 'error',
  failed: 'error',
  warning: 'warning',
  warn: 'warning',
  todo: 'todo',
}

/** `- [状态] 时间 标题` 的开头部分；Cherry 里状态缺省是 todo */
const TIMELINE_STATUS_RE = /^\s*\[([^\]]*)\]\s*/

/** 开标记：`::: info 标题` */
const OPEN_RE = /^:::\s*([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/
/** 闭标记：单独一行 `:::` */
const CLOSE_RE = /^:::\s*$/

/* ============================ 2. GitHub Alert：> [!NOTE] ============================ */

const ALERTS: Record<string, { icon: string; label: string; tone: string }> = {
  NOTE: { icon: 'info', label: '提示说明', tone: 'note' },
  INFO: { icon: 'info', label: '相关信息', tone: 'note' },
  TIP: { icon: 'tip', label: '最佳实践', tone: 'tip' },
  HINT: { icon: 'tip', label: '关键要点', tone: 'tip' },
  IMPORTANT: { icon: 'important', label: '重要规范', tone: 'important' },
  WARNING: { icon: 'warning', label: '注意事项', tone: 'warning' },
  WARN: { icon: 'warning', label: '注意事项', tone: 'warning' },
  CAUTION: { icon: 'danger', label: '风险警示', tone: 'caution' },
  DANGER: { icon: 'danger', label: '危险操作', tone: 'caution' },
}

const ALERT_RE = /^\s*\[!(NOTE|INFO|TIP|HINT|IMPORTANT|WARNING|WARN|CAUTION|DANGER)\]\s*/

/* ============================ 3. Mermaid 图表识别 ============================ */

const MERMAID_RE =
  /^(graph\s+(TD|TB|BT|RL|LR)|flowchart\s+(TD|TB|BT|RL|LR)|sequenceDiagram|timeline|pie|gantt|classDiagram|erDiagram|stateDiagram|mindmap|journey)/i

/**
 * 判断代码块是不是图表。
 *
 * 两道路径：优先看语言标（```mermaid）；没有语言标时嗅探内容 ——
 * 只认「第一行」不够，粘进来的图表前面常带空行或注释，所以看前几行里有没有出现图表关键字。
 */
function isMermaidBlock(node: ProseNode): boolean {
  if (node.type.name !== 'code_block') return false
  const lang = String(node.attrs.language ?? '').toLowerCase().trim()
  if (lang === 'mermaid') return true

  const head = node.textContent
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
  return head.some((line) => MERMAID_RE.test(line))
}

/* ============================ Mermaid 全局配置 ============================ */

let mermaidTheme: 'dark' | 'default' | null = null

function initMermaid(isDark: boolean) {
  const theme = isDark ? 'dark' : 'default'
  if (mermaidTheme === theme) return
  mermaidTheme = theme
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme,
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Inter", sans-serif',
    fontSize: 13,
  })
}

/** 图表块的稳定标识：内容指纹，用来记住这一块当前是「预览」还是「源码」 */
function mermaidKey(code: string): string {
  return `${code.length}:${code.slice(0, 40)}`
}

/** 「预览 / 源码」页签。挂在代码块**上方**，切换的是源码块的显隐，见 buildDecorations */
function createMermaidTabs(view: EditorView, key: string, showSource: boolean): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'fe-mermaid-tabs'
  bar.contentEditable = 'false'

  const makeTab = (label: string, active: boolean, source: boolean) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `fe-mermaid-tab${active ? ' is-active' : ''}`
    btn.textContent = label
    // 点页签不该让编辑区失焦 —— 一失焦选区就没了
    btn.addEventListener('mousedown', (event) => event.preventDefault())
    btn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (active) return
      view.dispatch(
        view.state.tr.setMeta(enhancePluginKey, { mermaidSource: { key, showSource: source } })
      )
    })
    return btn
  }

  bar.appendChild(makeTab('预览', !showSource, false))
  bar.appendChild(makeTab('源码', showSource, true))
  return bar
}

/** 生成图表卡片容器，异步把 SVG 填进去（DOM 归 ProseMirror 托管，填内容安全） */
function createMermaidCard(code: string, isDark: boolean): HTMLElement {
  const card = document.createElement('div')
  card.className = 'fe-mermaid-card'
  card.contentEditable = 'false'

  const body = document.createElement('div')
  body.className = 'fe-mermaid-body'
  card.appendChild(body)

  void (async () => {
    body.textContent = '正在渲染图表…'
    try {
      initMermaid(isDark)
      const id = `fe_mermaid_${Math.random().toString(36).slice(2, 9)}`
      const { svg } = await mermaid.render(id, code)
      body.innerHTML = svg
    } catch (error) {
      // 把真实原因显示出来 —— 早先只给一句「语法尚未完整」，
      // 引擎真出错时看不出所以然，排查全靠猜
      const detail = String((error as Error)?.message ?? error).slice(0, 200)
      console.error('[Mermaid] 图表渲染失败:', error)
      body.innerHTML = `<span class="fe-mermaid-error">图表渲染失败：${detail}</span>`
    }
  })()

  return card
}

/* ============================ 插件状态（手风琴开合） ============================ */

export interface EnhanceState {
  /** 处于展开状态的手风琴（按容器标题去重） */
  open: string[]
  /** 「源码」页签被选中的图表块（按内容指纹去重），不在其中的一律显示预览 */
  sourceOpen: string[]
  /** [TOC] 目录是否展开。默认收起，只留一个小胶囊，避免一进文档就被目录占满首屏 */
  tocOpen: boolean
  /** 开了自动换行的代码块（按内容指纹去重） */
  wrapped: string[]
}

/* ============================ 装饰集构建 ============================ */

type Block = { node: ProseNode; pos: number }
type TocItem = { text: string; level: number; pos: number }

function collectHeadings(state: EditorState): TocItem[] {
  const items: TocItem[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    items.push({ text: node.textContent || '未命名标题', level: Number(node.attrs.level ?? 1), pos })
    return true
  })
  return items.slice(0, 80)
}

/**
 * 紧凑写法（`::: info 标题` / 内容 / `:::` 三行之间没有空行）的容器面板。
 *
 * 三行被 CommonMark 并成同一个段落，所以整套装饰都落在这一段的段内：
 * 前缀 `::: info ` 与结尾的 `\n:::` 用 inline 装饰藏掉，标题单独标粗上色，
 * 整段套一层节点装饰当面板底。
 *
 * 之所以敢按字面偏移算位置：这一段的正文是**单个文本节点**（软换行是文本里的 `\n`），
 * 文本偏移与文档位置一一对应。`at()` 再做一次收敛，即便哪天解析形态变了也不会越界抛错。
 */
function pushInlineContainer(
  decos: Decoration[],
  block: Block,
  lines: string[],
  type: string,
  titleRaw: string,
  icon: string,
  openAccordions: string[]
) {
  const raw = block.node.textContent
  const start = block.pos + 1
  const size = block.node.content.size
  const at = (offset: number) => start + Math.max(0, Math.min(offset, size))

  const title = titleRaw.trim()
  const prefixEnd = lines[0].length - title.length
  const titleLineEnd = at(lines[0].length)

  if (prefixEnd > 0) {
    decos.push(Decoration.inline(start, at(prefixEnd), { class: 'fe-hidden-marker' }))
  }
  if (title.length > 0) {
    decos.push(Decoration.inline(at(prefixEnd), titleLineEnd, { class: 'fe-container-title' }))
  }

  // 结尾的 `\n:::`（连同它前面那个换行一起藏）
  const closeFrom = at(raw.length - lines[lines.length - 1].length - 1)
  if (closeFrom < at(raw.length)) {
    decos.push(Decoration.inline(closeFrom, at(raw.length), { class: 'fe-hidden-marker' }))
  }

  // 手风琴：正文（标题行之后到闭合标记之前）可整段收起，按钮挂在标题行末尾
  const isAccordion = type === 'accordion'
  const key = title || `${type}-${block.pos}`
  const collapsed = isAccordion && !openAccordions.includes(key)
  if (isAccordion) {
    if (collapsed && closeFrom > titleLineEnd) {
      decos.push(Decoration.inline(titleLineEnd, closeFrom, { class: 'fe-hidden-marker' }))
    }
    decos.push(
      Decoration.widget(titleLineEnd, (view) => createAccordionToggle(view, key, collapsed), {
        side: 1,
        key: `accordion-inline-toggle-${collapsed}`,
      })
    )
  }

  /*
   * 标题与正文之间补一个换行。
   *
   * 紧凑写法的三行会被 CommonMark 并成**同一个段落**，软换行到了 ProseMirror 里
   * 不一定还表现为折行 —— 实测标题和正文会挤在同一行，卡片看着像一条色带。
   * 这里在标题末尾挂一个 <br> widget 把正文顶到下一行，卡片才有"标题行 + 正文"的样子。
   * 手风琴收起时正文整段是藏着的，就不用补了，否则会多出一条空行。
   */
  if (!(isAccordion && collapsed)) {
    decos.push(
      Decoration.widget(titleLineEnd, () => document.createElement('br'), {
        side: 1,
        key: 'container-title-break',
      })
    )
  }

  decos.push(
    Decoration.widget(
      start,
      () => {
        const el = document.createElement('span')
        el.className = 'fe-container-icon'
        el.innerHTML = svgIcon(icon)
        return el
      },
      { side: -1 }
    )
  )
  decos.push(
    Decoration.node(block.pos, block.pos + block.node.nodeSize, {
      class: `fe-container-inline fe-container-inline--${type}`,
    })
  )
}

/**
 * 时间线：把容器内的无序列表逐条改造成「圆点 + 时间 + 标题」。
 *
 * Cherry 的条目写法是 `- [状态] 时间 标题`（时间可省），缩进行是描述。
 * 这里**不改文档结构** —— 只给列表挂节点装饰去画圆点与连线，
 * 再用行内装饰把 `[状态]` 藏起来、给时间与标题上色，正文因此始终可编辑。
 */
function pushTimelineItems(decos: Decoration[], doc: ProseNode, from: number, to: number) {
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fe-timeline-list' }))
      return true
    }
    if (node.type.name !== 'list_item') return true

    const para = node.firstChild
    if (!para || !para.isTextblock) return false

    // list_item(1) + paragraph(1) 之后才是正文起点
    const start = pos + 2
    const raw = para.textContent
    const end = start + raw.length

    let status = 'todo'
    let rest = raw
    const marker = TIMELINE_STATUS_RE.exec(raw)
    if (marker) {
      status = TIMELINE_STATUS[marker[1].trim().toLowerCase()] ?? 'todo'
      rest = raw.slice(marker[0].length)
      decos.push(Decoration.inline(start, start + marker[0].length, { class: 'fe-hidden-marker' }))
    }

    // 第一个词以数字或 v1 这类版本号开头时算时间，否则整句都是标题
    const first = /^\s*(\S+)/.exec(rest)?.[1] ?? ''
    const time = /^\d/.test(first) || /^v\d/i.test(first) ? first : ''
    const base = end - rest.length

    if (time) {
      decos.push(Decoration.inline(base, base + time.length, { class: 'fe-timeline-time' }))
    }
    const titleFrom = base + time.length
    if (titleFrom < end) {
      decos.push(Decoration.inline(titleFrom, end, { class: 'fe-timeline-title' }))
    }

    decos.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `fe-timeline-item fe-timeline-item--${status}`,
      })
    )
    return false
  })
}

/* ============================ 4. 代码块常驻表头 ============================ */

/** 语言的展示名；认不出来就照原样显示 */
function languageLabel(raw: string): string {
  if (!raw) return '纯文本'
  const id = canonicalLanguageId(raw) || raw
  return LANGUAGE_OPTIONS.find((item) => item.id === id)?.label ?? raw
}

/** 代码块的稳定标识（内容指纹），用来记住这一块有没有开自动换行 */
function codeKey(node: ProseNode): string {
  const text = node.textContent
  return `${text.length}:${text.slice(0, 32)}`
}

/**
 * 代码块常驻表头：左侧是当前语言（点开可切换），右侧是自动换行与复制。
 *
 * 每块一个 —— 早先的语言标签是**全局单例**浮条，只跟着光标跑，一屏上永远只有一条，
 * 其余代码块是什么语言完全看不到。做成表头后每块自带控件。
 *
 * 语言菜单用 position: fixed：`.milkdown-scroll` 是 overflow: auto，
 * 菜单若用 absolute 会被滚动容器裁掉（越靠文档底部裁得越狠）。
 * fixed 不受 overflow 祖先裁剪，同时仍留在 widget 自己的 DOM 里，
 * 随装饰器一起销毁，不会在 body 上留垃圾。
 *
 * 收起菜单用 focusout 而不是 document 上的全局 mousedown：后者每建一个表头就挂一条，
 * DOM 被重建时又摘不掉，是个只会涨的监听器泄漏。
 */
function createCodeHeader(
  view: EditorView,
  blockPos: number,
  language: string,
  wrapOn: boolean,
  key: string,
  code: string
): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'fe-code-header'
  bar.contentEditable = 'false'

  const langBtn = document.createElement('button')
  langBtn.type = 'button'
  langBtn.className = 'fe-code-lang'
  langBtn.title = '切换代码块语言'
  langBtn.innerHTML = `${svgIcon('code')}<span>${languageLabel(language)}</span>${svgIcon('caret')}`

  const actions = document.createElement('div')
  actions.className = 'fe-code-header-actions'

  const wrapBtn = document.createElement('button')
  wrapBtn.type = 'button'
  wrapBtn.className = `fe-code-action${wrapOn ? ' is-on' : ''}`
  wrapBtn.title = wrapOn ? '关闭自动换行' : '开启自动换行'
  wrapBtn.innerHTML = `${svgIcon('wrap')}<span>换行</span>`

  const copyBtn = document.createElement('button')
  copyBtn.type = 'button'
  copyBtn.className = 'fe-code-action'
  copyBtn.title = '复制代码'
  copyBtn.innerHTML = `${svgIcon('copy')}<span>复制</span>`

  // ---- 语言菜单 ----
  const menu = document.createElement('div')
  menu.className = 'fe-code-lang-menu'
  menu.hidden = true

  const search = document.createElement('input')
  search.type = 'text'
  search.placeholder = '筛选语言…'
  search.className = 'fe-code-lang-search'

  const list = document.createElement('div')
  list.className = 'fe-code-lang-list'
  menu.append(search, list)

  const currentId = canonicalLanguageId(language) || language

  const fillList = (keyword: string) => {
    const q = keyword.trim().toLowerCase()
    const options = q
      ? LANGUAGE_OPTIONS.filter(
          (item) => item.label.toLowerCase().includes(q) || item.id.includes(q)
        )
      : LANGUAGE_OPTIONS
    list.replaceChildren(
      ...options.slice(0, 200).map((item) => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `fe-code-lang-option${item.id === currentId ? ' is-active' : ''}`
        row.innerHTML = `<span>${item.label}</span><code>${item.id}</code>`
        row.addEventListener('mousedown', (event) => event.preventDefault())
        row.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          view.dispatch(
            view.state.tr.setMeta(enhancePluginKey, {
              codeLanguage: { pos: blockPos, language: item.id },
            })
          )
          menu.hidden = true
        })
        return row
      })
    )
  }

  const closeMenu = () => {
    menu.hidden = true
  }

  langBtn.addEventListener('mousedown', (event) => event.preventDefault())
  langBtn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!menu.hidden) {
      closeMenu()
      return
    }
    const rect = langBtn.getBoundingClientRect()
    menu.style.top = `${Math.round(rect.bottom + 6)}px`
    menu.style.left = `${Math.round(rect.left)}px`
    menu.hidden = false
    search.value = ''
    fillList('')
    search.focus()
  })

  search.addEventListener('input', () => fillList(search.value))
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    }
  })

  // 焦点离开整条表头（且没落回菜单里）就收起
  bar.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null
    if (next && bar.contains(next)) return
    closeMenu()
  })
  // 菜单里非输入的按下不该把焦点/光标带走
  menu.addEventListener('mousedown', (event) => {
    if ((event.target as HTMLElement).closest('input')) return
    event.preventDefault()
  })

  // ---- 自动换行 ----
  wrapBtn.addEventListener('mousedown', (event) => event.preventDefault())
  wrapBtn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    view.dispatch(view.state.tr.setMeta(enhancePluginKey, { codeWrap: { key, on: !wrapOn } }))
  })

  // ---- 复制 ----
  copyBtn.addEventListener('mousedown', (event) => event.preventDefault())
  copyBtn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    void copyText(code).then((ok) => {
      if (!ok) return
      copyBtn.classList.add('is-done')
      copyBtn.innerHTML = `${svgIcon('check')}<span>已复制</span>`
      window.setTimeout(() => {
        copyBtn.classList.remove('is-done')
        copyBtn.innerHTML = `${svgIcon('copy')}<span>复制</span>`
      }, 1600)
    })
  })

  actions.append(wrapBtn, copyBtn)
  bar.append(langBtn, actions, menu)
  return bar
}

/* ============================ 5. <details> 折叠块 ============================ */

/**
 * `<details>` / `<summary>` 的折叠块。
 *
 * 它在 mdast 里是**块级 html 节点**，不是行内标签，行内渲染器接不住，只能原样显示源码。
 * 这一段与 `::: accordion` 走同一套外观，只多认一种写法：
 *
 *   html      "<details>\n<summary>标题</summary>"
 *   paragraph  正文（可以多段）
 *   html      "</details>"
 *
 * ⚠️ 只在装饰层做文章，**不改文档**：`<details>` / `<summary>` / `</details>`
 * 三处标记用 inline 装饰藏起来，源码原样保留，存回磁盘仍是用户写的 HTML。
 * 换成解析期改写成 `:::` 是另一条路，但那会在保存时悄悄改掉用户的 Markdown。
 */
const DETAILS_HEAD_RE = /^<details>\s*<summary>([\s\S]*?)<\/summary>\s*$/i
const DETAILS_CLOSE_RE = /<\/details>/i

/** 手风琴的开合按钮（::: accordion 与 <details> 共用） */
function createAccordionToggle(view: EditorView, key: string, collapsed: boolean): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.contentEditable = 'false'
  btn.className = `fe-accordion-toggle${collapsed ? '' : ' is-open'}`
  btn.title = collapsed ? '展开内容' : '收起内容'
  btn.setAttribute('aria-label', btn.title)
  btn.setAttribute('aria-expanded', String(!collapsed))
  // 用矢量箭头而不是 ▸ 字符：字符在不同字体下基线、粗细都对不齐
  btn.innerHTML = svgIcon('caret')
  btn.addEventListener('mousedown', (event) => event.preventDefault())
  btn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    view.dispatch(view.state.tr.setMeta(enhancePluginKey, { accordion: key }))
  })
  return btn
}

function pushDetailsBlock(
  decos: Decoration[],
  tops: Block[],
  headIndex: number,
  closeIndex: number,
  openAccordions: string[]
): void {
  const block = tops[headIndex]
  const close = tops[closeIndex]
  const raw = block.node.textContent
  const start = block.pos + 1
  const size = block.node.content.size
  const at = (offset: number) => start + Math.max(0, Math.min(offset, size))

  const titleStart = raw.indexOf('<summary>') + '<summary>'.length
  const titleEnd = raw.indexOf('</summary>')
  if (titleStart <= 0 || titleEnd < titleStart) return

  const title = raw.slice(titleStart, titleEnd).trim()
  const key = title || `details-${block.pos}`
  const collapsed = !openAccordions.includes(key)

  // 藏掉 `<details>` 与 `<summary>`（含中间那个换行），只留标题
  decos.push(Decoration.inline(start, at(titleStart), { class: 'fe-hidden-marker' }))
  decos.push(Decoration.inline(at(titleStart), at(titleEnd), { class: 'fe-container-title' }))
  decos.push(Decoration.inline(at(titleEnd), at(raw.length), { class: 'fe-hidden-marker' }))

  decos.push(
    Decoration.widget(at(raw.length), (view) => createAccordionToggle(view, key, collapsed), {
      side: 1,
      key: `details-toggle-${collapsed}`,
    })
  )

  decos.push(
    Decoration.node(block.pos, block.pos + block.node.nodeSize, {
      class: `fe-container-head fe-container-head--accordion${collapsed ? ' is-collapsed' : ''}`,
    })
  )

  // `</details>` 整行藏掉（留个可编辑的空位，不 display:none）
  decos.push(
    Decoration.inline(close.pos + 1, close.pos + 1 + close.node.content.size, {
      class: 'fe-hidden-marker',
    })
  )
  decos.push(
    Decoration.node(close.pos, close.pos + close.node.nodeSize, {
      class: `fe-container-close fe-container-close--accordion${collapsed ? ' is-collapsed' : ''}`,
    })
  )

  // 中间的正文段落
  const inner: Block[] = []
  for (let k = headIndex + 1; k < closeIndex; k += 1) inner.push(tops[k])
  inner.forEach((body, idx) => {
    const classes = ['fe-container-body', 'fe-container-body--accordion']
    if (idx === 0) classes.push('fe-container-body--first')
    if (idx === inner.length - 1) classes.push('fe-container-body--last')
    if (collapsed) classes.push('is-collapsed')
    decos.push(Decoration.node(body.pos, body.pos + body.node.nodeSize, { class: classes.join(' ') }))
  })
}

function buildDecorations(
  state: EditorState,
  isDark: boolean,
  stamp: number,
  openAccordions: string[],
  openSources: string[],
  tocOpen: boolean,
  wrappedCodes: string[]
): DecorationSet {
  const decos: Decoration[] = []
  const doc = state.doc

  /* ---------- 顶层块序列：容器面板与目录只认顶层 ---------- */
  const tops: Block[] = []
  doc.forEach((node, offset) => tops.push({ node, pos: offset }))

  for (let i = 0; i < tops.length; i += 1) {
    const block = tops[i]
    if (!block.node.isTextblock) continue
    const raw = block.node.textContent

    /*
     * `<details>` / `<summary>` 折叠块。认出来就交给专用分支，
     * 它和 `::: accordion` 共用外观，只是语法不同。
     */
    if (DETAILS_HEAD_RE.test(raw)) {
      let closeAt = -1
      for (let j = i + 1; j < tops.length; j += 1) {
        if (DETAILS_CLOSE_RE.test(tops[j].node.textContent)) {
          closeAt = j
          break
        }
      }
      if (closeAt !== -1) {
        pushDetailsBlock(decos, tops, i, closeAt, openAccordions)
        i = closeAt
        continue
      }
    }

    /*
     * 紧凑写法优先：`::: info 标题` / 内容 / `:::` 三行之间没有空行时，
     * CommonMark 会把它们并成**同一个段落**（软换行），关标记根本不在兄弟节点里。
     * 这种形态要在段内做文章，不能走下面那套「找闭合段落」的逻辑。
     */
    const lines = raw.split('\n')
    if (lines.length >= 2 && CLOSE_RE.test(lines[lines.length - 1].trim())) {
      const head = OPEN_RE.exec(lines[0].trim())
      const inlineConfig = head ? CONTAINERS[head[1].toLowerCase()] : undefined
      if (head && inlineConfig) {
        pushInlineContainer(
          decos,
          block,
          lines,
          head[1].toLowerCase(),
          head[2] ?? '',
          inlineConfig.icon,
          openAccordions
        )
        continue
      }
    }

    const open = OPEN_RE.exec(raw.trim())
    if (!open) continue

    const type = open[1].toLowerCase()
    const config = CONTAINERS[type]
    if (!config) continue

    let end = -1
    for (let j = i + 1; j < tops.length; j += 1) {
      if (CLOSE_RE.test(tops[j].node.textContent.trim())) {
        end = j
        break
      }
    }
    if (end === -1) continue

    const close = tops[end]
    const contentSize = block.node.content.size
    const titleText = (open[2] ?? '').trim()
    const bodyKey = titleText || `${type}-${block.pos}`
    const isAccordion = type === 'accordion'
    const collapsed = isAccordion && !openAccordions.includes(bodyKey)

    // 把 `::: info ` 这段前缀藏起来，只留标题文字可编辑
    const prefixEnd = contentSize - (open[2] ?? '').length
    if (prefixEnd > 0) {
      decos.push(
        Decoration.inline(block.pos + 1, block.pos + 1 + prefixEnd, { class: 'fe-hidden-marker' })
      )
    }

    // 行首图标
    decos.push(
      Decoration.widget(
        block.pos + 1,
        () => {
          const icon = document.createElement('span')
          icon.className = 'fe-container-icon'
          icon.innerHTML = svgIcon(config.icon)
          return icon
        },
        { side: -1 }
      )
    )

    // 手风琴：标题行末尾挂一个开合按钮（位置夹在段内，越界会让 ProseMirror 抛错）
    if (isAccordion) {
      const togglePos = Math.min(block.pos + open[0].length + 1, block.pos + contentSize)
      decos.push(
        Decoration.widget(togglePos, (view) => createAccordionToggle(view, bodyKey, collapsed), {
          side: 1,
          key: `accordion-toggle-${collapsed}`,
        })
      )
    }

    decos.push(
      Decoration.node(block.pos, block.pos + block.node.nodeSize, {
        class: `fe-container-head fe-container-head--${type}${collapsed ? ' is-collapsed' : ''}`,
      })
    )

    decos.push(
      Decoration.node(close.pos, close.pos + close.node.nodeSize, {
        class: `fe-container-close fe-container-close--${type}${collapsed ? ' is-collapsed' : ''}`,
      })
    )

    // 中间的块套上同色面板；首尾各自圆角，拼成一张整卡
    for (let k = i + 1; k < end; k += 1) {
      const body = tops[k]
      const classes = ['fe-container-body', `fe-container-body--${type}`]
      if (k === i + 1) classes.push('fe-container-body--first')
      if (k === end - 1) classes.push('fe-container-body--last')
      if (collapsed) classes.push('is-collapsed')
      decos.push(
        Decoration.node(body.pos, body.pos + body.node.nodeSize, { class: classes.join(' ') })
      )
    }

    // 时间线：容器里的列表要逐条改造成「圆点 + 时间 + 标题」
    if (type === 'timeline') {
      pushTimelineItems(decos, doc, block.pos + block.node.nodeSize, close.pos)
    }

    i = end
  }

  /* ---------- 全文档递归：图表 / 行号 / Alert / 目录 ---------- */
  doc.descendants((node, pos) => {
    // 3.1 Mermaid：代码块上方是「预览 / 源码」页签，下方是实时渲染的矢量图
    if (isMermaidBlock(node)) {
      const code = node.textContent
      const key = mermaidKey(code)
      const showSource = openSources.includes(key)

      decos.push(
        Decoration.widget(pos, (view) => createMermaidTabs(view, key, showSource), {
          side: -1,
          key: `mermaid-tabs-${key}-${showSource}`,
        })
      )

      if (showSource) {
        // 看源码时把渲染结果收起，避免同一段内容上下出现两遍
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, { class: 'fe-mermaid-source' })
        )
      } else {
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: 'fe-mermaid-source fe-source-hidden',
          })
        )
        decos.push(
          Decoration.widget(pos + node.nodeSize, () => createMermaidCard(code, isDark), {
            side: 1,
            key: `mermaid-${stamp}-${key}`,
          })
        )
      }
      return false
    }

    // 3.2 普通代码块：块首插入行号轴，块前挂常驻表头
    if (node.type.name === 'code_block') {
      const lineCount = Math.max(1, node.textContent.split('\n').length)
      const key = codeKey(node)
      const wrapOn = wrappedCodes.includes(key)

      decos.push(
        Decoration.widget(
          pos,
          (view) =>
            createCodeHeader(
              view,
              pos,
              String(node.attrs.language ?? ''),
              wrapOn,
              key,
              node.textContent
            ),
          { side: -1, key: `code-header-${key}-${wrapOn}` }
        )
      )
      // 恒挂 fe-code-block：表头就靠它把上圆角收平，不再依赖 `+ pre` 相邻选择器
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `fe-code-block${wrapOn ? ' fe-code-wrap' : ''}`,
        })
      )

      decos.push(
        Decoration.widget(
          pos + 1,
          () => {
            const gutter = document.createElement('div')
            gutter.className = 'fe-code-gutter'
            gutter.contentEditable = 'false'
            for (let n = 1; n <= lineCount; n += 1) {
              const line = document.createElement('span')
              line.className = 'fe-code-line-num'
              line.textContent = String(n)
              gutter.appendChild(line)
            }
            return gutter
          },
          { side: -1, key: `gutter-${lineCount}` }
        )
      )
      return false
    }

    // 3.3 GitHub Alert：`> [!NOTE]`
    if (node.type.name === 'blockquote') {
      const first = node.firstChild
      if (!first || !first.isTextblock) return true
      const alert = ALERT_RE.exec(first.textContent)
      if (!alert) return true

      const config = ALERTS[alert[1].toUpperCase()]
      if (!config) return true

      const markerFrom = pos + 1
      decos.push(
        Decoration.inline(markerFrom, markerFrom + alert[0].length, { class: 'fe-hidden-marker' })
      )
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, { class: `fe-alert fe-alert--${config.tone}` })
      )
      decos.push(
        Decoration.widget(
          pos,
          () => {
            const head = document.createElement('div')
            head.className = `fe-alert-head fe-alert-head--${config.tone}`
            head.contentEditable = 'false'
            head.innerHTML = `<span class="fe-alert-icon">${svgIcon(config.icon)}</span><span>${config.label}</span>`
            return head
          },
          { side: -1 }
        )
      )
      return true
    }

    // 3.4 目录标记 `[TOC]`
    if (node.isTextblock && /^\s*\[\[?\s*toc\s*\]\]?\s*$/i.test(node.textContent)) {
      decos.push(
        Decoration.inline(pos + 1, pos + 1 + node.content.size, { class: 'fe-hidden-marker' })
      )
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fe-toc-marker-block' }))
      const items = collectHeadings(state)
      const digest = items.map((item) => `${item.level}:${item.text}`).join('|')
      decos.push(
        Decoration.widget(
          pos + node.nodeSize,
          (view) => createTocCard(items, view, tocOpen),
          // key 里**不能**带 tocOpen：一变就重建 DOM，卡片会跟着抖
          { side: 1, key: `toc-${digest}` }
        )
      )
    }

    return true
  })

  return DecorationSet.create(doc, decos)
}

/**
 * 目录卡片。
 *
 * ⚠️ 展开与收起是**同一棵 DOM**，靠 `is-collapsed` 切类名，不重建。
 * 早先是两个不同 widget（收起态换成一颗胶囊），widget 的 key 里还带着 tocOpen ——
 * 每点一次就换 key，ProseMirror 便销毁重建整块，卡片上的入场动画跟着重放，
 * 视觉上就是「点一下抖一下」。现在 key 固定，点击只在本地切类名 + 派发状态。
 */
function createTocCard(items: TocItem[], view: EditorView, open: boolean): HTMLElement {
  const card = document.createElement('div')
  card.className = `fe-toc-card${open ? '' : ' is-collapsed'}`
  card.contentEditable = 'false'

  const head = document.createElement('div')
  head.className = 'fe-toc-head'
  head.innerHTML = `<span class="fe-toc-title">${svgIcon('note')}<span>本文目录</span></span><span class="fe-toc-count">${items.length} 小节</span>`

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'fe-toc-collapse'
  toggle.textContent = open ? '收起' : '展开'
  toggle.title = open ? '收起目录' : '展开目录'
  toggle.setAttribute('aria-expanded', String(open))
  toggle.addEventListener('mousedown', (event) => event.preventDefault())
  toggle.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    // 先在本地切：DOM 不重建，收起动画才能接着上一次的状态跑
    const collapsed = card.classList.toggle('is-collapsed')
    toggle.textContent = collapsed ? '展开' : '收起'
    toggle.title = collapsed ? '展开目录' : '收起目录'
    toggle.setAttribute('aria-expanded', String(!collapsed))
    // 再同步进插件 state，这样文档变动触发重建时不会跳回默认态
    view.dispatch(view.state.tr.setMeta(enhancePluginKey, { toc: !collapsed }))
  })
  head.appendChild(toggle)
  card.appendChild(head)

  const body = document.createElement('div')
  body.className = 'fe-toc-body'

  if (!items.length) {
    const empty = document.createElement('div')
    empty.className = 'fe-toc-empty'
    empty.textContent = '暂无标题'
    body.appendChild(empty)
  } else {
    const list = document.createElement('div')
    list.className = 'fe-toc-list'
    items.forEach((item) => {
      const row = document.createElement('div')
      row.className = `fe-toc-item fe-toc-item--${Math.min(item.level, 4)}`
      row.textContent = item.text
      row.addEventListener('mousedown', (event) => event.preventDefault())
      row.addEventListener('click', () => {
        const pos = Math.min(item.pos + 1, view.state.doc.content.size)
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.near(view.state.doc.resolve(pos), 1))
            .scrollIntoView()
        )
        view.focus()
      })
      list.appendChild(row)
    })
    body.appendChild(list)
  }

  card.appendChild(body)
  return card
}
/* ============================ 导出插件 ============================ */

/** 主题切换时自增，让 widget 的 key 变化、强制重建（图表要换配色） */
let themeStamp = 0

export function bumpEnhanceTheme() {
  themeStamp += 1
}

export const milkdownEnhance = $prose(
  () =>
    new Plugin<EnhanceState>({
      key: enhancePluginKey,
      state: {
        init: () => ({ open: [], sourceOpen: [], tocOpen: true, wrapped: [] }),
        apply(tr, value) {
          const meta = tr.getMeta(enhancePluginKey) as
            | {
                accordion?: string
                mermaidSource?: { key: string; showSource: boolean }
                toc?: boolean
                codeWrap?: { key: string; on: boolean }
                codeLanguage?: { pos: number; language: string }
              }
            | undefined
          if (!meta) return value

          if (meta.accordion) {
            const key = meta.accordion
            return {
              ...value,
              open: value.open.includes(key)
                ? value.open.filter((item) => item !== key)
                : [...value.open, key],
            }
          }

          if (meta.codeWrap) {
            const { key, on } = meta.codeWrap
            const has = value.wrapped.includes(key)
            if (on === has) return value
            return {
              ...value,
              wrapped: on ? [...value.wrapped, key] : value.wrapped.filter((item) => item !== key),
            }
          }

          if (meta.codeLanguage) {
            const { pos, language: next } = meta.codeLanguage
            const node = tr.doc.nodeAt(pos)
            if (!node) return value
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: next })
            return value
          }

          if (typeof meta.toc === 'boolean') {
            return { ...value, tocOpen: meta.toc }
          }

          if (meta.mermaidSource) {
            const { key, showSource } = meta.mermaidSource
            const has = value.sourceOpen.includes(key)
            if (showSource === has) return value
            return {
              ...value,
              sourceOpen: showSource
                ? [...value.sourceOpen, key]
                : value.sourceOpen.filter((item) => item !== key),
            }
          }

          return value
        },
      },
      props: {
        decorations(state) {
          const isDark =
            typeof document !== 'undefined' &&
            document.documentElement.classList.contains('dark')
          const pluginState = enhancePluginKey.getState(state)
          return buildDecorations(
            state,
            isDark,
            themeStamp,
            pluginState?.open ?? [],
            pluginState?.sourceOpen ?? [],
            pluginState?.tocOpen ?? false,
            pluginState?.wrapped ?? []
          )
        },
      },
    })
)
