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
  /** Cherry 的提示块语法 */
  panel: ['::: primary 标题', '内容', ':::', ''].join('\n'),
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
