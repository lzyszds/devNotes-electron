/**
 * 草稿纸用的极简 Markdown 渲染。
 *
 * 刻意**不复用主编辑器那套 marked / Milkdown**：草稿纸是一个随手记东西的
 * 小窗，要的是秒开。拉一整套渲染引擎进来，为了几行待办清单不值得。
 *
 * 只做最常用的几种块与行内格式。安全上有一条硬约束：**所有用户文本先转义
 * 再拼 HTML**，任何标签都由本文件自己产生。这样即使草稿里写了
 * `<img src=x onerror=...>`，出来的也是纯文本。
 */

/** HTML 实体转义。所有进入输出的文本都必须先过这里 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 行内格式。
 *
 * 输入必须是**已经转义过**的文本 —— 这里只负责往里插标签。
 * 代码要先处理：`a *b* c` 里的星号在代码里不该变成斜体。
 */
function inline(raw: string): string {
  // 先把行内代码抠出来占位，免得里面的 * 和 _ 被后面的规则误伤
  const codes: string[] = []
  let text = raw.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })

  text = text
    // 链接：只放行 http/https/mailto，其余（含 javascript:）一律当普通文本
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => `<code>${codes[Number(index)]}</code>`)
}

/** 转义 + 行内格式，块级渲染里对每段文本都走这一道 */
function formatInline(text: string): string {
  return inline(escapeHtml(text))
}

/**
 * 把草稿渲染成 HTML。
 *
 * 逐行状态机，支持：标题、无序/有序列表（含任务清单）、引用、围栏代码块、
 * 分隔线、段落。识别不出的行当作普通段落。
 */
export function renderScratchPreview(source: string): string {
  if (!source.trim()) return ''

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []

  /** 当前打开的列表容器：null 表示不在列表里 */
  let listKind: 'ul' | 'ol' | null = null
  let inCode = false
  let codeBuffer: string[] = []
  let inQuote = false

  const closeList = () => {
    if (listKind) {
      out.push(`</${listKind}>`)
      listKind = null
    }
  }
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>')
      inQuote = false
    }
  }
  /** 非列表行出现时，先把列表和引用都收干净，避免标签交叉 */
  const closeBlocks = () => {
    closeList()
    closeQuote()
  }

  for (const line of lines) {
    // 围栏代码块：``` 开头与结尾之间原样输出
    const fence = /^\s*```\s*(\S*)\s*$/.exec(line)
    if (fence) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
        codeBuffer = []
        inCode = false
      } else {
        closeBlocks()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    if (!line.trim()) {
      closeBlocks()
      continue
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeBlocks()
      out.push('<hr />')
      continue
    }

    // 标题
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      closeBlocks()
      const level = heading[1].length
      out.push(`<h${level}>${formatInline(heading[2])}</h${level}>`)
      continue
    }

    // 引用
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      closeList()
      if (!inQuote) {
        out.push('<blockquote>')
        inQuote = true
      }
      out.push(`<p>${formatInline(quote[1])}</p>`)
      continue
    }
    closeQuote()

    // 任务清单 - [ ] / - [x]
    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task) {
      if (listKind !== 'ul') {
        closeList()
        out.push('<ul class="scratch-task">')
        listKind = 'ul'
      }
      const checked = task[1].toLowerCase() === 'x'
      out.push(
        `<li class="scratch-task-item${checked ? ' is-done' : ''}">` +
          `<span class="scratch-check">${checked ? '✓' : ''}</span>` +
          `<span>${formatInline(task[2])}</span></li>`,
      )
      continue
    }

    // 无序列表
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      if (listKind !== 'ul') {
        closeList()
        out.push('<ul>')
        listKind = 'ul'
      }
      out.push(`<li>${formatInline(bullet[1])}</li>`)
      continue
    }

    // 有序列表
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      if (listKind !== 'ol') {
        closeList()
        out.push('<ol>')
        listKind = 'ol'
      }
      out.push(`<li>${formatInline(ordered[1])}</li>`)
      continue
    }

    // 普通段落
    closeList()
    out.push(`<p>${formatInline(line)}</p>`)
  }

  // 收尾：文件在代码块里结束时要把缓冲吐出来
  if (inCode && codeBuffer.length) {
    out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
  }
  closeBlocks()

  return out.join('\n')
}
