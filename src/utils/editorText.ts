/**
 * 引擎无关的纯文本变换函数。
 *
 * 这一层的存在理由：cherry 与 milkdown 两个内核的「块级操作」（排序、去重、缩进、
 * 加标题…）在语义上完全一样，差别只在「怎么把结果写回去」——Cherry 走 CM6 的
 * view.dispatch，Milkdown 走 ProseMirror 的结构命令或节点重排。
 *
 * 所以把「算什么」抽到这里、把「怎么应用」留给各自的 adapter：
 * 一处实现，两侧一致，也不会因为新增一个内核就重写一遍。
 *
 * 约定：所有接收 `lines: string[]` 的函数都返回新数组，不修改入参。
 */

/** 把 Markdown 粗略转成纯文本，用于「复制全文（纯文本）」 */
export function stripMarkdownToPlain(markdown: string): string {
  return stripInlineFormat(markdown)
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
    .replace(/^[ \t]*`{3,}.*$/gm, '')
    .replace(/^[ \t]*~~~/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*\|.*\|[ \t]*$/gm, (row) =>
      row
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim())
        .join('  ')
    )
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 常见内联标记，长的排前面，避免 ** 被 * 先吃掉 */
const INLINE_PATTERNS: RegExp[] = [
  /\*\*([\s\S]+?)\*\*/g,
  /__([\s\S]+?)__/g,
  /~~([\s\S]+?)~~/g,
  /==([\s\S]+?)==/g,
  /`([^`]+?)`/g,
  /<\/?sub>/gi,
  /<\/?sup>/gi,
  /(?<![*\w])\*(?!\*)([\s\S]+?)(?<!\*)\*(?![*\w])/g,
  /(?<![_\w])_(?!_)([\s\S]+?)(?<!_)_(?![_\w])/g,
]

/** 循环剥掉内联标记（可能有嵌套，如 **`code`**） */
export function stripInlineFormat(text: string): string {
  let result = text
  for (let round = 0; round < 4; round++) {
    let next = result
    for (const pattern of INLINE_PATTERNS) {
      // 用函数式替换：<sub>/<sup> 这类模式没有捕获组，传 $1 会被当成字面量
      next = next.replace(pattern, (_match, captured?: string) =>
        typeof captured === 'string' ? captured : ''
      )
    }
    if (next === result) break
    result = next
  }
  return result
}

const MD_SPECIAL = /[\\`*_{}[\]()#+\-.!|>~]/g

export function escapeMarkdownChars(text: string): string {
  return text.replace(MD_SPECIAL, '\\$&')
}

export function unescapeMarkdownChars(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
}

/** 空格换算成缩进用的两个空格；Tab 视作一个缩进级别 */
const INDENT_UNIT = '  '

/* ------------------------------------------------------------------ *
 * 行级
 * ------------------------------------------------------------------ */

const HEADING_RE = /^(#{1,6})[ \t]+/

/**
 * 标题级别切换；level 传 0 表示「正文」（去掉标题标记）。
 * 需要先知道「是不是整段都已经在这个级别」才能决定切换方向，所以这里多收一个
 * allAtLevel —— 该判断在 Cherry 侧读 CM6 文档、Milkdown 侧读 ProseMirror 节点，
 * 只有调用方拿得到，因此留在外面。
 */
export function setHeadingText(lines: string[], level: number, allAtLevel: boolean): string[] {
  return lines.map((text) => {
    const match = text.match(HEADING_RE)
    if (allAtLevel || level === 0) {
      return match ? text.slice(match[0].length) : text
    }
    const marker = '#'.repeat(level) + ' '
    return match ? marker + text.slice(match[0].length) : marker + text
  })
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 按行切换行首前缀（列表 / 待办 / 引用）。整段都已有该前缀时改为移除，即再点一次取消。 */
export function toggleLinePrefixText(
  lines: string[],
  prefix: string,
  allHave: boolean,
  matcher?: RegExp
): string[] {
  const test = matcher ?? new RegExp('^[ \\t]*' + escapeRegex(prefix))
  return lines.map((text) => {
    const indent = (text.match(/^[ \t]*/) || [''])[0]
    if (allHave) {
      const match = text.match(test)
      return match && match[0].length > 0 ? text.slice(match[0].length) : text
    }
    return text.slice(0, indent.length) + prefix + text.slice(indent.length)
  })
}

/** 有序列表的匹配式，与 toggleOrderedListText 共用 */
export const ORDERED_LIST_RE = /^[ \t]*\d+[.)][ \t]+/

/** 有序列表：重排为 1. 2. 3.，整段已是则取消 */
export function toggleOrderedListText(lines: string[], allHave: boolean): string[] {
  let index = 0
  return lines.map((text) => {
    const indent = (text.match(/^[ \t]*/) || [''])[0]
    const match = text.match(ORDERED_LIST_RE)
    if (allHave) {
      return match ? text.slice(match[0].length) : text
    }
    index += 1
    const marker = `${index}. `
    return match
      ? marker + text.slice(match[0].length)
      : text.slice(0, indent.length) + marker + text.slice(indent.length)
  })
}

/** 缩进增减：加两个空格 / 去掉最多两个前导空格或一个 Tab */
export function indentLinesText(lines: string[], delta: number): string[] {
  return lines.map((text) => {
    if (!text.trim()) return text
    if (delta > 0) return INDENT_UNIT.repeat(delta) + text
    const lead = (text.match(/^[ \t]*/) || [''])[0]
    if (!lead) return text
    const removed = lead.startsWith('\t') ? 1 : Math.min(lead.length, INDENT_UNIT.length)
    return text.slice(removed)
  })
}

export function trimTrailingSpacesText(lines: string[]): string[] {
  return lines.map((text) => text.replace(/[ \t]+$/, ''))
}

/** 行排序：中文按拼音，单行时原样返回（排序无意义） */
export function sortLinesText(lines: string[], descending = false): string[] {
  if (lines.length <= 1) return [...lines]
  const sorted = [...lines].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  if (descending) sorted.reverse()
  return sorted
}

/** 行去重：保留首次出现顺序，丢掉后续重复行 */
export function dedupeLinesText(lines: string[]): string[] {
  const seen = new Set<string>()
  return lines.filter((line) => {
    if (seen.has(line)) return false
    seen.add(line)
    return true
  })
}

/** 合并多余空行：连续两个以上空行压成一个 */
export function collapseBlankLinesInText(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}

/* ------------------------------------------------------------------ *
 * 内联
 * ------------------------------------------------------------------ */

/**
 * 内联包裹的「再点一次取消」语义。
 * 返回 null 表示内容不变（两侧据此跳过 dispatch，避免污染撤销栈）。
 */
export function wrapText(
  text: string,
  prefix: string,
  suffix: string
): { text: string; wrapped: boolean } {
  const isWrapped =
    text.startsWith(prefix) &&
    text.endsWith(suffix) &&
    text.length >= prefix.length + suffix.length

  return isWrapped
    ? { text: text.slice(prefix.length, text.length - suffix.length), wrapped: false }
    : { text: prefix + text + suffix, wrapped: true }
}
