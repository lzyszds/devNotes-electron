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

const CONTAINERS: Record<string, { icon: string }> = {
  info: { icon: 'ℹ️' },
  note: { icon: '📝' },
  tip: { icon: '💡' },
  success: { icon: '✅' },
  warning: { icon: '⚠️' },
  danger: { icon: '🚨' },
  accordion: { icon: '📁' },
  timeline: { icon: '🕒' },
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
  NOTE: { icon: '💡', label: '提示说明', tone: 'note' },
  INFO: { icon: 'ℹ️', label: '相关信息', tone: 'note' },
  TIP: { icon: '🔥', label: '最佳实践', tone: 'tip' },
  HINT: { icon: '✨', label: '关键要点', tone: 'tip' },
  IMPORTANT: { icon: '📌', label: '重要规范', tone: 'important' },
  WARNING: { icon: '⚠️', label: '注意事项', tone: 'warning' },
  WARN: { icon: '⚠️', label: '注意事项', tone: 'warning' },
  CAUTION: { icon: '🚨', label: '风险警示', tone: 'caution' },
  DANGER: { icon: '⛔', label: '危险操作', tone: 'caution' },
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
}

function toggleAccordion(view: EditorView, key: string) {
  view.dispatch(view.state.tr.setMeta(enhancePluginKey, { accordion: key }))
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
      Decoration.widget(
        titleLineEnd,
        (view) => {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.contentEditable = 'false'
          btn.className = `fe-accordion-toggle${collapsed ? '' : ' is-open'}`
          btn.title = collapsed ? '展开内容' : '收起内容'
          btn.textContent = '▸'
          btn.addEventListener('mousedown', (event) => event.preventDefault())
          btn.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            toggleAccordion(view, key)
          })
          return btn
        },
        { side: 1, key: `accordion-inline-toggle-${collapsed}` }
      )
    )
  }

  decos.push(
    Decoration.widget(
      start,
      () => {
        const el = document.createElement('span')
        el.className = 'fe-container-icon'
        el.textContent = icon
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

function buildDecorations(
  state: EditorState,
  isDark: boolean,
  stamp: number,
  openAccordions: string[],
  openSources: string[]
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
          icon.textContent = config.icon
          return icon
        },
        { side: -1 }
      )
    )

    // 手风琴：标题行末尾挂一个开合按钮（位置夹在段内，越界会让 ProseMirror 抛错）
    if (isAccordion) {
      const togglePos = Math.min(block.pos + open[0].length + 1, block.pos + contentSize)
      decos.push(
        Decoration.widget(
          togglePos,
          (view) => {
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.contentEditable = 'false'
            btn.className = `fe-accordion-toggle${collapsed ? '' : ' is-open'}`
            btn.title = collapsed ? '展开内容' : '收起内容'
            btn.textContent = '▸'
            btn.addEventListener('mousedown', (event) => event.preventDefault())
            btn.addEventListener('click', (event) => {
              event.preventDefault()
              event.stopPropagation()
              toggleAccordion(view, bodyKey)
            })
            return btn
          },
          { side: 1, key: `accordion-toggle-${collapsed}` }
        )
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

    // 3.2 普通代码块：块首插入行号轴
    if (node.type.name === 'code_block') {
      const lineCount = Math.max(1, node.textContent.split('\n').length)
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
            head.innerHTML = `<span class="fe-alert-icon">${config.icon}</span><span>${config.label}</span>`
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
      decos.push(
        Decoration.widget(pos + node.nodeSize, (view) => createTocCard(items, view), {
          side: 1,
          key: `toc-${items.map((item) => `${item.level}:${item.text}`).join('|')}`,
        })
      )
    }

    return true
  })

  return DecorationSet.create(doc, decos)
}

/** 目录卡片：点击用编辑器 view 派发选区并滚动，不去查 DOM */
function createTocCard(items: TocItem[], view: EditorView): HTMLElement {
  const card = document.createElement('div')
  card.className = 'fe-toc-card'
  card.contentEditable = 'false'

  const head = document.createElement('div')
  head.className = 'fe-toc-head'
  head.innerHTML = `<span>📑 本文目录 (TOC)</span><span class="fe-toc-count">${items.length} 个小节</span>`
  card.appendChild(head)

  if (!items.length) {
    const empty = document.createElement('div')
    empty.className = 'fe-toc-empty'
    empty.textContent = '暂无标题'
    card.appendChild(empty)
    return card
  }

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
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos), 1)).scrollIntoView()
      )
      view.focus()
    })
    list.appendChild(row)
  })
  card.appendChild(list)
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
        init: () => ({ open: [], sourceOpen: [] }),
        apply(tr, value) {
          const meta = tr.getMeta(enhancePluginKey) as
            | { accordion?: string; mermaidSource?: { key: string; showSource: boolean } }
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
            pluginState?.sourceOpen ?? []
          )
        },
      },
    })
)
