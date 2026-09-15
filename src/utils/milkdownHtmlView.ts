/**
 * 内联 HTML 的渲染。
 *
 * commonmark 的默认 schema 里**已经包含** `htmlSchema`
 * （`preset-commonmark` 的 schema 数组里有 `htmlAttr, htmlSchema`），
 * 定义是 `atom: true, inline: true, group: 'inline'`，`attrs.value` 存原始 HTML 字符串，
 * 序列化时原样写回 Markdown。所以高亮/上标/下标不需要自定 mark，也不需要 remark 插件。
 *
 * 但默认没有 NodeView，`html` 节点会以纯文本形式渲染出来 ——
 * 写 `<mark>重点</mark>` 看到的就是字面量。这里补一个 NodeView 把它渲染成真正的元素。
 */
import { $view } from '@milkdown/kit/utils'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'

/**
 * 认得的标签直接渲染成对应元素；认不得的退化成等宽小标签，
 * 至少让用户看得出「这里有个 HTML 片段」，而不是把它当正文。
 * span 是给字号/颜色用的（Cherry 的字号也写 `<span style="font-size:…">`）。
 */
const KNOWN_TAGS = [
  'sup',
  'sub',
  'mark',
  'u',
  'kbd',
  'br',
  'small',
  'del',
  'ins',
  'abbr',
  'span',
] as const

/**
 * 允许透传到元素上的内联样式白名单。
 *
 * 这里是把「任意 HTML 字符串」渲染进页面的口子，所以按白名单放行而不是黑名单：
 * `position`/`background-image`/`behavior` 之类能拿来做覆盖或外链的属性一律进不来。
 * 列表外的声明直接被丢掉，元素其余部分照常渲染。
 */
const ALLOWED_STYLE_PROPS = ['color', 'background-color', 'font-size', 'line-height'] as const

/** 从 `<tag ...>内容</tag>` 或 `<tag/>` 里取出标签名、属性串与内容 */
function parseInlineHtml(
  value: string
): { tag: string; attrs: string; inner: string; selfClosing: boolean } | null {
  const match = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^>]*)?)>([\s\S]*?)<\s*\/\s*\1\s*>$/.exec(value)
  if (match) {
    return { tag: match[1].toLowerCase(), attrs: match[2], inner: match[3], selfClosing: false }
  }

  const selfClosing = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^>]*)?)\/\s*>$/.exec(value)
  if (selfClosing) {
    return {
      tag: selfClosing[1].toLowerCase(),
      attrs: selfClosing[2],
      inner: '',
      selfClosing: true,
    }
  }

  return null
}

/** 把属性串里的 style 声明按白名单落到元素上，其余属性一律忽略 */
function applyAllowedStyle(el: HTMLElement, attrs: string) {
  const match = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
  const raw = match?.[1] ?? match?.[2]
  if (!raw) return

  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const prop = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (!value) continue
    if (!(ALLOWED_STYLE_PROPS as readonly string[]).includes(prop)) continue
    el.style.setProperty(prop, value)
  }
}

/**
 * 内容里还套着一层可识别的内联标签时递归渲染，而不是当字面量。
 *
 * 组合操作会产出 `<u><span style="color:…">x</span></u>` 这种嵌套 —— 只认最外层的
 * 话，内层会以源码形式原样显示出来。递归的入参一定比上一层短，不会打转；
 * 叶子一律走 textContent，绝不 innerHTML。
 */
function renderContent(inner: string): Node {
  return parseInlineHtml(inner) ? renderInlineHtml(inner) : document.createTextNode(inner)
}

/**
 * `html` 节点是 atom（不可编辑内部），所以把内容整个塞进一个 span 里渲染即可，
 * 不需要维护单独的 contentDOM。
 */
function renderInlineHtml(value: string): HTMLElement {
  const parsed = parseInlineHtml(value)

  if (!parsed) {
    // 认不得的片段：等宽小字 + 虚线框，提示「这里是原始 HTML」
    const fallback = document.createElement('span')
    fallback.className = 'md-html-raw'
    fallback.textContent = value
    return fallback
  }

  if (parsed.selfClosing || parsed.tag === 'br') {
    // 自闭合标签没有内容，直接返回元素本身
    return document.createElement(parsed.tag === 'br' ? 'br' : 'span')
  }

  const known = (KNOWN_TAGS as readonly string[]).includes(parsed.tag)
  // 用 span 承载 + 类名，而不是直接 createElement(tag)：
  // 任意标签名都能建出来，但字体/颜色要由 CSS 统一控制，也避免引入意外元素语义
  const el = document.createElement(known ? parsed.tag : 'span')
  // 内容是 textContent 或下一层元素，绝不 innerHTML —— 这段字符串来自 Markdown 原文
  el.appendChild(renderContent(parsed.inner))
  if (!known) el.className = 'md-html-raw'
  else applyAllowedStyle(el, parsed.attrs)
  return el
}

// $view 收的是 $Node 本身，所以取 htmlSchema.node —— 传整个 $NodeSchema 会类型不匹配
export const inlineHtmlView = $view(htmlSchema.node, (): NodeViewConstructor => {
  return (node) => {
    const dom = renderInlineHtml(String(node.attrs.value ?? ''))
    // atom 节点没有可编辑内容，contentDOM 留空即可
    return { dom }
  }
})
