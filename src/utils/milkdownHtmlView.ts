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
 */
const KNOWN_TAGS = ['sup', 'sub', 'mark', 'u', 'kbd', 'br', 'small', 'del', 'ins', 'abbr'] as const

/** 从 `<tag ...>内容</tag>` 或 `<tag/>` 里取出标签名与内容 */
function parseInlineHtml(value: string): { tag: string; inner: string; selfClosing: boolean } | null {
  const match = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>([\s\S]*?)<\s*\/\s*\1\s*>$/.exec(value)
  if (match) return { tag: match[1].toLowerCase(), inner: match[2], selfClosing: false }

  const selfClosing = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?\/\s*>$/.exec(value)
  if (selfClosing) return { tag: selfClosing[1].toLowerCase(), inner: '', selfClosing: true }

  return null
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
  el.textContent = parsed.inner
  if (!known) el.className = 'md-html-raw'
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
