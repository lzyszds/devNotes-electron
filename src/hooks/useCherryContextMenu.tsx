import { useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import {
  AlignLeft,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpAZ,
  Bold,
  Braces,
  CalendarClock,
  CalendarDays,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Clock,
  Code,
  CodeXml,
  Columns2,
  Copy,
  CopyCheck,
  Download,
  Eraser,
  FileCode2,
  FileDown,
  FilePlus2,
  FileText,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  Image,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Maximize2,
  Minus,
  PanelTop,
  Pilcrow,
  Quote,
  Redo2,
  Rows3,
  Scissors,
  ScrollText,
  Search,
  Sparkles,
  SquareCheck,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TextQuote,
  Timer,
  Trash2,
  Type,
  Undo2,
  UnfoldVertical,
  WandSparkles,
} from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { useContextMenu } from '../components/ui/ContextMenu'
import type { ContextMenuItem } from '../components/ui/ContextMenu'
import { useToast } from '../components/ui/Toast'
import { copyText, readText } from '../utils/clipboard'
import {
  dedupeLines,
  escapeMarkdownChars,
  getEditorView,
  getFullText,
  getSelection,
  indentLines,
  redo,
  replaceRange,
  selectAll,
  setFullText,
  setHeading,
  sortLines,
  stripInlineFormat,
  toggleLinePrefix,
  toggleOrderedList,
  trimTrailingSpaces,
  undo,
  unescapeMarkdownChars,
  unwrapSelection,
  wrapSelection,
} from '../utils/editorView'
import { normalizeMarkdown } from '../utils/markdownFormat'
import {
  SNIPPETS,
  documentInfo,
  formatDate,
  formatDateCN,
  formatDateTime,
  formatTime,
  formatTimestamp,
  frontMatter,
} from '../utils/markdownSnippets'

/**
 * Cherry 实例上我们真正用到的那部分能力。
 * 全部可选：Cherry 升级后某个字段改名也不会在类型层炸掉，运行时用 typeof 守卫。
 */
export interface CherryEditorApi {
  getMarkdown?: () => string
  getHtml?: () => string
  toolbar?: { toolbarHandlers?: Record<string, unknown> }
}

interface Options {
  cherryRef: RefObject<CherryEditorApi | null>
  /** 当前笔记标题，用于 Front Matter 与「当前文档信息」 */
  title: string
}

const ICON = 'w-3.5 h-3.5'

/** 把 Markdown 粗略转成纯文本，用于「复制全文（纯文本）」 */
function stripMarkdownToPlain(markdown: string): string {
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

/**
 * Cherry 编辑区与预览区的右键菜单。
 *
 * 菜单项在打开菜单的那一刻构建，选区/全文都按当时的状态快照捕获 ——
 * 点击菜单按钮会让内容区失焦，届时再读选区可能已经不准。
 */
export function useCherryContextMenu({ cherryRef, title }: Options) {
  const { openContextMenu } = useContextMenu()
  const { showToast } = useToast()

  const toastCopy = useCallback(
    async (text: string, okLabel: string) => {
      const ok = await copyText(text)
      showToast(ok ? okLabel : '复制失败', ok ? 'default' : 'error')
    },
    [showToast]
  )

  /** 插入片段；cursor 是相对插入文本开头的偏移，默认落在末尾 */
  const insertSnippet = useCallback(
    (view: EditorView, text: string, cursorFromStart?: number) => {
      const sel = getSelection(view)
      const anchor = sel.from + (cursorFromStart ?? text.length)
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor },
      })
      view.focus()
    },
    []
  )

  /* ---------------- 编辑区 ---------------- */

  const onEditorContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      const cherry = cherryRef.current
      const view = getEditorView(cherry)
      if (!view) return

      const sel = getSelection(view)
      const fullText = getFullText(view)
      const hasText = fullText.trim().length > 0

      // Cherry 只在工具栏配置里出现过的菜单名才有 handler，取不到就把该项置灰
      const handler = (name: string): (() => void) | null => {
        const candidate = cherry?.toolbar?.toolbarHandlers?.[name]
        return typeof candidate === 'function' ? (candidate as () => void) : null
      }
      const runHandler = (name: string) => () => {
        const fn = handler(name)
        if (!fn) {
          showToast('该功能在当前版本不可用', 'error')
          return
        }
        try {
          fn()
        } catch (error) {
          console.error(`工具栏动作 ${name} 失败:`, error)
          showToast('操作失败', 'error')
        }
      }

      const disabledWithoutHandler = (name: string) => handler(name) === null

      const editorItems: ContextMenuItem[] = [
        {
          id: 'cut',
          label: '剪切',
          shortcut: '⌘X',
          icon: <Scissors className={ICON} />,
          disabled: sel.empty,
          onSelect: async () => {
            if (!(await copyText(sel.text))) {
              showToast('剪切失败', 'error')
              return
            }
            replaceRange(view, sel.from, sel.to, '')
            showToast('已剪切')
          },
        },
        {
          id: 'copy',
          label: '复制',
          shortcut: '⌘C',
          icon: <Copy className={ICON} />,
          disabled: sel.empty,
          onSelect: () => void toastCopy(sel.text, '已复制选中内容'),
        },
        {
          id: 'paste',
          label: '粘贴',
          shortcut: '⌘V',
          icon: <Code className={ICON} />,
          onSelect: async () => {
            const text = await readText()
            if (!text) {
              showToast('剪贴板为空', 'error')
              return
            }
            replaceRange(view, sel.from, sel.to, text)
            view.focus()
          },
        },
        {
          id: 'paste-plain',
          label: '粘贴为纯文本',
          shortcut: '⌘⇧V',
          icon: <Type className={ICON} />,
          onSelect: async () => {
            const text = await readText()
            if (!text) {
              showToast('剪贴板为空', 'error')
              return
            }
            // 转义 Markdown 特殊字符，粘进来的内容按字面渲染
            replaceRange(view, sel.from, sel.to, escapeMarkdownChars(text))
            view.focus()
          },
        },
        { id: 'sep-clip', separator: true },
        {
          id: 'undo',
          label: '撤销',
          shortcut: '⌘Z',
          icon: <Undo2 className={ICON} />,
          onSelect: () => {
            if (!undo(view)) showToast('没有可撤销的操作')
          },
        },
        {
          id: 'redo',
          label: '重做',
          shortcut: '⌘⇧Z',
          icon: <Redo2 className={ICON} />,
          onSelect: () => {
            if (!redo(view)) showToast('没有可重做的操作')
          },
        },
        { id: 'sep-history', separator: true },
        {
          id: 'format',
          label: '格式',
          icon: <Type className={ICON} />,
          children: [
            {
              id: 'bold',
              label: '加粗',
              shortcut: '⌘B',
              icon: <Bold className={ICON} />,
              onSelect: () => wrapSelection(view, '**', '**', '粗体'),
            },
            {
              id: 'italic',
              label: '斜体',
              shortcut: '⌘I',
              icon: <Italic className={ICON} />,
              onSelect: () => wrapSelection(view, '*', '*', '斜体'),
            },
            {
              id: 'strike',
              label: '删除线',
              icon: <Strikethrough className={ICON} />,
              onSelect: () => wrapSelection(view, '~~', '~~', '删除线'),
            },
            {
              id: 'code-inline',
              label: '行内代码',
              shortcut: '⌘E',
              icon: <Code className={ICON} />,
              onSelect: () => wrapSelection(view, '`', '`', 'code'),
            },
            {
              id: 'highlight',
              label: '高亮',
              icon: <Highlighter className={ICON} />,
              onSelect: () => wrapSelection(view, '==', '==', '高亮'),
            },
            {
              id: 'sup',
              label: '上标',
              icon: <Superscript className={ICON} />,
              onSelect: () => wrapSelection(view, '<sup>', '</sup>'),
            },
            {
              id: 'sub',
              label: '下标',
              icon: <Subscript className={ICON} />,
              onSelect: () => wrapSelection(view, '<sub>', '</sub>'),
            },
            { id: 'sep-format', separator: true },
            {
              id: 'clear-inline',
              label: '清除内联格式',
              icon: <Eraser className={ICON} />,
              onSelect: () => unwrapSelection(view),
            },
          ],
        },
        {
          id: 'paragraph',
          label: '段落',
          icon: <Pilcrow className={ICON} />,
          children: [
            {
              id: 'p',
              label: '正文',
              icon: <AlignLeft className={ICON} />,
              onSelect: () => setHeading(view, 0),
            },
            {
              id: 'h1',
              label: '标题 1',
              icon: <Heading1 className={ICON} />,
              onSelect: () => setHeading(view, 1),
            },
            {
              id: 'h2',
              label: '标题 2',
              icon: <Heading2 className={ICON} />,
              onSelect: () => setHeading(view, 2),
            },
            {
              id: 'h3',
              label: '标题 3',
              icon: <Heading3 className={ICON} />,
              onSelect: () => setHeading(view, 3),
            },
            {
              id: 'h4',
              label: '标题 4',
              icon: <Heading4 className={ICON} />,
              onSelect: () => setHeading(view, 4),
            },
            {
              id: 'h5',
              label: '标题 5',
              icon: <Heading5 className={ICON} />,
              onSelect: () => setHeading(view, 5),
            },
            {
              id: 'h6',
              label: '标题 6',
              icon: <Heading6 className={ICON} />,
              onSelect: () => setHeading(view, 6),
            },
            { id: 'sep-para-1', separator: true },
            {
              id: 'ul',
              label: '无序列表',
              icon: <List className={ICON} />,
              onSelect: () => toggleLinePrefix(view, '- '),
            },
            {
              id: 'ol',
              label: '有序列表',
              icon: <ListOrdered className={ICON} />,
              onSelect: () => toggleOrderedList(view),
            },
            {
              id: 'task',
              label: '待办清单',
              icon: <ListChecks className={ICON} />,
              onSelect: () => toggleLinePrefix(view, '- [ ] '),
            },
            {
              id: 'quote',
              label: '引用',
              icon: <Quote className={ICON} />,
              onSelect: () => toggleLinePrefix(view, '> '),
            },
            { id: 'sep-para-2', separator: true },
            {
              id: 'code-block',
              label: '代码块',
              icon: <SquareCode className={ICON} />,
              onSelect: () =>
                insertSnippet(view, SNIPPETS.codeBlock, SNIPPETS.codeBlock.indexOf('\n') + 1),
            },
            {
              id: 'table',
              label: '表格',
              icon: <Table className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.table),
            },
            {
              id: 'hr',
              label: '分割线',
              icon: <Minus className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.hr),
            },
            { id: 'sep-para-3', separator: true },
            {
              id: 'detail',
              label: '折叠面板',
              icon: <UnfoldVertical className={ICON} />,
              disabled: disabledWithoutHandler('detail'),
              onSelect: runHandler('detail'),
            },
            {
              id: 'timeline',
              label: '时间线',
              icon: <Timer className={ICON} />,
              disabled: disabledWithoutHandler('timeline'),
              onSelect: runHandler('timeline'),
            },
          ],
        },
        {
          id: 'text-ops',
          label: '文本处理',
          icon: <CaseSensitive className={ICON} />,
          children: [
            {
              id: 'upper',
              label: '转大写',
              icon: <CaseUpper className={ICON} />,
              disabled: false,
              onSelect: () => transformTarget(view, (text) => text.toUpperCase()),
            },
            {
              id: 'lower',
              label: '转小写',
              icon: <CaseLower className={ICON} />,
              onSelect: () => transformTarget(view, (text) => text.toLowerCase()),
            },
            {
              id: 'capitalize',
              label: '首字母大写',
              icon: <CaseSensitive className={ICON} />,
              onSelect: () =>
                transformTarget(view, (text) =>
                  text.replace(/(^|\s)([a-zA-Z])/g, (_, space: string, char: string) =>
                    space + char.toUpperCase()
                  )
                ),
            },
            { id: 'sep-text-1', separator: true },
            {
              id: 'trim-tail',
              label: '去除行尾空格',
              icon: <Sparkles className={ICON} />,
              onSelect: () => trimTrailingSpaces(view),
            },
            {
              id: 'collapse-blank',
              label: '合并多余空行',
              icon: <Rows3 className={ICON} />,
              onSelect: () => {
                if (!setFullText(view, fullText.replace(/\n{3,}/g, '\n\n'))) {
                  showToast('没有多余空行')
                }
              },
            },
            { id: 'sep-text-2', separator: true },
            {
              id: 'sort-asc',
              label: '行排序（升序）',
              icon: <ArrowUpAZ className={ICON} />,
              disabled: sel.empty,
              onSelect: () => sortLines(view, false),
            },
            {
              id: 'sort-desc',
              label: '行排序（降序）',
              icon: <ArrowDownAZ className={ICON} />,
              disabled: sel.empty,
              onSelect: () => sortLines(view, true),
            },
            {
              id: 'dedupe',
              label: '行去重',
              icon: <ArrowDownWideNarrow className={ICON} />,
              disabled: sel.empty,
              onSelect: () => dedupeLines(view),
            },
            { id: 'sep-text-3', separator: true },
            {
              id: 'indent-more',
              label: '增加缩进',
              icon: <IndentIncrease className={ICON} />,
              onSelect: () => indentLines(view, 1),
            },
            {
              id: 'indent-less',
              label: '减少缩进',
              icon: <IndentDecrease className={ICON} />,
              onSelect: () => indentLines(view, -1),
            },
            { id: 'sep-text-4', separator: true },
            {
              id: 'escape',
              label: '转义 Markdown 字符',
              icon: <Braces className={ICON} />,
              onSelect: () => transformTarget(view, escapeMarkdownChars),
            },
            {
              id: 'unescape',
              label: '反转义',
              icon: <Braces className={ICON} />,
              onSelect: () => transformTarget(view, unescapeMarkdownChars),
            },
          ],
        },
        {
          id: 'normalize',
          label: '智能规范化排版',
          icon: <WandSparkles className={ICON} />,
          children: [
            {
              id: 'normalize-basic',
              label: '基础规范化',
              icon: <Sparkles className={ICON} />,
              disabled: !hasText,
              onSelect: () => applyNormalize(view, fullText, 'basic'),
            },
            {
              id: 'normalize-full',
              label: '完整规范化（含标点与全角）',
              icon: <WandSparkles className={ICON} />,
              disabled: !hasText,
              onSelect: () => applyNormalize(view, fullText, 'full'),
            },
          ],
        },
        {
          id: 'insert',
          label: '快捷插入',
          icon: <FilePlus2 className={ICON} />,
          children: [
            {
              id: 'insert-datetime',
              label: '日期时间',
              icon: <CalendarClock className={ICON} />,
              children: [
                {
                  id: 'insert-date',
                  label: '日期（2026-09-13）',
                  icon: <CalendarDays className={ICON} />,
                  onSelect: () => insertSnippet(view, formatDate()),
                },
                {
                  id: 'insert-date-cn',
                  label: '中文长日期',
                  icon: <CalendarDays className={ICON} />,
                  onSelect: () => insertSnippet(view, formatDateCN()),
                },
                {
                  id: 'insert-time',
                  label: '时间（14:32）',
                  icon: <Clock className={ICON} />,
                  onSelect: () => insertSnippet(view, formatTime()),
                },
                {
                  id: 'insert-datetime-full',
                  label: '日期 + 时间',
                  icon: <CalendarClock className={ICON} />,
                  onSelect: () => insertSnippet(view, formatDateTime()),
                },
                {
                  id: 'insert-timestamp',
                  label: 'Unix 时间戳（秒）',
                  icon: <Hash className={ICON} />,
                  onSelect: () => insertSnippet(view, formatTimestamp()),
                },
              ],
            },
            {
              id: 'insert-frontmatter',
              label: 'Front Matter（插到文首）',
              icon: <FileCode2 className={ICON} />,
              onSelect: () => {
                if (/^\s*---\r?\n/.test(fullText)) {
                  showToast('文档开头已有 Front Matter')
                  return
                }
                view.dispatch({
                  changes: { from: 0, to: 0, insert: frontMatter(title) },
                  selection: { anchor: 0 },
                })
                view.focus()
              },
            },
            { id: 'sep-insert-1', separator: true },
            {
              id: 'insert-code',
              label: '代码块',
              icon: <SquareCode className={ICON} />,
              onSelect: () =>
                insertSnippet(view, SNIPPETS.codeBlock, SNIPPETS.codeBlock.indexOf('\n') + 1),
            },
            {
              id: 'insert-table',
              label: '表格（3 列）',
              icon: <Table className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.table),
            },
            {
              id: 'insert-hr',
              label: '分割线',
              icon: <Minus className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.hr),
            },
            {
              id: 'insert-toc',
              label: '目录 [TOC]',
              icon: <ListTree className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.toc),
            },
            { id: 'sep-insert-2', separator: true },
            {
              id: 'insert-todo',
              label: '待办项',
              icon: <SquareCheck className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.todo),
            },
            {
              id: 'insert-quote',
              label: '引用块',
              icon: <TextQuote className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.quote),
            },
            {
              id: 'insert-panel',
              label: '提示块',
              icon: <PanelTop className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.panel, '::: primary '.length),
            },
            { id: 'sep-insert-3', separator: true },
            {
              id: 'insert-image',
              label: '图片',
              icon: <Image className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.image, 2),
            },
            {
              id: 'insert-link',
              label: '链接',
              icon: <Link2 className={ICON} />,
              onSelect: () => insertSnippet(view, SNIPPETS.link, 1),
            },
            { id: 'sep-insert-4', separator: true },
            {
              id: 'insert-docinfo',
              label: '当前文档信息',
              icon: <FileText className={ICON} />,
              onSelect: () => insertSnippet(view, `\n${documentInfo(fullText, title)}\n`),
            },
          ],
        },
        { id: 'sep-doc', separator: true },
        {
          id: 'copy-group',
          label: '复制为',
          icon: <Copy className={ICON} />,
          children: [
            {
              id: 'copy-doc-md',
              label: '复制全文（Markdown）',
              shortcut: '⌘⇧C',
              icon: <FileText className={ICON} />,
              disabled: !hasText,
              onSelect: () => void toastCopy(fullText, '已复制全文 Markdown'),
            },
            {
              id: 'copy-doc-text',
              label: '复制全文（纯文本）',
              icon: <ScrollText className={ICON} />,
              disabled: !hasText,
              onSelect: () => void toastCopy(stripMarkdownToPlain(fullText), '已复制纯文本'),
            },
            {
              id: 'copy-doc-html',
              label: '复制为 HTML',
              icon: <CodeXml className={ICON} />,
              onSelect: () => {
                try {
                  const html = cherry?.getHtml?.() || ''
                  if (!html) {
                    showToast('暂无渲染结果', 'error')
                    return
                  }
                  void toastCopy(html, '已复制 HTML')
                } catch (error) {
                  console.error('复制 HTML 失败:', error)
                  showToast('复制失败', 'error')
                }
              },
            },
          ],
        },
        {
          id: 'quote-selection',
          label: '选中文本加引用',
          icon: <TextQuote className={ICON} />,
          disabled: sel.empty,
          onSelect: () => toggleLinePrefix(view, '> '),
        },
        {
          id: 'view-group',
          label: '视图',
          icon: <Columns2 className={ICON} />,
          children: [
            {
              id: 'select-all',
              label: '全选',
              shortcut: '⌘A',
              icon: <CopyCheck className={ICON} />,
              disabled: !hasText,
              onSelect: () => {
                selectAll(view)
                view.focus()
              },
            },
            {
              id: 'find',
              label: '查找替换',
              shortcut: '⌘F',
              icon: <Search className={ICON} />,
              disabled: disabledWithoutHandler('search'),
              onSelect: runHandler('search'),
            },
            {
              id: 'switch-model',
              label: '切换编辑 / 预览模式',
              icon: <Columns2 className={ICON} />,
              disabled: disabledWithoutHandler('switchModel'),
              onSelect: runHandler('switchModel'),
            },
            {
              id: 'fullscreen',
              label: '全屏切换',
              icon: <Maximize2 className={ICON} />,
              disabled: disabledWithoutHandler('fullScreen'),
              onSelect: runHandler('fullScreen'),
            },
            {
              id: 'export',
              label: '导出…',
              icon: <FileDown className={ICON} />,
              disabled: disabledWithoutHandler('export'),
              onSelect: runHandler('export'),
            },
          ],
        },
        { id: 'sep-danger', separator: true },
        {
          id: 'clear',
          label: '清空全文',
          icon: <Trash2 className={ICON} />,
          danger: true,
          disabled: !hasText,
          onSelect: () => {
            if (!window.confirm('确定清空全文吗？清空后可以用 ⌘Z 撤销。')) return
            setFullText(view, '')
            view.focus()
            showToast('已清空全文')
          },
        },
      ]

      openContextMenu(event, editorItems)
    },
    [cherryRef, insertSnippet, openContextMenu, showToast, title, toastCopy]
  )

  /* ---------------- 预览区（只读） ---------------- */

  const onPreviewContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      const cherry = cherryRef.current
      const target = event.target as HTMLElement
      const previewer = target.closest('.cherry-previewer') as HTMLElement | null
      if (!previewer) return

      // 选区在菜单打开时就固定下来：点击菜单按钮会让预览区失焦
      const selection = window.getSelection()
      const selectedText =
        selection && !selection.isCollapsed ? selection.toString().trim() : ''
      const selectedHtml = (() => {
        if (!selection || selection.isCollapsed || !selection.rangeCount) return ''
        try {
          const holder = document.createElement('div')
          holder.appendChild(selection.getRangeAt(0).cloneContents())
          return holder.innerHTML
        } catch {
          return ''
        }
      })()

      const fullMarkdown = (() => {
        try {
          return cherry?.getMarkdown?.() || ''
        } catch {
          return ''
        }
      })()
      const fullPlain = previewer.innerText.trim() || stripMarkdownToPlain(fullMarkdown)
      const fullHtml = previewer.innerHTML

      const handler = (name: string): (() => void) | null => {
        const candidate = cherry?.toolbar?.toolbarHandlers?.[name]
        return typeof candidate === 'function' ? (candidate as () => void) : null
      }
      const runHandler = (name: string) => () => {
        const fn = handler(name)
        if (!fn) {
          showToast('该功能在当前版本不可用', 'error')
          return
        }
        try {
          fn()
        } catch (error) {
          console.error(`工具栏动作 ${name} 失败:`, error)
          showToast('操作失败', 'error')
        }
      }

      const previewItems: ContextMenuItem[] = [
        {
          id: 'pv-copy-selection',
          label: '复制选中文本',
          shortcut: '⌘C',
          icon: <Copy className={ICON} />,
          disabled: !selectedText,
          onSelect: () => void toastCopy(selectedText, '已复制选中内容'),
        },
        {
          id: 'pv-copy-selection-html',
          label: '复制选中为 HTML',
          icon: <CodeXml className={ICON} />,
          disabled: !selectedHtml,
          onSelect: () => void toastCopy(selectedHtml, '已复制 HTML 片段'),
        },
        { id: 'pv-sep-1', separator: true },
        {
          id: 'pv-copy-md',
          label: '复制全文（Markdown）',
          icon: <FileText className={ICON} />,
          disabled: !fullMarkdown,
          onSelect: () => void toastCopy(fullMarkdown, '已复制全文 Markdown'),
        },
        {
          id: 'pv-copy-text',
          label: '复制全文（纯文本）',
          icon: <ScrollText className={ICON} />,
          disabled: !fullPlain,
          onSelect: () => void toastCopy(fullPlain, '已复制纯文本'),
        },
        {
          id: 'pv-copy-html',
          label: '复制全文为 HTML',
          icon: <CodeXml className={ICON} />,
          disabled: !fullHtml,
          onSelect: () => void toastCopy(fullHtml, '已复制 HTML'),
        },
        { id: 'pv-sep-2', separator: true },
        {
          id: 'pv-select-all',
          label: '全选预览内容',
          icon: <CopyCheck className={ICON} />,
          onSelect: () => {
            const range = document.createRange()
            range.selectNodeContents(previewer)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          },
        },
        {
          id: 'pv-switch-model',
          label: '切换到编辑模式',
          icon: <Columns2 className={ICON} />,
          disabled: handler('switchModel') === null,
          onSelect: runHandler('switchModel'),
        },
        {
          id: 'pv-export',
          label: '导出…',
          icon: <Download className={ICON} />,
          disabled: handler('export') === null,
          onSelect: runHandler('export'),
        },
      ]

      openContextMenu(event, previewItems)
    },
    [cherryRef, openContextMenu, showToast, toastCopy]
  )

  /* ---------------- 规范化排版 ---------------- */

  const applyNormalize = useCallback(
    (view: EditorView, source: string, level: 'basic' | 'full') => {
      const result = normalizeMarkdown(source, level)
      if (!result.changes.length) {
        showToast('排版已规范，无需调整')
        return
      }
      setFullText(view, result.text)
      showToast(`已规范化：${result.changes.join('、')}`)
    },
    [showToast]
  )

  return { onEditorContextMenu, onPreviewContextMenu }
}

/**
 * 对选区（无选区时对当前行）做纯文本变换。
 * 放在 hook 外面，避免每次渲染重建。
 */
function transformTarget(view: EditorView, fn: (value: string) => string): void {
  const sel = getSelection(view)
  if (!sel.empty) {
    const next = fn(sel.text)
    if (next !== sel.text) replaceRange(view, sel.from, sel.to, next)
    return
  }
  const line = view.state.doc.lineAt(sel.from)
  const next = fn(line.text)
  if (next !== line.text) replaceRange(view, line.from, line.to, next)
}
