/**
 * 「快捷插入」用到的文本片段。
 *
 * 全部是纯函数：只负责拼出要插入的 Markdown 文本，插入动作交给
 * cherry.insert() 完成（沿用光标位置，并进入编辑器自己的撤销栈）。
 */
import { computeDocStats } from './markdownStats'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 2026-09-13 */
export function formatDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 14:32 */
export function formatTime(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 2026-09-13 14:32 */
export function formatDateTime(date = new Date()): string {
  return `${formatDate(date)} ${formatTime(date)}`
}

/** 秒级 Unix 时间戳 */
export function formatTimestamp(date = new Date()): string {
  return String(Math.floor(date.getTime() / 1000))
}

/** 中文长日期：2026年9月13日 */
export function formatDateCN(date = new Date()): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/** Front Matter 头 */
export function frontMatter(title: string, date = new Date()): string {
  return ['---', `title: ${title}`, `date: ${formatDate(date)}`, 'tags: []', '---', ''].join('\n')
}

export const SNIPPETS = {
  /** 代码块，光标停在语言标识处 */
  codeBlock: '```js\n\n```\n',
  /** 3 列 2 行的空表格 */
  table: ['| 列 1 | 列 2 | 列 3 |', '| --- | --- | --- |', '|  |  |  |', ''].join('\n'),
  hr: '\n---\n',
  toc: '\n[TOC]\n',
  todo: '- [ ] ',
  quote: '> ',
  /**
   * 提示块。类型用 Cherry 的默认值 `primary` —— 它同时是 Cherry 认不出类型时的
   * 回落值，也就是说 Cherry 那边无论怎么写都会落到这一种；Milkdown 的
   * milkdownEnhance.CONTAINERS 早先漏了它，现已补上（含配套的 --primary 色调）。
   * 两边都认 `::: primary`，切内核不会变样。
   */
  panel: ['::: primary 提示说明', '这里是内容', ':::', ''].join('\n'),
  /**
   * 项目演进时间线。
   *
   * 采用与样板文档（notesStore.ts）完全一致的 Mermaid timeline 语法：
   * 在 Cherry 与 Milkdown 两个内核下均天然高保真渲染为矢量时间线卡片，
   * 彻底规避私有容器语法在不同解析器间的方言冲突。
   */
  timeline: [
    '```mermaid',
    'timeline',
    '    title 项目演进时间线',
    '    2026 Q1 : 需求分析 : 方案设计',
    '    2026 Q2 : 核心框架搭建 : 交互体验完善',
    '    2026 Q3 : 正式发版 : 持续迭代',
    '```',
    '',
  ].join('\n'),
  /** Mermaid 图表代码块（可被 milkdownEnhance 的 isMermaidBlock 识别并渲染为卡片） */
  mermaid: ['```mermaid', 'graph TD', '  A[开始] --> B[处理]', '  B --> C[完成]', '```', ''].join('\n'),
  /** 脚注语法 */
  footnote: ['[^1]', '', '[^1]: 脚注补充说明内容', ''].join('\n'),
  /** 数学公式块（CommonMark/GFM 兼容的 $$ 片段） */
  math: ['$$', 'f(x) = \\int_{-\\infty}^\\infty \\hat f(\\xi)\\,e^{2 \\pi i \\xi x} \\,d\\xi', '$$', ''].join('\n'),
  image: '![图片描述](https://)',
  link: '[链接文字](https://)',
} as const

/** 「当前文档信息」：标题 + 统计，沿用 NotesTool 同一套口径 */
export function documentInfo(markdown: string, title: string): string {
  const stats = computeDocStats(markdown)
  return [
    '<!-- 当前文档信息 -->',
    `- 标题：${title}`,
    `- 总字数：${stats.totalWords}（中文 ${stats.chineseChars} / 英文 ${stats.englishWords}）`,
    `- 总行数：${stats.totalLines}`,
    `- 总字符数：${stats.totalChars}`,
    `- 预估阅读：约 ${stats.readingTime} 分钟`,
    `- 生成时间：${formatDateTime()}`,
  ].join('\n')
}
