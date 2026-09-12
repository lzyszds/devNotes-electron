/**
 * 本地规则版「智能规范化排版」。
 *
 * 项目目前没有任何 AI 基础设施（无 API Key 配置、无 provider 抽象），所以先用纯规则实现，
 * 接口留成 normalizeMarkdown(text, { level })，将来接模型只需换实现。
 *
 * 重要：代码内容绝不能被改动。围栏块、行内代码、行内公式在处理前会先抽成
 * Unicode 私用区占位符（沿用 termProtection.ts 的手法），处理完再原样还原。
 */

export type FormatLevel = 'basic' | 'full'

export interface FormatResult {
  text: string
  /** 实际发生改动的规则名，用于 toast 提示 */
  changes: string[]
}

// 占位符用 Unicode 私用区字符，正常文本里不会出现
const PH_OPEN = '\uE000'
const PH_CLOSE = '\uE001'

// 中日韩：CJK 统一表意文字 + 日文假名 + 谚文
const CJK_CLASS = '\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af'

/* ------------------------------------------------------------------ *
 * 代码保护
 * ------------------------------------------------------------------ */

interface MaskResult {
  masked: string
  slots: string[]
}

/** 把 ```/~~~ 围栏块整块抽成单行占位符；未闭合的围栏一路吞到文末（宁可不动也不改坏） */
function maskFences(text: string): MaskResult {
  const lines = text.split('\n')
  const slots: string[] = []
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const open = lines[i].match(/^[ \t]*(`{3,}|~{3,})/)
    if (!open) {
      out.push(lines[i])
      i += 1
      continue
    }

    const marker = open[1][0]
    const minLength = open[1].length
    let j = i + 1
    let closed = false
    while (j < lines.length) {
      const close = lines[j].match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
      if (close && close[1][0] === marker && close[1].length >= minLength) {
        closed = true
        break
      }
      j += 1
    }

    const end = closed ? j : lines.length - 1
    slots.push(lines.slice(i, end + 1).join('\n'))
    out.push(PH_OPEN + (slots.length - 1) + PH_CLOSE)
    i = end + 1
  }

  return { masked: out.join('\n'), slots }
}

/** 行内代码与行内公式，逐行替换成占位符 */
function maskInline(text: string, slots: string[]): string {
  const put = (match: string) => {
    slots.push(match)
    return PH_OPEN + (slots.length - 1) + PH_CLOSE
  }
  return text.replace(/`[^`\n]+`/g, put).replace(/\$[^$\n]+\$/g, put)
}

function restorePlaceholders(text: string, slots: string[]): string {
  let out = text
  for (let i = slots.length - 1; i >= 0; i--) {
    out = out.split(PH_OPEN + i + PH_CLOSE).join(slots[i])
  }
  return out
}

function isFencePlaceholder(line: string): boolean {
  return new RegExp('^[ \\t]*' + PH_OPEN + '\\d+' + PH_CLOSE + '[ \\t]*$').test(line)
}

/* ------------------------------------------------------------------ *
 * 基础档规则
 * ------------------------------------------------------------------ */

/** `#标题` → `# 标题`，并去掉 ATX 闭合的尾随 `#` */
function normalizeHeadings(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const match = line.match(/^([ \t]*)(#{1,6})[ \t]*(\S.*)$/)
      if (!match) return line
      // 尾随 # 前必须有空白，否则会吃掉「C#」这类正文
      const body = match[3].replace(/[ \t]+#+[ \t]*$/, '').replace(/[ \t]+$/, '')
      return match[1] + match[2] + ' ' + body
    })
    .join('\n')
}

/** 无序标记统一成 `-`、标记后补空格；分割线不动 */
function normalizeLists(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // --- / *** / ___ 是分割线，不是列表
      if (/^[ \t]*([-*_])[ \t]*(\1[ \t]*){2,}$/.test(line)) return line
      return line
        .replace(/^([ \t]*)[*+]([ \t]+)(?=\S)/, '$1-$2')
        .replace(/^([ \t]*)([*+])(?=[^\s\-*+])/, '$1- ')
        .replace(/^([ \t]*)-(?=[^\s\-*+])/, '$1- ')
        .replace(/^([ \t]*\d+[.)])(?=\S)/, '$1 ')
    })
    .join('\n')
}

/** `__x__` → `**x**`、`_x_` → `*x*`（带边界保护，不动 snake_case） */
function normalizeEmphasis(text: string): string {
  return text
    .replace(/__([^_\n]+)__/g, '**$1**')
    .replace(/(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '*$1*')
}

/** 中日韩文字与拉丁字母/数字之间插一个半角空格 */
function addCJKLatinSpacing(text: string): string {
  return text
    .replace(new RegExp('([' + CJK_CLASS + '])([A-Za-z0-9])', 'g'), '$1 $2')
    .replace(new RegExp('([A-Za-z0-9])([' + CJK_CLASS + '])', 'g'), '$1 $2')
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}

function isTableRow(line: string): boolean {
  return /^[ \t]*\|.*\|[ \t]*$/.test(line)
}

/** 标题、代码块、表格前后保证恰好一个空行 */
function normalizeBlocks(text: string): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const prev = out.length ? out[out.length - 1] : undefined
    const prevNonBlank = prev !== undefined && prev.trim() !== ''
    const startsGroup =
      /^[ \t]*#{1,6}[ \t]/.test(line) ||
      isFencePlaceholder(line) ||
      (isTableRow(line) && !isTableRow(prev ?? ''))
    const endsGroup =
      prev !== undefined &&
      line.trim() !== '' &&
      (isFencePlaceholder(prev) || (isTableRow(prev) && !isTableRow(line)))
    if (prevNonBlank && (startsGroup || endsGroup)) out.push('')
    out.push(line)
  }
  return out.join('\n')
}

function trimTrailingSpaces(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
}

function ensureFinalNewline(text: string): string {
  const body = text.replace(/\n+$/, '')
  return body ? body + '\n' : ''
}

/* ------------------------------------------------------------------ *
 * 完整档额外规则
 * ------------------------------------------------------------------ */

/** 重复标点压缩，中文语境里的 `...` 转成省略号 */
function squeezePunctuation(text: string): string {
  return text
    .replace(/([!?！？])\1+/g, '$1')
    .replace(/。{2,}/g, '。')
    .replace(new RegExp('([' + CJK_CLASS + '])\\.{3,}', 'g'), '$1……')
    .replace(new RegExp('\\.{3,}([' + CJK_CLASS + '])', 'g'), '……$1')
}

/** 全角字母数字转半角（只管字母数字，标点不动） */
function toHalfWidthAlnum(text: string): string {
  return text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  )
}

/** 表格分隔行补空格：`|---|:--:|` → `| --- | :--: |` */
function alignTableDelimiter(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!/^[ \t]*\|[\s:|-]+\|[ \t]*$/.test(line)) return line
      const cells = line.trim().replace(/^\||\|$/g, '').split('|')
      return '|' + cells.map((cell) => ' ' + cell.trim() + ' ').join('|') + '|'
    })
    .join('\n')
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

/**
 * 规范化排版。基础档只做安全规整，完整档额外动标点与全角字符。
 * 返回的 changes 为空表示原文已经规范，调用方可以提示「无需调整」。
 */
export function normalizeMarkdown(input: string, level: FormatLevel = 'basic'): FormatResult {
  if (!input.trim()) return { text: input, changes: [] }

  const changes: string[] = []
  const fence = maskFences(input.replace(/\r\n?/g, '\n'))
  const slots = fence.slots
  let text = maskInline(fence.masked, slots)

  const step = (label: string, fn: (value: string) => string) => {
    const next = fn(text)
    if (next !== text) {
      text = next
      changes.push(label)
    }
  }

  step('标题', normalizeHeadings)
  step('列表', normalizeLists)
  step('强调符号', normalizeEmphasis)
  step('中英文间距', addCJKLatinSpacing)

  if (level === 'full') {
    step('标点', squeezePunctuation)
    step('全角半角', toHalfWidthAlnum)
    step('表格对齐', alignTableDelimiter)
  }

  step('空行', collapseBlankLines)
  step('块间距', normalizeBlocks)
  step('行尾空格', trimTrailingSpaces)
  step('结尾换行', ensureFinalNewline)

  return { text: restorePlaceholders(text, slots), changes }
}
