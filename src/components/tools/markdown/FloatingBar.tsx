import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ComponentType, MutableRefObject, ReactNode } from 'react'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import type { EditorView } from '@milkdown/kit/prose/view'
import Tooltip from '../../ui/Tooltip'

export type FloatingBarOptions = {
  /** 什么时候该浮出来。每次视图更新、每次滚动/松手都会问一次 */
  shouldShow: (view: EditorView) => boolean
  /** 相对光标/选区的位置。默认贴在下方左侧 */
  placement?: 'top-start' | 'top' | 'bottom-start' | 'bottom' | 'left-start'
  /** 触发判定的节流窗口（ms）。leading 生效，所以第一次永远是即时的 */
  throttle?: number
  /**
   * 钉死横向位置（视口坐标 px）。传了就完全不听 floating-ui 的横向计算。
   *
   * Cherry 的空行浮条就是这个行为：竖向跟着当前行，横向固定在编辑区左侧一段距离外，
   * 而不是贴着光标跑。每次评估 shouldShow 时重新求值，所以里面可以放心读 DOM。
   */
  pinLeft?: (view: EditorView) => number
  /**
   * 钉死到某个矩形的**右上角**（视口坐标）。传了就完全不听 floating-ui、也不听 pinLeft。
   *
   * 用于「浮条属于某一个块而不是光标那一行」的场景 —— 代码块的语言标签就贴在
   * 该代码块自己的右上角，光标在块里怎么移它都不动。
   */
  pinRect?: (view: EditorView) => { top: number; right: number } | null
  /**
   * 宿主容器的类名（如 `fehelper-floating-bar`）。
   *
   * 宿主元素由 hook 自己建、不参与 React 渲染，所以类名走这里给，
   * 而不是在 JSX 里写 `<div ref={setHost} className=…>`。原因见 hook 里的注释。
   */
  hostClassName?: string
  /**
   * 每次评估（光标移动、打字、滚动）都被调一次，在 shouldShow 之前。
   *
   * 用来把「跟着光标走」的信息同步进 React，比如代码块当前的语言。
   * 传进来的值没变时 setState 会自己 bail out，不必在调用方比一遍。
   */
  onEvaluate?: (view: EditorView) => void
  /** 显隐变化。用来在浮条收起来时顺手复位它内部展开的小面板 */
  onVisibilityChange?: (visible: boolean) => void
  /**
   * 按住鼠标期间是否收起来，默认收。
   *
   * 文字浮条要收 —— 拖选的过程中浮条一路跟着闪很难看，且松手前那次选区不是最终的。
   * 块手柄必须关掉：拖拽正是从它自己身上按下去的，按下去就收起来等于永远拖不动。
   */
  hideWhilePointerDown?: boolean
}

/**
 * 浮出工具条的公共骨架。
 *
 * 四件事必须同时做对，少一件浮条就不出现（左侧块手柄当初三条全踩）：
 *
 * 1. **`TooltipProvider.update()` 得有人每次视图更新都调** —— 交给 `floatingBar()`
 *    生成的插件，见 milkdownFloatingBar.ts。
 * 2. **容器挂到 `document.body` 上** —— 编辑区外壳 `.milkdown-scroll` 是
 *    `overflow-y: auto`，横向也就跟着变成了 auto，浮条贴着编辑区边缘时会被直接裁掉。
 *    挂到 body 后 floating-ui 必须配 `strategy: 'fixed'`，才能与 `posToDOMRect`
 *    给出的视口坐标对齐。
 * 3. **内容必须走 `createPortal`** —— 容器被 provider 搬出 React 根节点之后，
 *    普通子节点的合成事件不再派发（React 18 把监听挂在根容器上），
 *    只有 portal 会被 React 单独补挂一份。
 * 4. **容器本身不能由 React 渲染** —— 它会被 provider 搬走，React 之后往它附近插
 *    同胞节点就会抛 `NotFoundError`。见下面 useState 那段的注释。
 *
 * 另外两处细节：
 * - 按住鼠标期间不显示。拖选文字的过程中浮条一路跟着闪很难看，
 *   且松手前的那次选中本来也不是最终选区。
 * - 浮条自己拿着焦点时一律保持显示。链接输入框一聚焦编辑区就失焦，
 *   不特判的话刚点开输入框浮条就自己消失了。
 */
export function useFloatingBar(
  editor: Editor | null,
  providerRef: MutableRefObject<TooltipProvider | null>,
  options: FloatingBarOptions
) {
  // 每次渲染都刷新，保证 provider 里读到的是最新的 shouldShow / placement
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  /*
   * 宿主容器由 hook 自己建，**不进 React 渲染树**。
   *
   * TooltipProvider 初始化时会把它 appendChild 到 document.body，等于把节点从
   * React 认定的父节点里挪走了。此后 React 一旦要往它后面插入同胞节点 —— 块手柄的
   * 拖拽指示线从无到有就是这种情况 —— 会拿它当 insertBefore 的参照物，而它已经不在
   * 那个父节点下，浏览器抛 `NotFoundError`，整棵 React 树跟着崩。卸载时同理：React
   * 按原父节点摘它，也摘不到。
   *
   * 让 React 压根不碰这个节点，两类问题一起消失。
   *
   * 用 useState 的惰性初始化而不是 useEffect：这样拿到的是同一个元素。挂 effect 里
   * 建的话 StrictMode 双跑会多造一个没人用的节点，还已经被 provider 挂到 body 上了。
   */
  const [host] = useState(() => {
    const el = document.createElement('div')
    el.className = optionsRef.current.hostClassName ?? ''
    return el
  })

  // 按住鼠标期间不弹，松手后再补问一次
  const pointerDownRef = useRef(false)
  useEffect(() => {
    const onDown = () => {
      pointerDownRef.current = true
    }
    const onUp = () => {
      pointerDownRef.current = false
      // 松手本身不产生 ProseMirror 事务，不主动补一次的话最后一次选区没人评估
      if (editor) {
        editor.action((ctx) => providerRef.current?.update(ctx.get(editorViewCtx)))
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('mouseup', onUp, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('mouseup', onUp, true)
    }
  }, [editor, host, providerRef])

  useEffect(() => {
    if (!editor) return

    // 钉死位置用的容器。中间件读它们，shouldShow 里负责刷新它们
    let pinnedLeft: number | null = null
    let pinnedCorner: { top: number; right: number } | null = null

    const provider = new TooltipProvider({
      content: host,
      root: document.body,
      debounce: optionsRef.current.throttle ?? 100,
      offset: 8,
      floatingUIOptions: {
        placement: optionsRef.current.placement ?? 'bottom-start',
        strategy: 'fixed',
      },
      /*
       * 钉死位置的中间件。
       *
       * 走顶层的 middleware 选项而不是 floatingUIOptions.middleware —— 后者会被
       * 整份展开、把插件默认的 [flip(), offset(), shift()] 一起顶掉；这个选项是
       * 追加在它们后面的，正好是我们要的「先按常规算，最后把坐标改掉」。
       * 位置在 shouldShow 里算好存进 pinnedLeft/pinnedCorner，中间件在 computePosition
       * 里跑，那时候拿不到 view。
       *
       * pinRect 要右对齐就得减掉浮层自己的宽度，而宽度只有这里量得到（elements.floating）——
       * 所以这一减只能写在中间件里，不能在 shouldShow 里算好。
       */
      middleware: [
        {
          name: 'fehelper-pin-position',
          fn: ({ y, elements }) => {
            if (pinnedCorner) {
              const width = elements.floating?.getBoundingClientRect().width ?? 0
              return { x: pinnedCorner.right - width, y: pinnedCorner.top }
            }
            return pinnedLeft == null ? {} : { x: pinnedLeft, y }
          },
        },
      ],
      shouldShow: (view) => {
        // 位置在定位之前算好：middleware 是在 computePosition 里跑的，拿不到 view
        pinnedLeft = optionsRef.current.pinLeft?.(view) ?? null
        pinnedCorner = optionsRef.current.pinRect?.(view) ?? null
        optionsRef.current.onEvaluate?.(view)
        // 浮条内部（如字号/颜色小面板）拿着焦点时保持显示
        if (host.contains(document.activeElement)) return true
        const held = (optionsRef.current.hideWhilePointerDown ?? true) && pointerDownRef.current
        return !held && optionsRef.current.shouldShow(view)
      },
    })

    provider.onShow = () => optionsRef.current.onVisibilityChange?.(true)
    provider.onHide = () => optionsRef.current.onVisibilityChange?.(false)

    providerRef.current = provider

    /*
     * 滚动时重算位置。
     *
     * 编辑区真正的滚动容器是 .milkdown-scroll，而浮条挂在 body 下 ——
     * 它不是浮条的祖先，floating-ui 的 autoUpdate 用 getOverflowAncestors 找不全，
     * 不补这个监听的话浮条会停在原地。scroll 不冒泡，但捕获阶段能收到。
     */
    const onScroll = () => {
      if (host.dataset.show !== 'true') return
      editor.action((ctx) => provider.update(ctx.get(editorViewCtx)))
    }
    document.addEventListener('scroll', onScroll, true)

    return () => {
      document.removeEventListener('scroll', onScroll, true)
      provider.destroy()
      providerRef.current = null
      // provider 只负责把它挂上去，摘下来是自己的事 —— 不摘的话每次卸载都会在 body 里留一个空壳
      host.remove()
    }
  }, [editor, host, providerRef])

  const renderPortal = useCallback((node: ReactNode) => createPortal(node, host), [host])

  return { renderPortal }
}

export type FloatingBarShellProps = {
  children: ReactNode
  /** 额外的容器类名，如链接输入态要放宽宽度 */
  className?: string
}

/** 浮条外壳。配色与工具栏、斜杠菜单保持一致 */
export function FloatingBarShell({ children, className = '' }: FloatingBarShellProps) {
  return (
    <div
      // 点按钮不该让编辑区失焦 —— 一失焦 ProseMirror 的选区就没了，命令会作用在错误的位置。
      // 输入框除外，它本来就要拿焦点
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest('input, textarea')) return
        event.preventDefault()
      }}
      className={`flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-white px-1 py-0.5 shadow-lg dark:border-dark-border dark:bg-dark-panel ${className}`}
    >
      {children}
    </div>
  )
}

export type FloatingBarButtonProps = {
  icon: ComponentType<{ className?: string }>
  label: string
  active?: boolean
  onClick: () => void
}

export function FloatingBarButton({ icon: Icon, label, active, onClick }: FloatingBarButtonProps) {
  return (
    // 走全站自绘的 Tooltip，而不是原生 title：原生气泡出现慢、样式不跟主题，
    // 而且浮条上全是纯图标按钮，不给说明根本看不出是干什么的
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active || undefined}
        onClick={onClick}
        className={`flex-shrink-0 rounded-md p-1 transition-colors ${
          active
            ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-dark-hover dark:hover:text-white'
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  )
}

/** 分组之间的竖分隔线 */
export function FloatingBarDivider() {
  return <span className="mx-0.5 h-3.5 w-px flex-shrink-0 bg-slate-200 dark:bg-dark-border" />
}
