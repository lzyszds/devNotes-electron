import { useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
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
import { useContextMenu } from '../components/ui/ContextMenu'
import type { ContextMenuItem } from '../components/ui/ContextMenu'
import { useToast } from '../components/ui/Toast'
import { copyText, readText } from '../utils/clipboard'
import type { EditorAdapter } from '../utils/editorAdapter'
import { escapeMarkdownChars, stripMarkdownToPlain } from '../utils/editorText'
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
 * 编辑区右键菜单（两个内核共用）。
 *
 * 与改造前的区别：菜单项不再直接 import CM6 的操作，而是全部通过 EditorAdapter。
 * 这样同一份 70 项菜单树能同时服务 Cherry（CM6）与 Milkdown（ProseMirror），
 * 差异被关在两个 adapter 里（见 utils/editorAdapter.ts 的说明）。
 *
 * 菜单在打开那一刻构建，选区/全文按当时状态快照捕获 —— 点击菜单按钮会让内容区
 * 失焦，届时再读选区可能已经不准。这条与改造前一致。
 */
export interface EditorContextMenuOptions {
  adapter: EditorAdapter | null
  /** 当前笔记标题，用于 Front Matter 与「当前文档信息」 */
  title: string
  /** 「切换编辑 / 预览模式」由宿主驱动（只有 Cherry 有三态视图） */
  onRequestViewMode?: () => void
  /** 「全屏」由宿主统一实现（Cherry 的原生全屏只是个 class，没法复用） */
  onRequestFullscreen?: () => void
  /** 「查找替换」由宿主分派：Cherry 走原生面板，Milkdown 走自绘面板 */
  onRequestSearch?: () => void
  /** 「大纲」由宿主分派：两端语义统一为「切换大纲浮层」 */
  onRequestOutline?: () => void
}

const ICON = 'w-3.5 h-3.5'

export function useEditorContextMenu({
  adapter,
  title,
  onRequestViewMode,
  onRequestFullscreen,
  onRequestSearch,
  onRequestOutline,
}: EditorContextMenuOptions) {
  const { openContextMenu } = useContextMenu()
  const { showToast } = useToast()

  const toastCopy = useCallback(
    async (text: string, okLabel: string) => {
      const ok = await copyText(text)
      showToast(ok ? okLabel : '复制失败', ok ? 'default' : 'error')
    },
    [showToast]
  )

  const onEditorContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (!adapter) return

      const sel = adapter.getSelection()
      const fullText = adapter.getFullText()
      const hasText = fullText.trim().length > 0
      const isCherry = adapter.engine === 'cherry'

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
            adapter.replaceRange(sel.from, sel.to, '')
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
            adapter.replaceRange(sel.from, sel.to, text)
            adapter.focus()
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
            adapter.replaceRange(sel.from, sel.to, escapeMarkdownChars(text))
            adapter.focus()
          },
        },
        { id: 'sep-clip', separator: true },
        {
          id: 'undo',
          label: '撤销',
          shortcut: '⌘Z',
          icon: <Undo2 className={ICON} />,
          onSelect: () => {
            if (!adapter.undo()) showToast('没有可撤销的操作')
          },
        },
        {
          id: 'redo',
          label: '重做',
          shortcut: '⌘⇧Z',
          icon: <Redo2 className={ICON} />,
          onSelect: () => {
            if (!adapter.redo()) showToast('没有可重做的操作')
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
              onSelect: () => adapter.wrapSelection('**', '**', '粗体'),
            },
            {
              id: 'italic',
              label: '斜体',
              shortcut: '⌘I',
              icon: <Italic className={ICON} />,
              onSelect: () => adapter.wrapSelection('*', '*', '斜体'),
            },
            {
              id: 'strike',
              label: '删除线',
              icon: <Strikethrough className={ICON} />,
              onSelect: () => adapter.wrapSelection('~~', '~~', '删除线'),
            },
            {
              id: 'code-inline',
              label: '行内代码',
              shortcut: '⌘E',
              icon: <Code className={ICON} />,
              onSelect: () => adapter.wrapSelection('`', '`', 'code'),
            },
            {
              id: 'highlight',
              label: '高亮',
              icon: <Highlighter className={ICON} />,
              onSelect: () => adapter.wrapSelection('==', '==', '高亮'),
            },
            {
              id: 'sup',
              label: '上标',
              icon: <Superscript className={ICON} />,
              onSelect: () => adapter.wrapSelection('<sup>', '</sup>'),
            },
            {
              id: 'sub',
              label: '下标',
              icon: <Subscript className={ICON} />,
              onSelect: () => adapter.wrapSelection('<sub>', '</sub>'),
            },
            { id: 'sep-format', separator: true },
            {
              id: 'clear-inline',
              label: '清除内联格式',
              icon: <Eraser className={ICON} />,
              onSelect: () => adapter.unwrapSelection(),
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
              onSelect: () => adapter.setHeading(0),
            },
            {
              id: 'h1',
              label: '标题 1',
              icon: <Heading1 className={ICON} />,
              onSelect: () => adapter.setHeading(1),
            },
            {
              id: 'h2',
              label: '标题 2',
              icon: <Heading2 className={ICON} />,
              onSelect: () => adapter.setHeading(2),
            },
            {
              id: 'h3',
              label: '标题 3',
              icon: <Heading3 className={ICON} />,
              onSelect: () => adapter.setHeading(3),
            },
            {
              id: 'h4',
              label: '标题 4',
              icon: <Heading4 className={ICON} />,
              onSelect: () => adapter.setHeading(4),
            },
            {
              id: 'h5',
              label: '标题 5',
              icon: <Heading5 className={ICON} />,
              onSelect: () => adapter.setHeading(5),
            },
            {
              id: 'h6',
              label: '标题 6',
              icon: <Heading6 className={ICON} />,
              onSelect: () => adapter.setHeading(6),
            },
            { id: 'sep-para-1', separator: true },
            {
              id: 'ul',
              label: '无序列表',
              icon: <List className={ICON} />,
              onSelect: () => adapter.toggleLinePrefix('- '),
            },
            {
              id: 'ol',
              label: '有序列表',
              icon: <ListOrdered className={ICON} />,
              onSelect: () => adapter.toggleOrderedList(),
            },
            {
              id: 'task',
              label: '待办清单',
              icon: <ListChecks className={ICON} />,
              onSelect: () => adapter.toggleLinePrefix('- [ ] '),
            },
            {
              id: 'quote',
              label: '引用',
              icon: <Quote className={ICON} />,
              onSelect: () => adapter.toggleLinePrefix('> '),
            },
            { id: 'sep-para-2', separator: true },
            {
              id: 'code-block',
              label: '代码块',
              icon: <SquareCode className={ICON} />,
              onSelect: () =>
                adapter.insertSnippet(SNIPPETS.codeBlock, SNIPPETS.codeBlock.indexOf('\n') + 1),
            },
            {
              id: 'table',
              label: '表格',
              icon: <Table className={ICON} />,
              onSelect: () => adapter.insertSnippet(SNIPPETS.table),
            },
            {
              id: 'hr',
              label: '分割线',
              icon: <Minus className={ICON} />,
              onSelect: () => adapter.insertSnippet(SNIPPETS.hr),
            },
            { id: 'sep-para-3', separator: true },
            // 折叠面板 / 时间线是 Cherry 私有 ::: 语法，ProseMirror 没有对应节点，
            // 在所见即所得下直接不渲染（不是置灰 —— 置灰等于承认它能用）
            ...(isCherry
              ? [
                  {
                    id: 'detail',
                    label: '折叠面板',
                    icon: <UnfoldVertical className={ICON} />,
                    onSelect: () => {
                      if (!adapter.invokeNative('detail')) showToast('该功能在当前版本不可用', 'error')
                    },
                  },
                  {
                    id: 'timeline',
                    label: '时间线',
                    icon: <Timer className={ICON} />,
                    onSelect: () => {
                      if (!adapter.invokeNative('timeline'))
                        showToast('该功能在当前版本不可用', 'error')
                    },
                  },
                ]
              : []),
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
              onSelect: () => adapter.transformTarget((text) => text.toUpperCase()),
            },
            {
              id: 'lower',
              label: '转小写',
              icon: <CaseLower className={ICON} />,
              onSelect: () => adapter.transformTarget((text) => text.toLowerCase()),
            },
            {
              id: 'capitalize',
              label: '首字母大写',
              icon: <CaseSensitive className={ICON} />,
              onSelect: () =>
                adapter.transformTarget((text) =>
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
              onSelect: () => adapter.trimTrailingSpaces(),
            },
            {
              id: 'collapse-blank',
              label: '合并多余空行',
              icon: <Rows3 className={ICON} />,
              onSelect: () => {
                if (!adapter.collapseBlankLines()) showToast('没有多余空行')
              },
            },
            { id: 'sep-text-2', separator: true },
            {
              id: 'sort-asc',
              label: '行排序（升序）',
              icon: <ArrowUpAZ className={ICON} />,
              disabled: sel.empty,
              onSelect: () => adapter.sortLines(false),
            },
            {
              id: 'sort-desc',
              label: '行排序（降序）',
              icon: <ArrowDownAZ className={ICON} />,
              disabled: sel.empty,
              onSelect: () => adapter.sortLines(true),
            },
            {
              id: 'dedupe',
              label: '行去重',
              icon: <ArrowDownWideNarrow className={ICON} />,
              disabled: sel.empty,
              onSelect: () => adapter.dedupeLines(),
            },
            { id: 'sep-text-3', separator: true },
            {
              id: 'indent-more',
              label: '增加缩进',
              icon: <IndentIncrease className={ICON} />,
              onSelect: () => adapter.indentLines(1),
            },
            {
              id: 'indent-less',
              label: '减少缩进',
              icon: <IndentDecrease className={ICON} />,
              onSelect: () => adapter.indentLines(-1),
            },
            { id: 'sep-text-4', separator: true },
            {
              id: 'escape',
              label: '转义 Markdown 字符',
              icon: <Braces className={ICON} />,
              onSelect: () => adapter.transformTarget(escapeMarkdownChars),
            },
            {
              id: 'unescape',
              label: '反转义',
              icon: <Braces className={ICON} />,
              onSelect: () =>
                adapter.transformTarget((text) =>
                  text.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
                ),
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
              onSelect: () => applyNormalize(adapter, fullText, 'basic', showToast),
            },
            {
              id: 'normalize-full',
              label: '完整规范化（含标点与全角）',
              icon: <WandSparkles className={ICON} />,
              disabled: !hasText,
              onSelect: () => applyNormalize(adapter, fullText, 'full', showToast),
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
                  onSelect: () => adapter.insertSnippet(formatDate()),
                },
                {
                  id: 'insert-date-cn',
                  label: '中文长日期',
                  icon: <CalendarDays className={ICON} />,
                  onSelect: () => adapter.insertSnippet(formatDateCN()),
                },
                {
                  id: 'insert-time',
                  label: '时间（14:32）',
                  icon: <Clock className={ICON} />,
                  onSelect: () => adapter.insertSnippet(formatTime()),
                },
                {
                  id: 'insert-datetime-full',
                  label: '日期 + 时间',
                  icon: <CalendarClock className={ICON} />,
                  onSelect: () => adapter.insertSnippet(formatDateTime()),
                },
                {
                  id: 'insert-timestamp',
                  label: 'Unix 时间戳（秒）',
                  icon: <Hash className={ICON} />,
                  onSelect: () => adapter.insertSnippet(formatTimestamp()),
                },
              ],
            },
            // Front Matter 在 Milkdown 下会毁文档：`---` 被 micromark 的
            // setextUnderline / thematicBreak 构造吃掉，实测
            //   ---\ntitle: x\n---\n  会变成  ***\n\ntitle: x\n---------\n
            // 而 frontmatter 扩展没装（node_modules 里只有 gfm 系列）。
            // 所以只给 Cherry 用，所见即所得下不渲染这一项。
            ...(isCherry
              ? [
                  {
                    id: 'insert-frontmatter',
                    label: 'Front Matter（插到文首）',
                    icon: <FileCode2 className={ICON} />,
                    onSelect: () => {
                      if (/^\s*---\r?\n/.test(fullText)) {
                        showToast('文档开头已有 Front Matter')
                        return
                      }
                      adapter.insertAtStart(frontMatter(title))
                    },
                  },
                ]
              : []),
            { id: 'sep-insert-1', separator: true },
            {
              id: 'insert-code',
              label: '代码块',
              icon: <SquareCode className={ICON} />,
              onSelect: () =>
                adapter.insertSnippet(SNIPPETS.codeBlock, SNIPPETS.codeBlock.indexOf('\n') + 1),
            },
            {
              id: 'insert-table',
              label: '表格（3 列）',
              icon: <Table className={ICON} />,
              onSelect: () => adapter.insertSnippet(SNIPPETS.table),
            },
            {
              id: 'insert-hr',
              label: '分割线',
              icon: <Minus className={ICON} />,
              onSelect: () => adapter.insertSnippet(SNIPPETS.hr),
            },
            {
              id: 'insert-toc',
              label: '目录 [TOC]',
              icon: <ListTree className={ICON} />,
              onSelect: () => adapter.insertSnippet(SNIPPETS.toc),
            },
            { id: 'sep-insert-2', separator: true },
            {
              id: 'insert-todo',
              label: '待办项',
              icon: <SquareCheck className={ICON} />,
              onSelect: () => adapter.insertSnippet(SNIPPETS.todo),
            },
            {
              id: 'insert-quote',
              label: '引用块',
              icon: <TextQuote className={ICON} />,
              onSelect: () => adapter.insertSnippet(SNIPPETS.quote),
            },
            // 提示块同理，是 Cherry 的 ::: 语法
            ...(isCherry
              ? [
                  {
                    id: 'insert-panel',
                    label: '提示块',
                    icon: <PanelTop className={ICON} />,
                    onSelect: () =>
                      adapter.insertSnippet(SNIPPETS.panel, '::: primary '.length),
                  },
                ]
              : []),
            { id: 'sep-insert-3', separator: true },
            {
              id: 'insert-image',
              label: '图片',
              icon: <Image className={ICON} />,
              onSelect: () => adapter.insertSnippet(SNIPPETS.image, 2),
            },
            {
              id: 'insert-link',
              label: '链接',
              icon: <Link2 className={ICON} />,
              onSelect: () => adapter.insertSnippet(SNIPPETS.link, 1),
            },
            { id: 'sep-insert-4', separator: true },
            {
              id: 'insert-docinfo',
              label: '当前文档信息',
              icon: <FileText className={ICON} />,
              onSelect: () => adapter.insertSnippet(`\n${documentInfo(fullText, title)}\n`),
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
                const html = adapter.getHtml()
                if (!html) {
                  showToast('暂无渲染结果', 'error')
                  return
                }
                void toastCopy(html, '已复制 HTML')
              },
            },
          ],
        },
        {
          id: 'quote-selection',
          label: '选中文本加引用',
          icon: <TextQuote className={ICON} />,
          disabled: sel.empty,
          onSelect: () => adapter.toggleLinePrefix('> '),
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
              onSelect: () => adapter.selectAll(),
            },
            {
              id: 'find',
              label: '查找替换',
              shortcut: '⌘F',
              icon: <Search className={ICON} />,
              onSelect: () => {
                if (onRequestSearch) onRequestSearch()
                else if (!adapter.invokeNative('search'))
                  showToast('该功能在当前版本不可用', 'error')
              },
            },
            {
              id: 'outline',
              label: '大纲',
              icon: <ListTree className={ICON} />,
              onSelect: () => onRequestOutline?.(),
              disabled: !onRequestOutline,
            },
            // 只有 Cherry 有「源码/预览」三态，所见即所得是无条件单栏
            ...(isCherry
              ? [
                  {
                    id: 'switch-model',
                    label: '切换编辑 / 预览模式',
                    icon: <Columns2 className={ICON} />,
                    onSelect: () => onRequestViewMode?.(),
                    disabled: !onRequestViewMode,
                  },
                ]
              : []),
            {
              id: 'fullscreen',
              label: '全屏切换',
              icon: <Maximize2 className={ICON} />,
              onSelect: () => {
                if (onRequestFullscreen) onRequestFullscreen()
                else adapter.invokeNative('fullScreen')
              },
              disabled: !onRequestFullscreen && !adapter.hasNative('fullScreen'),
            },
            {
              id: 'export',
              label: '导出…',
              icon: <FileDown className={ICON} />,
              disabled: !adapter.hasNative('export'),
              onSelect: () => {
                if (!adapter.invokeNative('export')) showToast('该功能在当前版本不可用', 'error')
              },
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
            adapter.setFullText('')
            adapter.focus()
            showToast('已清空全文')
          },
        },
      ]

      openContextMenu(event, editorItems)
    },
    [
      adapter,
      openContextMenu,
      onRequestFullscreen,
      onRequestOutline,
      onRequestSearch,
      onRequestViewMode,
      showToast,
      title,
      toastCopy,
    ]
  )

  /* ---------------- 预览区（只有 Cherry 有独立预览区） ---------------- */

  const onPreviewContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (!adapter || adapter.engine !== 'cherry') return
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

      const fullMarkdown = adapter.getFullText()
      const fullPlain = previewer.innerText.trim() || stripMarkdownToPlain(fullMarkdown)
      const fullHtml = previewer.innerHTML

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
          disabled: !onRequestViewMode,
          onSelect: () => onRequestViewMode?.(),
        },
        {
          id: 'pv-export',
          label: '导出…',
          icon: <Download className={ICON} />,
          disabled: !adapter.hasNative('export'),
          onSelect: () => adapter.invokeNative('export'),
        },
      ]

      openContextMenu(event, previewItems)
    },
    [adapter, openContextMenu, onRequestViewMode, toastCopy]
  )

  return { onEditorContextMenu, onPreviewContextMenu }
}

/** 智能规范化：整篇语义，正常走 adapter.setFullText（保留撤销历史） */
function applyNormalize(
  adapter: EditorAdapter,
  source: string,
  level: 'basic' | 'full',
  showToast: (message: string, type?: 'default' | 'error') => void
): void {
  const result = normalizeMarkdown(source, level)
  if (!result.changes.length) {
    showToast('排版已规范，无需调整')
    return
  }
  adapter.setFullText(result.text)
  showToast(`已规范化：${result.changes.join('、')}`)
}
