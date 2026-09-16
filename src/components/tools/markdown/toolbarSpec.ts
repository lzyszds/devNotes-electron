import type { ComponentType } from 'react'
import {
  Baseline,
  Bold,
  ChartNoAxesColumn,
  Code,
  Download,
  Eraser,
  GitCommitVertical,
  Hash,
  Heading,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  LayoutPanelTop,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Maximize2,
  Minus,
  PaintBucket,
  Paintbrush,
  Plus,
  Presentation,
  Redo2,
  Search,
  Sigma,
  Smile,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  TextQuote,
  Underline,
  Undo2,
} from 'lucide-react'

export type MarkdownEngine = 'cherry' | 'milkdown'

/** 分组折叠菜单的 id。置了 menu 的命令不再平铺，改为收进对应菜单里 */
export type ToolbarMenuId = 'format' | 'insert'

export type MarkdownMenuSpec = {
  id: ToolbarMenuId
  /** 触发器上的文字标签 */
  label: string
  icon: ComponentType<{ className?: string }>
  /**
   * 决定触发器在工具栏上的落点。取值与 MarkdownCommand.group 同一套编号，
   * 且取「它前面那一组的号」—— 渲染时会稳定排序，菜单正好落在该组命令之后。
   */
  group: number
  /** 弹层宽度（px） */
  width: number
  /** 哪些内核下渲染这个菜单 */
  engines: MarkdownEngine[]
}

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
  /**
   * 收进某个分组折叠菜单，不在工具栏上平铺。
   * 工具栏一行放不下二十多颗按钮，同类能力折进菜单里更清爽；
   * 高频项（加粗/斜体/列表/链接…）保持平铺，不牺牲一次点击的执行效率。
   */
  menu?: ToolbarMenuId
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

  // ================= 「格式」菜单（Milkdown 专属） =================
  // Cherry 的同类能力挂在它的气泡工具栏（bubble）上，顶部工具栏没有对应的隐形原生
  // 按钮可供派发（见 dispatch.ts），所以这几项只标 milkdown：Cherry 下不渲染这个菜单。
  { id: 'underline', label: '下划线', icon: Underline, group: 2, menu: 'format', milkdown: true },
  { id: 'superscript', label: '上标', icon: Superscript, group: 2, menu: 'format', milkdown: true },
  { id: 'subscript', label: '下标', icon: Subscript, group: 2, menu: 'format', milkdown: true },
  { id: 'highlight', label: '高亮', icon: Highlighter, group: 2, menu: 'format', milkdown: true },
  { id: 'clear-format', label: '清除格式', icon: Eraser, group: 2, menu: 'format', milkdown: true },
  { id: 'indent', label: '增加缩进', icon: IndentIncrease, group: 2, menu: 'format', milkdown: true },
  { id: 'outdent', label: '减少缩进', icon: IndentDecrease, group: 2, menu: 'format', milkdown: true },
  // 下面三项不是「点一下就执行」，菜单里给它们色板与档位（见 FormatMenu）
  { id: 'font-size', label: '字号', icon: Baseline, group: 2, menu: 'format', milkdown: true },
  { id: 'text-color', label: '文字颜色', icon: Paintbrush, group: 2, menu: 'format', milkdown: true },
  { id: 'bg-color', label: '背景色', icon: PaintBucket, group: 2, menu: 'format', milkdown: true },

  // ================= 「插入」菜单（Milkdown 专属） =================
  // 面板 / 时间线 / 图表 / 目录 的渲染层早就有了（milkdownEnhance 的装饰器：
  // CONTAINERS / TIMELINE / MERMAID / TOC 四套分支），这里补的是「插一段带这种
  // 语法的 Markdown」这个入口 —— 装饰器认的是语法本身，不关心它从哪来。
  { id: 'md-panel', label: '提示面板', icon: LayoutPanelTop, group: 4, menu: 'insert', milkdown: true },
  { id: 'md-timeline', label: '时间线', icon: GitCommitVertical, group: 4, menu: 'insert', milkdown: true },
  { id: 'md-chart', label: '图表', icon: ChartNoAxesColumn, group: 4, menu: 'insert', milkdown: true },
  { id: 'md-toc', label: '目录', icon: ListTree, group: 4, menu: 'insert', milkdown: true },
  { id: 'md-footnote', label: '脚注', icon: Hash, group: 4, menu: 'insert', milkdown: true },
  { id: 'md-math', label: '数学公式', icon: Sigma, group: 4, menu: 'insert', milkdown: true },
  { id: 'md-emoji', label: '表情', icon: Smile, group: 4, menu: 'insert', milkdown: true },
]

/**
 * 工具栏上的分组折叠菜单。
 *
 * group 取「它前面那一组的编号」：渲染时命令与菜单会一起按 group 稳定排序，
 * 菜单因此正好落在该组命令的末尾（如 format 接在行内格式那组之后）。
 */
export const TOOLBAR_MENUS: MarkdownMenuSpec[] = [
  { id: 'format', label: '格式', icon: Paintbrush, group: 2, width: 248, engines: ['milkdown'] },
  { id: 'insert', label: '插入', icon: Plus, group: 4, width: 212, engines: ['milkdown'] },
]

/**
 * 某内核下在自绘工具栏上平铺展示的命令清单。
 * cherryHidden（只进原生配置）与声明了 menu（收进折叠菜单）的项排除掉。
 */
export function commandsFor(engine: MarkdownEngine): MarkdownCommand[] {
  return MARKDOWN_COMMANDS.filter((item) => {
    if (item.cherryHidden) return false
    if (item.menu) return false
    return engine === 'cherry' ? item.cherry || item.cherryHostOnly : item.milkdown
  })
}

/** 某个内核下可用的分组折叠菜单清单 */
export function menusFor(engine: MarkdownEngine): MarkdownMenuSpec[] {
  return TOOLBAR_MENUS.filter((menu) => menu.engines.includes(engine))
}

/** 某个下拉菜单里包含的命令清单 */
export function menuCommandsFor(
  engine: MarkdownEngine,
  menu: ToolbarMenuId
): MarkdownCommand[] {
  return MARKDOWN_COMMANDS.filter((item) => {
    if (item.menu !== menu) return false
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
