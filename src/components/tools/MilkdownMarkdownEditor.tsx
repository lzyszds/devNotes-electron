import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { history } from '@milkdown/kit/plugin/history'
import { indent } from '@milkdown/kit/plugin/indent'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { Plugin } from '@milkdown/kit/prose/state'
import type { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import { $prose, insert, replaceAll } from '@milkdown/kit/utils'
import { keymap } from '@milkdown/kit/prose/keymap'
import { selectAll } from '@milkdown/kit/prose/commands'
import { highlight, highlightPluginConfig } from '@milkdown/plugin-highlight'
import { useNotes } from '../../context/NotesContext'
import { subscribeCodeBlockTheme } from '../../utils/codeBlockTheme'
import { refreshMilkdownHighlight, setShikiTheme, shikiParser } from '../../utils/milkdownShiki'
import { createMilkdownAdapter } from '../../utils/milkdownAdapter'
import { inlineHtmlView } from '../../utils/milkdownHtmlView'
import { autolinkTrimPlugin } from '../../utils/milkdownAutolink'
import {
  inlineTagMarks,
  inlineTagRemarkPlugin,
  inlineTagStringifyHandlers,
} from '../../utils/milkdownInlineTag'
import { milkdownSearchPlugin } from '../../utils/milkdownSearch'
import { floatingBar } from '../../utils/milkdownFloatingBar'
import { collectOutline } from '../../utils/milkdownOutline'
import type { OutlineItem } from '../../utils/milkdownOutline'
import { useEditorContextMenu } from '../../hooks/useEditorContextMenu'
import { usePresence } from '../../hooks/usePresence'
import MarkdownToolbar from './markdown/MarkdownToolbar'
import OutlineCapsule from './markdown/OutlineCapsule'
import FindReplaceBar from './markdown/FindReplaceBar'
import SlashMenu, { slash } from './markdown/SlashMenu'
import BlockHandle from './markdown/BlockHandle'
import SelectionToolbar from './markdown/SelectionToolbar'
import InsertToolbar from './markdown/InsertToolbar'
import { bumpEnhanceTheme, enhancePluginKey, milkdownEnhance } from '../../utils/milkdownEnhance'
import {
  getCurrentHeadingLevel,
  getMilkdownLinkAtCursor,
  insertBlockMarkdown,
  insertInlineMarkdown,
  insertMilkdownImage,
  runMilkdownCommand,
  setInlineBackgroundColor,
  setInlineFontSize,
  setInlineTextColor,
  setMilkdownHeading,
  setMilkdownLink,
  toggleHighlight,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
} from './markdown/milkdownCommands'
import { SNIPPETS } from '../../utils/markdownSnippets'
import type { MarkdownCommand } from './markdown/toolbarSpec'
import type { ToolbarItemState } from './markdown/MarkdownToolbar'

// Milkdown 自带的排版样式。prosemirror.css 是必需的(定位、断词、gapcursor)；
// 表格与 gapcursor 的样式只在用到对应能力时才有内容,一并引入省得漏。
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css'
import '@milkdown/kit/prose/tables/style/tables.css'

export type MilkdownMarkdownEditorProps = {
  value: string
  onChange?: (markdown: string) => void
  className?: string
  /** 内容里含 Cherry 专有语法时回调一次,由宿主决定怎么提示 */
  onWarning?: (message: string) => void
  /** 当前笔记标题，供右键菜单的「Front Matter」「当前文档信息」使用 */
  title?: string
  /** 右键菜单里的「全屏」「查找替换」「大纲」由宿主统一分派（两个内核共用一套实现） */
  onToggleFullscreen?: () => void
  onOpenSearch?: () => void
  onToggleOutline?: () => void
  /** 宿主是否处于全屏态，用于短暂屏蔽 Esc 退出全屏之外的干扰 */
  fullscreen?: boolean
  /** 全屏预览态（只读 + 铺满视口）。由宿主统一切换，两个内核共用同一份状态 */
  preview?: boolean
  onTogglePreview?: () => void
}

/** 标题下拉的选项。0 表示退回正文,与 Cherry 侧的「正文」项对齐 */
const HEADING_OPTIONS: { level: number; label: string }[] = [
  { level: 1, label: '标题 1' },
  { level: 2, label: '标题 2' },
  { level: 3, label: '标题 3' },
  { level: 4, label: '标题 4' },
  { level: 5, label: '标题 5' },
  { level: 6, label: '标题 6' },
  { level: 0, label: '正文' },
]

/** 需要先收一个参数才能执行的命令,点击后弹出输入层 */
type PopupKind = 'heading' | 'link' | 'image'

/** 勾选框热区宽度(px)。方框本身 13px,留点余量;再往右就是正文了,点那儿应该是放光标 */
const TASK_CHECKBOX_HIT_AREA = 20

/**
 * 判定「读到哪一节」的参考线：标题顶边进入滚动容器顶部这么多像素内，就算读到了。
 * 取 140 是为了给顶部的工具条与标题自身留出视觉余量，和参考实现的取一致。
 */
const OUTLINE_ACTIVE_OFFSET = 140

/**
 * 点击任务项左侧的方框切换勾选。
 *
 * gfm 只把勾选状态落成了 list_item 的 DOM 属性,没有配任何点击处理 ——
 * 不补这个插件,index.css 里画出来的方框就是个点不动的摆设。
 */
const taskListClickPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleClickOn(view, _pos, node, nodePos, event) {
          if (node.type.name !== 'list_item' || node.attrs.checked == null) return false

          const dom = view.nodeDOM(nodePos)
          if (!(dom instanceof HTMLElement)) return false
          // 只在左侧方框那一小块当勾选用,点正文交给默认行为放光标
          if (event.clientX - dom.getBoundingClientRect().left > TASK_CHECKBOX_HIT_AREA) {
            return false
          }

          view.dispatch(
            view.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            })
          )
          return true
        },
      },
    })
)

/**
 * 所见即所得内核(Milkdown)。
 *
 * 与 Cherry 那套「构造原生实例 + 隐形原生工具栏」不同,Milkdown 没有 UI 外壳,
 * 自己就是 ProseMirror 的 EditorView,所以工具栏是纯 React 的、命令直连(见 milkdownCommands.ts)。
 *
 * 内容同步沿用与 Cherry 同构的三层防回环:
 *   1. suppressChangeRef 标记程序化写入,期间不往外抛 onChange
 *   2. 往外抛过的 markdown 记在 lastEmittedRef,外部 value 回流时先比字符串,是自己刚吐的就跳过
 *   3. 写入后 requestAnimationFrame 复位标志,避开同一帧里 listener 的延迟回调
 */
export default function MilkdownMarkdownEditor({
  value,
  onChange,
  className = '',
  onWarning,
  title = '',
  onToggleFullscreen,
  onOpenSearch,
  onToggleOutline,
  fullscreen = false,
  preview = false,
  onTogglePreview,
}: MilkdownMarkdownEditorProps) {
  const { registerInsertHandler, handleExport } = useNotes()

  const mountRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const onChangeRef = useRef(onChange)
  const onWarningRef = useRef(onWarning)
  // 只在挂载时喂给 Milkdown;挂载 effect 不能依赖 value,否则每次打字都重建实例
  const latestValueRef = useRef(value)
  // 自己最近一次抛出去的 markdown,用来把回流认出来
  const lastEmittedRef = useRef(value)
  // 程序化写入期间屏蔽 listener,防「写入 → listener → onChange → setState → 再写入」回环
  const suppressChangeRef = useRef(false)
  // create() 是异步的,就绪前 listener 拿不到实例、也不该收外部写入
  const readyRef = useRef(false)

  const [popup, setPopup] = useState<PopupKind | null>(null)
  const [popupText, setPopupText] = useState('')
  const [headingLevel, setHeadingLevel] = useState(0)
  // 与 CSS 里 .fe-pop[data-state='closed'] 的时长一致
  const { mounted: popupMounted, state: popupState } = usePresence(Boolean(popup), 130)
  /**
   * 收起期间 popup 已经置空，面板却还要在 DOM 里多留一会儿播退出动画。
   * 留住最后一次的类型快照，否则渲染到一半就不知道该画哪一块内容了。
   */
  const lastPopupRef = useRef<PopupKind | null>(null)
  if (popup) lastPopupRef.current = popup
  const shownPopup = popup ?? lastPopupRef.current
  // 右侧悬浮大纲：条目、展开与否、当前读到的条目、已读百分比
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([])
  const [outlineExpanded, setOutlineExpanded] = useState(false)
  const [outlineActive, setOutlineActive] = useState(-1)
  const [readPercent, setReadPercent] = useState(0)
  // 查找替换条只由编辑器自己管：宿主那边没有别的入口会打开它
  const [searchOpen, setSearchOpen] = useState(false)
  /**
   * 实例就绪后才把编辑器交给斜杠菜单/块手柄。
   *
   * 这两个组件的 Provider 需要 editor.ctx 与已挂载的 DOM，
   * 而 editorRef 是 ref、变了不触发渲染，所以额外用一份 state 做「已就绪」信号。
   */
  const [ready, setReady] = useState<Editor | null>(null)

  /**
   * 两条浮出工具条的 Provider。
   *
   * 引用放在这里而不是各自的组件里：驱动它们的 ProseMirror 插件必须在
   * `editor.create()` 之前注册好（见 milkdownFloatingBar.ts），而插件要闭包捕获
   * 这两个 ref。组件那边只负责把建好的实例写进来。
   */
  const selectionBarRef = useRef<TooltipProvider | null>(null)
  const insertBarRef = useRef<TooltipProvider | null>(null)
  const blockHandleRef = useRef<TooltipProvider | null>(null)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onWarningRef.current = onWarning
  }, [onWarning])

  useEffect(() => {
    latestValueRef.current = value
  }, [value])

  /** 命令执行后焦点会留在工具栏按钮上,补一次聚焦,否则接着打字没反应 */
  const focusEditor = useCallback(() => {
    editorRef.current?.action((ctx) => ctx.get(editorViewCtx).focus())
  }, [])

  /** 导出直接落到 .md（Cherry 侧走它自己的多格式导出菜单，见 CherryMarkdownEditor） */
  const handleExportRef = useRef(handleExport)
  useEffect(() => {
    handleExportRef.current = handleExport
  }, [handleExport])

  /**
   * 适配器只建一次 —— cherryRef/editorRef 都是 ref，读它永远是当前实例，
   * 每次渲染重建会让整棵右键菜单树跟着重建。
   */
  const adapter = useMemo(
    () =>
      createMilkdownAdapter(editorRef, {
        onExport: () => void handleExportRef.current(),
      }),
    []
  )

  /**
   * 展开/收起右侧大纲胶囊。
   * 定义在 useEditorContextMenu 之前 —— 那个 hook 要把「大纲」这一项的开关传下去，
   * 而它是在渲染期取值的，放在后面会撞上 const 的暂时性死区。
   */
  const toggleOutlinePanel = useCallback(() => setOutlineExpanded((prev) => !prev), [])

  const { onEditorContextMenu } = useEditorContextMenu({
    adapter,
    title,
    onRequestFullscreen: onToggleFullscreen,
    onRequestSearch: onOpenSearch,
    // 宿主（Cherry）没接管时用自绘的这一套
    onRequestOutline: onToggleOutline ?? toggleOutlinePanel,
  })

  /** 编辑区即整个可编辑范围（所见即所得没有独立的只读预览区），不用像 Cherry 那样分流 */
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (!editorRef.current) return
      onEditorContextMenu(event)
    },
    [onEditorContextMenu]
  )

  // 监听超链接点击，统一在系统默认浏览器中安全打开
  useEffect(() => {
    const root = mountRef.current
    if (!root) return

    const handleLinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const link = target?.closest<HTMLAnchorElement>('a')
      if (!link) return
      const href = link.getAttribute('href')
      if (!href) return

      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        e.preventDefault()
        if (window.electronAPI?.openExternal) {
          void window.electronAPI.openExternal(href)
        } else {
          window.open(href, '_blank', 'noopener,noreferrer')
        }
      }
    }

    root.addEventListener('click', handleLinkClick)
    return () => root.removeEventListener('click', handleLinkClick)
  }, [])

  // ================= 构造与销毁 =================
  useEffect(() => {
    const root = mountRef.current
    if (!root) return

    // create() 尚未 resolve 时组件就卸载了,靠这个标志把迟到的实例直接销毁掉
    let disposed = false
    readyRef.current = false

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, latestValueRef.current)
        // 挂一个自有类名,换肤时不用去猜 ProseMirror 的内部结构
        ctx.set(editorViewOptionsCtx, {
          attributes: { class: 'milkdown-content' },
        })
        // 代码块高亮走 shiki，parser 的形态与坑见 milkdownShiki.ts
        ctx.set(highlightPluginConfig.key, { parser: shikiParser })

        /*
         * 行内样式（span / u / sup / sub）在 schema 里是 mark —— 文字节点保持可编辑，
         * 这一点必须成立，否则套上颜色那段字就成了一块改不动的原子节点。
         * 但 Markdown 侧写的仍是内联 HTML，mdast 里没有「包在文字外面的 mark」这种结构，
         * 所以两头都要自己接一段，缺一不可：
         *   解析：remark 插件把 `html`+内容+`html` 三个兄弟节点并成一个自定义节点
         *   序列化：往 remark-stringify 的 handlers 里塞同名处理器，写回内联 HTML
         * 放在 config 里是因为它跑在所有内部插件注入之后、InitReady 之前 ——
         * 早于 schema 读 remarkPluginsCtx，也早于 init 拿 remarkStringifyOptionsCtx 建 processor。
         */
        ctx.update(remarkPluginsCtx, (list) => [
          ...list,
          { plugin: inlineTagRemarkPlugin, options: {} },
          // GFM 的自动链接遇到中文全角标点不收尾，会把后半句一并吞进链接里。
          // 必须排在 gfm 之后（放列表末尾即可），见 milkdownAutolink.ts
          { plugin: autolinkTrimPlugin, options: {} },
        ])
        ctx.update(remarkStringifyOptionsCtx, (prev) => ({
          ...prev,
          handlers: { ...prev.handlers, ...inlineTagStringifyHandlers },
        }))

        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (suppressChangeRef.current) return
          if (markdown === latestValueRef.current) return
          latestValueRef.current = markdown
          lastEmittedRef.current = markdown
          onChangeRef.current?.(markdown)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(history)
      .use(clipboard)
      .use(cursor)
      .use(indent)
      .use(trailing)
      .use(highlight)
      .use(taskListClickPlugin)
      .use(inlineHtmlView)
      .use(inlineTagMarks)
      .use(milkdownSearchPlugin)
      .use(slash)
      // 四处浮出 UI（选中文字 / 光标落在空行 / 块手柄 / 代码块语言标签）。插件只负责
      // 「每次视图更新问一次」，provider 要等 React 把宿主元素渲染出来才建得了，
      // 所以这里传的是取值函数。
      // 块手柄不在其中用 @milkdown/plugin/block —— 它的定位绑死了鼠标悬停，见 BlockHandle.tsx
      .use(floatingBar('selection', () => selectionBarRef.current))
      .use(floatingBar('insert', () => insertBarRef.current))
      .use(floatingBar('block-handle', () => blockHandleRef.current))
      // 容器面板 / 目录 / Mermaid 图表 / 代码行号：全部走 ProseMirror 装饰器，
      // 不碰编辑区 DOM —— 直接改 contenteditable 会让标记外溢、文字并进链接，见该文件注释
      .use(milkdownEnhance)
      /*
       * 全选。
       * 浏览器默认只在 Windows/Linux 上把 Ctrl+A 当全选；macOS 上 Ctrl+A 是「移到行首」
       * （emacs 习惯），Cmd+A 才是全选。这里两个都显式接管，免得按 Ctrl+A 毫无反应、
       * 看着像「全选没有高亮」。
       */
      .use($prose(() => keymap({ 'Mod-a': selectAll, 'Ctrl-a': selectAll })))

    editor.create().then((instance) => {
      if (disposed) {
        void instance.destroy()
        return
      }
      editorRef.current = instance
      readyRef.current = true
      setReady(instance)

      // 构造期间外部可能已改过 value(挂载 effect 的依赖只有 value,那一次会被 readyRef 挡掉),补一次同步
      if (latestValueRef.current !== lastEmittedRef.current) {
        const next = latestValueRef.current
        suppressChangeRef.current = true
        try {
          instance.action(replaceAll(next))
          lastEmittedRef.current = next
        } finally {
          requestAnimationFrame(() => {
            suppressChangeRef.current = false
          })
        }
      }
    })
    // 初始化失败原本没人接,表现成「编辑区能打字、工具栏却点不动」的静默故障,
    // 这里显式打出来,免得下次还要靠端到端调试才找得到
    .catch((err) => {
      console.error('[Milkdown] 编辑器初始化失败:', err)
    })

    return () => {
      disposed = true
      readyRef.current = false
      editorRef.current = null
      // 同步置空，避免销毁后子组件还拿着旧实例去建 Provider
      setReady(null)
      try {
        void editor.destroy()
      } catch {
        // 卸载途中销毁失败无需处理
      }
    }
  }, [])

  // ================= 代码块主题 =================
  /*
   * 换档位只需要换主题 + 让已有装饰重算一遍，不必重建编辑器。
   *
   * 顺序要紧：主题是按需载入的，得等 setShikiTheme resolve 之后再重刷 ——
   * 反过来的话这次重刷用的还是旧主题，界面看着像没换。
   * 编辑器还没建好时不用重算：它创建时读到的就已经是新主题了。
   */
  useEffect(
    () =>
      subscribeCodeBlockTheme((id) => {
        void setShikiTheme(id).then(() => {
          editorRef.current?.action((ctx) => refreshMilkdownHighlight(ctx.get(editorViewCtx)))
        })
      }),
    []
  )

  // ================= 大纲 =================
  // 文档一变就重扫。常态收集 —— 胶囊折叠时也要显示骨架条，不能只在展开时才扫
  useEffect(() => {
    setOutlineItems(collectOutline(editorRef.current))
  }, [value, ready])

  /** 取编辑器里的标题元素。DOM 顺序与 collectOutline 的条目顺序都是文档序，可以按下标一一对应 */
  const headingElements = useCallback(
    () => mountRef.current?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
    []
  )

  /**
   * 滚动同步：已读百分比 + 当前读到第几节。
   *
   * 用 rAF 节流 —— scroll 的触发频率远高于渲染帧，逐个直接 setState 会白算很多次。
   */
  useEffect(() => {
    const scroll = mountRef.current
    if (!scroll) return

    let frame = 0
    const measure = () => {
      frame = 0
      const max = scroll.scrollHeight - scroll.clientHeight
      setReadPercent(max > 0 ? Math.min(100, Math.round((scroll.scrollTop / max) * 100)) : 100)

      const headings = scroll.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
      if (!headings.length) {
        setOutlineActive(-1)
        return
      }
      const containerTop = scroll.getBoundingClientRect().top
      let active = 0
      headings.forEach((el, index) => {
        if (el.getBoundingClientRect().top - containerTop <= OUTLINE_ACTIVE_OFFSET) active = index
      })
      setOutlineActive(active)
    }

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    scroll.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroll.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [value, ready])

  /** 跳到某一节：滚进视野并闪一下，方便确认落在哪 */
  const pickOutlineItem = useCallback(
    (index: number) => {
      const target = headingElements()?.[index]
      if (!target) return
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      target.classList.add('fe-outline-flash')
      window.setTimeout(() => target.classList.remove('fe-outline-flash'), 900)
    },
    [headingElements]
  )

  const scrollToTop = useCallback(() => {
    mountRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  /** 工具栏按钮的 active 态。只标「开着/关着」这类开关，不做光标处的格式嗅探 */
  const toolbarState = useMemo<Record<string, ToolbarItemState>>(
    () => ({
      fullscreen: { active: fullscreen },
      search: { active: searchOpen },
      outline: { active: outlineExpanded },
    }),
    [fullscreen, searchOpen, outlineExpanded]
  )

  /*
   * 全屏预览是只读的：把 ProseMirror 的 editable 关掉。
   * 只这一处就够 —— 块手柄、插入浮条、选区浮条各自都有一条 `if (!view.editable)` 守卫
   * （见 BlockHandle / InsertToolbar / SelectionToolbar），会跟着一起安静下来。
   *
   * editable 是 EditorView 的构造期 prop，建好之后要改只能走 setProps。
   * 顺带在进入预览时收掉查找条，免得它悬在只读的正文上面。
   */
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !readyRef.current) return
    if (preview) setSearchOpen(false)
    editor.action((ctx) => {
      ctx.get(editorViewCtx).setProps({ editable: () => !preview })
    })
  }, [preview, ready])

  // ================= 外部 value 回流 =================
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !readyRef.current) return
    // 先比较再写:自己刚抛出去的那次不该再写回去,否则光标会被重置
    if (value === lastEmittedRef.current) return

    suppressChangeRef.current = true
    lastEmittedRef.current = value
    try {
      editor.action(replaceAll(value))
    } finally {
      // 给渲染一帧时间,避免把程序写入当作用户编辑
      requestAnimationFrame(() => {
        suppressChangeRef.current = false
      })
    }
  }, [value])

  // ================= 深浅色切换时重绘装饰器 =================
  // 图表卡片要跟着换配色。装饰器由 state 驱动，这里推一个空事务让它重算，
  // 同时自增 stamp 让 widget 的 key 变化、强制重建 DOM。
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      const editor = editorRef.current
      if (!editor || !readyRef.current) return
      bumpEnhanceTheme()
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setMeta(enhancePluginKey, { theme: Date.now() }))
      })
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // ================= 外部片段插入 =================
  // 与 Cherry 不同,这里按 markdown 解析后以节点形式插到光标处,
  // 直接塞字符串的话会原样显示成 `**加粗**` 这种源码
  useEffect(() => {
    registerInsertHandler((prefix: string, suffix = '') => {
      const editor = editorRef.current
      if (!editor || !readyRef.current) return
      try {
        editor.action(insert(prefix + suffix))
        focusEditor()
      } catch (err) {
        console.error('插入文本失败:', err)
      }
    })
  }, [registerInsertHandler, focusEditor])

  // ================= 工具栏 =================
  const handleCommand = useCallback(
    (command: MarkdownCommand, _anchor: HTMLElement) => {
      // 大纲：Cherry 走它自带浮层，Milkdown 这套是自绘的，所以只有传了宿主回调时才外抛
      if (command.id === 'outline') {
        if (onToggleOutline) onToggleOutline()
        else toggleOutlinePanel()
        return
      }
      if (command.id === 'fullscreen') {
        onToggleFullscreen?.()
        return
      }
      if (command.id === 'preview') {
        onTogglePreview?.()
        return
      }
      // 查找替换同理：宿主没接管时用编辑器自带的这条
      if (command.id === 'search') {
        if (onOpenSearch) onOpenSearch()
        else setSearchOpen((prev) => !prev)
        return
      }
      if (command.id === 'export') {
        void handleExportRef.current()
        return
      }
      // 标题先标出当前级别再弹层
      if (command.id === 'heading') {
        setHeadingLevel(getCurrentHeadingLevel(editorRef.current))
        setPopup('heading')
        return
      }
      if (command.id === 'link' || command.id === 'image') {
        // 光标已经落在某条链接里时回填它现有的地址，面板就是「编辑链接」而不是新建
        setPopupText(command.id === 'link' ? getMilkdownLinkAtCursor(editorRef.current) : '')
        setPopup(command.id)
        return
      }
      runMilkdownCommand(editorRef.current, command.id)
      focusEditor()
    },
    [focusEditor, onOpenSearch, onToggleFullscreen, onToggleOutline, onTogglePreview, toggleOutlinePanel]
  )

  /**
   * 分组折叠菜单里的命令。
   *
   * 与 handleCommand 分开是因为入口形态不同：平铺按钮传的是整条命令声明，
   * 菜单传的是 id 加一个可选的值（字号档位、色值、表情）。
   * 「清除格式 / 缩进」不走 milkdownCommands —— 那两条实现在适配器上
   * （unwrapSelection / indentLines），它们同时要服务右键菜单，不宜在这里再抄一份。
   */
  const handleMenuCommand = useCallback(
    (id: string, payload?: string | number) => {
      const editor = editorRef.current
      if (!editor || !readyRef.current) return

      switch (id) {
        // —— 格式菜单：行内样式 ——
        case 'underline':
          toggleUnderline(editor)
          break
        case 'superscript':
          toggleSuperscript(editor)
          break
        case 'subscript':
          toggleSubscript(editor)
          break
        case 'highlight':
          toggleHighlight(editor)
          break
        // 清除格式与缩进落在适配器上，与右键菜单共用同一份实现
        case 'clear-format':
          adapter.unwrapSelection()
          break
        case 'indent':
          adapter.indentLines(1)
          break
        case 'outdent':
          adapter.indentLines(-1)
          break
        case 'font-size':
          setInlineFontSize(editor, Number(payload) || 0)
          break
        case 'text-color':
          setInlineTextColor(editor, String(payload ?? ''))
          break
        case 'bg-color':
          setInlineBackgroundColor(editor, String(payload ?? ''))
          break

        // —— 插入菜单 ——
        // 块级片段强制以独立块形式落盘，确保 ::: 位于行首；表情走行内模式
        case 'md-panel':
          insertBlockMarkdown(editor, SNIPPETS.panel)
          break
        case 'md-timeline':
          insertBlockMarkdown(editor, SNIPPETS.timeline)
          break
        case 'md-chart':
          insertBlockMarkdown(editor, SNIPPETS.mermaid)
          break
        case 'md-toc':
          insertBlockMarkdown(editor, SNIPPETS.toc)
          break
        case 'md-footnote':
          insertBlockMarkdown(editor, SNIPPETS.footnote)
          break
        case 'md-math':
          insertBlockMarkdown(editor, SNIPPETS.math)
          break
        case 'md-emoji':
          insertInlineMarkdown(editor, String(payload ?? ''))
          break
        default:
          return
      }
      focusEditor()
    },
    [adapter, focusEditor]
  )

  // Esc 关掉查找条。只在条子开着时挂监听，且不抢输入框自己的 Esc
  useEffect(() => {
    if (!searchOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [searchOpen])

  /**
   * ⌘F 唤出查找条。
   *
   * 只在鼠标/焦点落在本编辑器内时接管 —— 全站还有别的工具在跑，
   * 全局抢 ⌘F 会让别的页面按下没反应。判断依据是 activeElement 是否在挂载点上，
   * 这比「当前是否可见」准确：同屏切换工具时不可见的那个编辑器也会留着监听。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'f') return
      const root = mountRef.current
      const active = document.activeElement
      if (!root || !active || !root.contains(active)) return

      event.preventDefault()
      if (onOpenSearch) onOpenSearch()
      else setSearchOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenSearch])

  const closePopup = useCallback(() => {
    setPopup(null)
    setPopupText('')
  }, [])

  const confirmPopup = useCallback(() => {
    const text = popupText.trim()
    if (popup === 'link') {
      // 光标停在空白处时无处可挂，明确提示而不是静默改成「之后输入都变链接」
      if (!setMilkdownLink(editorRef.current, text)) {
        onWarningRef.current?.('请先选中要加链接的文字，或把光标放到某个词上再试。')
        return
      }
    } else if (popup === 'image') {
      insertMilkdownImage(editorRef.current, text)
    }
    closePopup()
    focusEditor()
  }, [popup, popupText, closePopup, focusEditor])

  const pickHeading = useCallback(
    (level: number) => {
      setMilkdownHeading(editorRef.current, level)
      closePopup()
      focusEditor()
    },
    [closePopup, focusEditor]
  )

  return (
    <div
      className={`milkdown-notes-editor flex h-full min-h-0 flex-col ${
        outlineItems.length ? 'has-outline' : ''
      } ${className}`}
    >
      {/* 预览态是只读的，工具栏上每一颗按钮都点不出效果 */}
      {!preview && (
        <MarkdownToolbar
          engine="milkdown"
          onCommand={handleCommand}
          // 分组折叠菜单（格式 / 插入）里的命令走这条，与平铺按钮分开
          onMenuCommand={handleMenuCommand}
          // Milkdown 不像 Cherry 那样把状态渲染进 DOM，active 态由这里给出
          state={toolbarState}
        />
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={mountRef}
          onContextMenu={handleContextMenu}
          className="milkdown-scroll h-full w-full overflow-y-auto"
        />

        {/* 右侧悬浮大纲：折叠态是一条骨架胶囊，展开后是目录卡片 */}
        <OutlineCapsule
          items={outlineItems}
          activeIndex={outlineActive}
          readPercent={readPercent}
          expanded={outlineExpanded}
          onExpandedChange={setOutlineExpanded}
          onPick={pickOutlineItem}
          onScrollTop={scrollToTop}
        />

        {/* 挂到编辑区内层容器上：Provider 用绝对定位放置，容器必须与编辑区同坐标系 */}
        <SlashMenu editor={ready} />
        <BlockHandle editor={ready} providerRef={blockHandleRef} />

        {/* 这几条的宿主元素会被 Provider 搬到 document.body 下，与编辑区不同坐标系
            （用 fixed 定位），所以放在哪一层都行 */}
        <SelectionToolbar
          editor={ready}
          providerRef={selectionBarRef}
          onClearFormat={() => adapter.unwrapSelection()}
        />
        <InsertToolbar editor={ready} providerRef={insertBarRef} />

        {/* 常驻挂载：开关交给 open，退出动画才有机会跑完（见 usePresence） */}
        {!onOpenSearch && (
          <FindReplaceBar
            editor={editorRef.current}
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
          />
        )}

        {popupMounted && shownPopup && (
          <>
            {/* 点空白处收起。铺一层透明背板比监听全局 click 简单,也不会和工具栏的点击打架 */}
            <div className="absolute inset-0 z-20" onMouseDown={closePopup} />

            {/* 外层只负责居中，动画挂在内层 —— 关键帧里的 transform 会盖掉 -translate-x-1/2，
                两者放同一个元素上会让面板在动画期间整体右移半个身位 */}
            <div className="absolute left-1/2 top-3 z-30 w-[21rem] max-w-[calc(100%-2rem)] -translate-x-1/2">
              <div
                data-state={popupState}
                className="fe-pop rounded-xl border border-slate-200/80 bg-white p-2 shadow-lg dark:border-dark-border dark:bg-dark-panel"
              >
                {shownPopup === 'heading' ? (
                  <div className="grid grid-cols-2 gap-0.5">
                    {HEADING_OPTIONS.map((option) => (
                      <button
                        key={option.level}
                        type="button"
                        onClick={() => pickHeading(option.level)}
                        className={`rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                          option.level === headingLevel
                            ? 'bg-brand-50 font-semibold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-dark-hover'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={popupText}
                      onChange={(event) => setPopupText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') confirmPopup()
                        if (event.key === 'Escape') closePopup()
                      }}
                      placeholder={
                        shownPopup === 'link' ? '链接地址 https://…' : '图片地址 https://…'
                      }
                      className="h-7 min-w-0 flex-1 rounded-md border border-slate-200/80 bg-slate-50 px-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-dark-border dark:bg-dark-hover dark:text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={confirmPopup}
                      disabled={!popupText.trim()}
                      className="h-7 flex-shrink-0 rounded-md bg-brand-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
                    >
                      确定
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
