import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePresence } from '../../../hooks/usePresence'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { SlashProvider, slashFactory } from '@milkdown/kit/plugin/slash'
import { insert } from '@milkdown/kit/utils'
import {
  Blocks,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Table as TableIcon,
} from 'lucide-react'

/** 斜杠菜单的插件 id。一个编辑器只注册一个实例 */
export const slash = slashFactory('fehelper-slash')

export interface SlashItem {
  id: string
  label: string
  hint: string
  icon: typeof Blocks
  /** 要插入的 Markdown 片段 */
  snippet: string
}

/**
 * 菜单项清单。
 *
 * 全部走 Markdown 片段 + `insert()` 宏，不直接调结构命令 —— 这样每一项的行为
 * 与工具栏那颗同名按钮完全一致（`insert` 会按 Markdown 解析成节点），
 * 少一套要单独维护的映射表。
 */
const SLASH_ITEMS: SlashItem[] = [
  { id: 'h1', label: '标题 1', hint: '# ', icon: Heading1, snippet: '# ' },
  { id: 'h2', label: '标题 2', hint: '## ', icon: Heading2, snippet: '## ' },
  { id: 'h3', label: '标题 3', hint: '### ', icon: Heading3, snippet: '### ' },
  { id: 'ul', label: '无序列表', hint: '- ', icon: List, snippet: '- ' },
  { id: 'ol', label: '有序列表', hint: '1. ', icon: ListOrdered, snippet: '1. ' },
  { id: 'task', label: '任务清单', hint: '- [ ] ', icon: ListChecks, snippet: '- [ ] ' },
  { id: 'quote', label: '引用', hint: '> ', icon: Quote, snippet: '> ' },
  { id: 'code', label: '代码块', hint: '```', icon: Code2, snippet: '```\n\n```' },
  { id: 'table', label: '表格', hint: '| |', icon: TableIcon, snippet: '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |' },
  { id: 'hr', label: '分割线', hint: '---', icon: Minus, snippet: '---' },
  { id: 'image', label: '图片', hint: '![]()', icon: ImageIcon, snippet: '![](https://)' },
]

export type SlashMenuProps = {
  editor: Editor | null
  /** 插件就绪后把 provider 交出去，由编辑器组件负责销毁 */
  onReady?: (provider: SlashProvider) => void
}

/**
 * 斜杠菜单。
 *
 * `SlashProvider` 只负责定位与显隐（基于 floating-ui），菜单本身是 React 渲染的，
 * 通过 `createPortal` 挂到 provider 给的容器里 —— 这样 React 的合成事件还能正常工作，
 * 不必像官方 Vue 组件那样手动绑 DOM 事件。
 */
export default function SlashMenu({ editor, onReady }: SlashMenuProps) {
  const [open, setOpen] = useState(false)
  // 关闭时先留在 DOM 里播完退出动画再卸载，时长与 .fe-pop 的 130ms 对齐
  const { mounted, state } = usePresence(open, 130)
  const [activeIndex, setActiveIndex] = useState(0)
  /*
   * provider 需要的容器，自己建、**不进 React 渲染树**。
   *
   * SlashProvider 初始化时会把它 appendChild 到 `view.dom.parentElement`（div.milkdown），
   * 等于把节点挪出了 React 认定的父节点。此后 React 往它附近插同胞节点时
   * （工具栏点「大纲」展开右侧胶囊就是这种情况）会拿它当 insertBefore 的参照物，浏览器抛
   * NotFoundError，整棵 React 树跟着崩。理由与 FloatingBar.tsx 里那段完全相同。
   */
  const [host] = useState(() => {
    const el = document.createElement('div')
    el.className = 'pointer-events-none absolute left-0 top-0 z-40'
    return el
  })
  const providerRef = useRef<SlashProvider | null>(null)
  // 菜单项要能被键盘事件读到最新值，用 ref 兜一层避免反复重绑监听
  const activeIndexRef = useRef(0)

  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  /** 选中某项：先删掉已输入的 `/xxx`，再插入片段 */
  const choose = useCallback(
    (item: SlashItem) => {
      if (!editor) return
      try {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const provider = providerRef.current
          // getContent 返回的是触发字符之后已输入的内容，用它算出要替换掉的范围
          const typed = provider?.getContent(view) ?? ''
          const { from } = view.state.selection
          const start = from - typed.length - 1
          view.dispatch(view.state.tr.delete(Math.max(0, start), from))
        })
        editor.action(insert(item.snippet))
      } catch (error) {
        console.error('[SlashMenu] 插入失败:', error)
      }
      providerRef.current?.hide()
      setOpen(false)
    },
    [editor]
  )

  useEffect(() => {
    if (!editor) return

    const provider = new SlashProvider({
      content: host,
      // 触发字符就是 `/`
      trigger: '/',
    })

    // onShow / onHide 是实例属性而非构造参数（构造时默认赋成空函数），只能建完再挂
    provider.onShow = () => {
      setOpen(true)
      setActiveIndex(0)
    }
    provider.onHide = () => setOpen(false)

    providerRef.current = provider
    onReady?.(provider)

    return () => {
      provider.destroy()
      providerRef.current = null
      // provider 只负责把它挂上去，摘下来是自己的事
      host.remove()
    }
    // onReady 只在挂载时用一次；依赖它会让 StrictMode 双跑时反复重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, host])

  /**
   * 键盘导航。
   *
   * 用捕获阶段：ProseMirror 自己在编辑区上处理 keydown，普通监听会被它先消费掉，
   * 上下键就变成移动光标了。
   */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((prev) => (prev + 1) % SLASH_ITEMS.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((prev) => (prev - 1 + SLASH_ITEMS.length) % SLASH_ITEMS.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        choose(SLASH_ITEMS[activeIndexRef.current])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        providerRef.current?.hide()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, choose])

  return (
    <>
      {/*
        菜单渲染进 hook 里建好的宿主容器。定位由 floating-ui 接管，
        真正的可见性靠 open 控制内层菜单的渲染。
      */}
      {mounted &&
        createPortal(
          <div
            data-state={state}
            className="fe-pop pointer-events-auto w-56 overflow-hidden rounded-xl border border-slate-200/80 bg-white py-1 shadow-lg dark:border-dark-border dark:bg-dark-panel"
            // 菜单在 portal 里，点它不该让编辑区失焦
            onMouseDown={(event) => event.preventDefault()}
          >
            {SLASH_ITEMS.map((item, index) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => choose(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                    index === activeIndex
                      ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  <span className="flex-shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                    {item.hint}
                  </span>
                </button>
              )
            })}
          </div>,
          host
        )}
    </>
  )
}
