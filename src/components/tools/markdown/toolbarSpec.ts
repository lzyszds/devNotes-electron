import type { ComponentType } from 'react'
import {
  Bold,
  ChartNoAxesColumn,
  Code,
  Download,
  GitCommitVertical,
  Heading,
  Image as ImageIcon,
  Italic,
  LayoutPanelTop,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Maximize2,
  Minus,
  Presentation,
  Redo2,
  Search,
  SquareCode,
  Strikethrough,
  Table as TableIcon,
  TextQuote,
  Undo2,
} from 'lucide-react'

export type MarkdownEngine = 'cherry' | 'milkdown'

export type MarkdownCommand = {
  /** 统一命令 id，同时用作状态表的键 */
  id: string
  /** 悬停提示文案 */
  label: string
  icon: ComponentType<{ className?: string }>
  /** 同一组的按钮之间不放分隔线，跨组才放 */
  group: number
  /** 'right' 的项聚在工具栏右端（大纲/搜索/全屏/导出） */
  align?: 'right'
  /**
   * 只注册进 Cherry 的原生工具栏配置，不在自绘工具栏上渲染。
   * 用于右键菜单要用、但工具栏不需要出现按钮的命令（如「折叠面板」）。
   */
  cherryHidden?: true
  /** Cherry 侧：toolbars.toolbar 里用的菜单名（缺省表示 Cherry 没有这项） */
  cherry?: string
  /**
   * Milkdown 侧：命令实现在 milkdownCommands.ts 里。
   * 只标「有没有」，不写名字 —— Milkdown 暴露的是类型化命令，不是字符串键。
   */
  milkdown?: true
  /**
   * 按钮在 Cherry 下也显示，但不进 CHERRY_TOOLBAR_CONFIG、也不走原生按钮。
   * 用于「宿主自己实现、两个内核共用」的命令（如 outline 走 cherry.toggleToc()）。
   */
  cherryHostOnly?: true
}

/**
 * 两个内核共用的按钮清单 —— 顺序即渲染顺序，保证切换内核时工具栏不会跳来跳去。
 *
 * 「某个内核下有没有这颗按钮」由上面的两个字段直接决定，不再另设 engines 掩码：
 * 声明与实现绑在一起，少一处能写歪的地方。
 * 各引擎能力本来就不一样（Cherry 有面板/时间线/图表/搜索/导出，Milkdown 没有），
 * 不做任何「补齐」，缺的就少一颗按钮。
 */
export const MARKDOWN_COMMANDS: MarkdownCommand[] = [
  // 历史
  { id: 'undo', label: '撤销', icon: Undo2, group: 1, cherry: 'undo', milkdown: true },
  { id: 'redo', label: '重做', icon: Redo2, group: 1, cherry: 'redo', milkdown: true },

  // 行内
  { id: 'bold', label: '加粗', icon: Bold, group: 2, cherry: 'bold', milkdown: true },
  { id: 'italic', label: '斜体', icon: Italic, group: 2, cherry: 'italic', milkdown: true },
  { id: 'strike', label: '删除线', icon: Strikethrough, group: 2, cherry: 'strikethrough', milkdown: true },
  { id: 'inline-code', label: '行内代码', icon: Code, group: 2, cherry: 'inlineCode', milkdown: true },

  // 块级
  { id: 'heading', label: '标题级别', icon: Heading, group: 3, cherry: 'header', milkdown: true },
  { id: 'ul', label: '无序列表', icon: List, group: 3, cherry: 'ul', milkdown: true },
  { id: 'ol', label: '有序列表', icon: ListOrdered, group: 3, cherry: 'ol', milkdown: true },
  // gfm 没有可调用的任务清单命令（只有 wrapInTaskListInputRule），走自写实现
  { id: 'task', label: '任务清单', icon: ListChecks, group: 3, cherry: 'checklist', milkdown: true },
  { id: 'quote', label: '引用', icon: TextQuote, group: 3, cherry: 'quote', milkdown: true },

  // 插入
  { id: 'link', label: '超链接', icon: LinkIcon, group: 4, cherry: 'link', milkdown: true },
  { id: 'image', label: '图片', icon: ImageIcon, group: 4, cherry: 'image', milkdown: true },
  { id: 'code-block', label: '代码块', icon: SquareCode, group: 4, cherry: 'code', milkdown: true },
  { id: 'table', label: '表格', icon: TableIcon, group: 4, cherry: 'table', milkdown: true },
  { id: 'hr', label: '分隔线', icon: Minus, group: 4, cherry: 'hr', milkdown: true },

  // Cherry 专有块语法（不属 CommonMark/GFM，Milkdown 无法保真）
  { id: 'panel', label: '面板', icon: LayoutPanelTop, group: 5, cherry: 'panel' },
  { id: 'timeline', label: '时间线', icon: GitCommitVertical, group: 5, cherry: 'timeline' },
  { id: 'graph', label: '图表', icon: ChartNoAxesColumn, group: 5, cherry: 'graph' },
  // 折叠面板：右键菜单要用它的 handler，但工具栏不放按钮
  { id: 'detail', label: '折叠面板', icon: LayoutPanelTop, group: 5, cherry: 'detail', cherryHidden: true },

  // 右端。outline 两侧都走宿主拦截（Cherry 用 toggleToc()，Milkdown 用自绘面板），
  // 不经过 Cherry 的原生按钮，所以用 cherryHostOnly 标记而不是 cherry。
  { id: 'outline', label: '大纲', icon: ListTree, group: 6, align: 'right', cherryHostOnly: true, milkdown: true },
  { id: 'search', label: '搜索替换', icon: Search, group: 6, align: 'right', cherry: 'search', milkdown: true },
  { id: 'fullscreen', label: '全屏', icon: Maximize2, group: 6, align: 'right', milkdown: true },
  // 预览：全屏 + 只读 + 按窗口宽度整体等比放大。两个内核都走宿主实现
  // （Cherry 用 switchModel('previewOnly')，Milkdown 用 setProps({editable:false})），
  // 不经过 Cherry 的原生按钮，所以标 cherryHostOnly 而不是 cherry。
  { id: 'preview', label: '预览', icon: Presentation, group: 6, align: 'right', cherryHostOnly: true, milkdown: true },
  { id: 'export', label: '导出', icon: Download, group: 6, align: 'right', cherry: 'export', milkdown: true },
]

/**
 * 某内核下该命令是否可用：声明了对应字段就有。
 * cherryHidden 的项只进原生配置、不在自绘工具栏上渲染，所以这里排除掉。
 */
export function commandsFor(engine: MarkdownEngine): MarkdownCommand[] {
  return MARKDOWN_COMMANDS.filter((item) => {
    if (item.cherryHidden) return false
    return engine === 'cherry' ? item.cherry || item.cherryHostOnly : item.milkdown
  })
}

/**
 * Cherry 的 toolbars.toolbar 配置：与自绘工具栏一一对应的扁平清单（详情见 dispatch.ts）。
 * 不含 cherryHostOnly —— 那些命令由宿主直接实现，不需要 Cherry 注册原生按钮。
 */
export const CHERRY_TOOLBAR_CONFIG = MARKDOWN_COMMANDS.filter((item) => item.cherry).map(
  (item) => item.cherry!
)

/**
 * Cherry 菜单名 → 按钮类名后缀。
 *
 * Cherry 的 createBtn() 用的是 `iconName || name`：
 *   KO('span', 'cherry-toolbar-' + (this.iconName ? this.iconName : this.name), ...)
 * 而 iconName 来自各菜单构造函数里的 setName(name, iconName)，
 * 所以类名后缀不一定等于菜单名（如 quote → blockquote、hr → line、code → codeBlock）。
 * 这张表是从 cherry-markdown.core.js 里逐个 setName 调用实测出来的，改动前请重新核对。
 */
export const CHERRY_CLASS_SUFFIX: Record<string, string> = {
  undo: 'undo',
  redo: 'redo',
  bold: 'bold',
  italic: 'italic',
  strikethrough: 'strike',
  inlineCode: 'code',
  header: 'header',
  ul: 'ul',
  ol: 'ol',
  checklist: 'checklist',
  quote: 'blockquote',
  link: 'link',
  image: 'image',
  code: 'codeBlock',
  table: 'table',
  hr: 'line',
  // 折叠面板。Cherry 产物里是 setName("detail","insertFlow") —— 菜单名是 detail，
  // 类名后缀是 insertFlow。之前没把它放进配置，导致 toolbarHandlers.detail 从未注册，
  // 右键菜单的「折叠面板」永远置灰。
  detail: 'insertFlow',
  panel: 'tips',
  timeline: 'timeline',
  graph: 'insertChart',
  toc: 'toc',
  search: 'search',
  fullScreen: 'fullscreen',
  export: 'export',
}
