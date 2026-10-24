import type { KeyboardEvent } from 'react'

const INDENT_SPACES = '  '

export interface TextareaIndentOptions {
  /** 是否启用回车自动继承上一行缩进，默认开启 */
  enableAutoIndent?: boolean
  /** 缩进字符，默认 2 个空格 */
  indentSpaces?: string
}

/**
 * 为任意 textarea 元素添加现代代码编辑器的 Tab 缩进支持：
 * 1. 单行光标按 Tab：插入 2 个空格，光标后移 2 位
 * 2. 单行光标按 Shift+Tab：行首去除至多 2 个空格反缩进
 * 3. 多行选中文本按 Tab：选中行批量增加 2 个空格缩进，并保持选区
 * 4. 多行选中文本按 Shift+Tab：选中行批量去除缩进，并保持选区
 * 5. 回车自动缩进：回车后新行自动继承上一行的缩进空格，在 { 或 [ 后自动增加一级缩进
 */
export function handleTextareaKeyDown(
  e: KeyboardEvent<HTMLTextAreaElement>,
  onChange?: (val: string) => void,
  options: TextareaIndentOptions = {}
) {
  const textarea = e.currentTarget
  const indent = options.indentSpaces ?? INDENT_SPACES
  const tabSize = indent.length
  const enableAutoIndent = options.enableAutoIndent ?? true

  // 1. 处理 Tab / Shift+Tab 缩进与反缩进
  if (e.key === 'Tab') {
    e.preventDefault()

    const { value, selectionStart, selectionEnd } = textarea
    const isMultiLine =
      selectionStart !== selectionEnd && value.slice(selectionStart, selectionEnd).includes('\n')

    if (!isMultiLine && !e.shiftKey) {
      // 单行单光标按 Tab：直接在光标处插入 2 个空格
      // 优先使用 execCommand 以保留浏览器的撤销/重做历史 (Undo/Redo)
      if (document.queryCommandSupported?.('insertText')) {
        document.execCommand('insertText', false, indent)
      } else {
        const nextValue = value.substring(0, selectionStart) + indent + value.substring(selectionEnd)
        textarea.value = nextValue
        textarea.selectionStart = textarea.selectionEnd = selectionStart + tabSize
        onChange?.(nextValue)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return
    }

    // 选中了多行，或单行按 Shift + Tab 反缩进
    const lineStartIndex = value.lastIndexOf('\n', selectionStart - 1) + 1
    let lineEndIndex = value.indexOf('\n', selectionEnd)
    if (lineEndIndex === -1) lineEndIndex = value.length

    const selectedLines = value.substring(lineStartIndex, lineEndIndex).split('\n')

    let newSelectedLines: string[]
    let startOffset = 0
    let endOffset = 0

    if (e.shiftKey) {
      // Shift + Tab：反缩进
      newSelectedLines = selectedLines.map((line, index) => {
        let removed = 0
        if (line.startsWith(indent)) {
          removed = tabSize
        } else if (line.startsWith(' ')) {
          removed = 1
        }
        if (index === 0) {
          startOffset = -removed
        }
        endOffset -= removed
        return line.slice(removed)
      })
    } else {
      // 多行批量 Tab 缩进
      newSelectedLines = selectedLines.map((line, index) => {
        if (index === 0) {
          startOffset = tabSize
        }
        endOffset += tabSize
        return indent + line
      })
    }

    const replaced = newSelectedLines.join('\n')
    const nextValue = value.substring(0, lineStartIndex) + replaced + value.substring(lineEndIndex)

    textarea.value = nextValue
    // 保持原来的选中范围，并相应平移
    const newStart = Math.max(lineStartIndex, selectionStart + startOffset)
    const newEnd = Math.max(newStart, selectionEnd + endOffset)
    textarea.selectionStart = newStart
    textarea.selectionEnd = newEnd

    onChange?.(nextValue)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }

  // 2. 回车自动缩进
  if (enableAutoIndent && e.key === 'Enter') {
    const { value, selectionStart, selectionEnd } = textarea
    if (selectionStart !== selectionEnd) return

    // 找到当前行开头的缩进空格
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
    const currentLine = value.slice(lineStart, selectionStart)
    const match = currentLine.match(/^[ \t]+/)

    if (match) {
      e.preventDefault()
      const indentStr = match[0]
      // 如果以 { 或 [ 结尾，额外增加一级缩进
      const extraIndent = /[{[]\s*$/.test(currentLine) ? indent : ''
      const insertion = '\n' + indentStr + extraIndent

      if (document.queryCommandSupported?.('insertText')) {
        document.execCommand('insertText', false, insertion)
      } else {
        const nextValue = value.substring(0, selectionStart) + insertion + value.substring(selectionEnd)
        textarea.value = nextValue
        const nextCursor = selectionStart + insertion.length
        textarea.selectionStart = textarea.selectionEnd = nextCursor
        onChange?.(nextValue)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }
}
