/**
 * 笔记字数统计。
 *
 * 原先这段正则内联在 NotesTool 的 useMemo 里，「当前文档信息」快捷插入也需要
 * 同一套口径，抽到这里保证两处一致。
 */
export interface DocStats {
  /** 中文字符数 */
  chineseChars: number
  /** 英文词数 */
  englishWords: number
  /** 总词数 = 中文 + 英文 */
  totalWords: number
  /** 总字符数 */
  totalChars: number
  /** 总行数 */
  totalLines: number
  /** 预估阅读分钟数 */
  readingTime: number
}

export function computeDocStats(content: string): DocStats {
  const chineseChars = (content.match(/[一-龥]/g) || []).length
  const englishWords = (content.match(/[a-zA-Z0-9_-]+/g) || []).length
  const totalWords = chineseChars + englishWords
  const totalChars = content.length
  const totalLines = content ? content.split('\n').length : 0
  const readingTime = Math.max(1, Math.ceil(totalWords / 300))
  return { chineseChars, englishWords, totalWords, totalChars, totalLines, readingTime }
}
