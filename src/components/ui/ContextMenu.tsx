import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight,
  ClipboardPaste,
  Eraser,
  Copy,
  Scissors,
  TextSelect,
  Trash2,
} from 'lucide-react'
import { copyText, readText } from '../../utils/clipboard'
import { useToast } from './Toast'

export interface ContextMenuItem {
  id: string
  /** 分隔线只需设置 separator: true，label 等字段会被忽略 */
  label?: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  onSelect?: () => void
  /** 子菜单项。有值则渲染成可展开的父项（支持任意层级嵌套） */
  children?: ContextMenuItem[]
}

interface ContextMenuAnchor {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface ContextMenuContextValue {
  openContextMenu: (event: ReactMouseEvent | MouseEvent, items: ContextMenuItem[]) => void
  closeContextMenu: () => void
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null)

/** 视口边缘留白，避免菜单贴边 */
const VIEWPORT_PADDING = 8

/**
 * 导航状态。子菜单可以嵌套，所以用「链」而不是单个 id 来表示：
 * - path[i]   第 i 层展开的是哪个父项
 * - levels[i] 第 i 层当前高亮的下标（levels.length === path.length + 1，levels[0] 是根菜单）
 */
interface NavState {
  path: string[]
  levels: number[]
}

const INITIAL_NAV: NavState = { path: [], levels: [-1] }

/** 取某一层实际渲染的菜单项 */
function itemsAtLevel(root: ContextMenuItem[], path: string[]): ContextMenuItem[] {
  let items = root
  for (const id of path) {
    const parent = items.find((item) => item.id === id)
    if (!parent?.children?.length) return []
    items = parent.children
  }
  return items
}

/** 可停留的下标（跳过分隔线与禁用项） */
function selectableIndices(items: ContextMenuItem[]): number[] {
  return items
    .map((item, index) => (item.separator || item.disabled ? -1 : index))
    .filter((index) => index >= 0)
}

/** 取 input / textarea 内当前选中的文本 */
function getSelectionWithin(el: HTMLInputElement | HTMLTextAreaElement): string {
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0
  return start === end ? '' : el.value.slice(start, end)
}

/**
 * 子菜单面板。
 *
 * 必须用 absolute 而不是 fixed：祖先 .context-menu 带 backdrop-blur，
 * backdrop-filter 会为 fixed 后代创建包含块，fixed 会因此错位。
 * 父级 .context-menu 是 fixed（已定位），宿主项 position: relative，所以
 * left: 100% 正好贴在父项右侧。
 */
function SubmenuPanel({ children }: { children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({
    visibility: 'hidden',
    left: '100%',
    top: 0,
  })

  // 先隐藏挂载量尺寸，贴右/下边缘时翻转，避免被视口裁掉
  useLayoutEffect(() => {
    const panel = panelRef.current
    const host = panel?.parentElement
    if (!panel || !host) return

    // 面板自身也在跑 context-menu-in 入场动画（scale(0.96)），getBoundingClientRect
    // 拿到的是缩放后的尺寸（偏小），据此翻转/上移会算不够、面板照样溢出视口。
    // offsetWidth / offsetHeight 是布局尺寸，不受 transform 影响。
    const subWidth = panel.offsetWidth
    const subHeight = panel.offsetHeight
    const box = host.getBoundingClientRect()
    const flip = box.right + subWidth > window.innerWidth - VIEWPORT_PADDING
    const overflowBottom = box.top + subHeight - (window.innerHeight - VIEWPORT_PADDING)
    const maxShiftUp = Math.max(0, box.top - VIEWPORT_PADDING)

    setStyle({
      visibility: 'visible',
      left: flip ? 'auto' : '100%',
      right: flip ? '100%' : 'auto',
      top: overflowBottom > 0 ? -Math.min(overflowBottom, maxShiftUp) : 0,
    })
  }, [])

  return (
    <div ref={panelRef} role="menu" className="context-menu context-menu-submenu" style={style}>
      {children}
    </div>
  )
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null)
  const [placement, setPlacement] = useState({ left: 0, top: 0, ready: false })
  const [nav, setNav] = useState<NavState>(INITIAL_NAV)
  const menuRef = useRef<HTMLDivElement>(null)

  const { showToast } = useToast()

  const closeContextMenu = useCallback(() => {
    setAnchor(null)
    setNav(INITIAL_NAV)
  }, [])

  const openContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent, items: ContextMenuItem[]) => {
      const usable = (items || []).filter(Boolean)
      if (!usable.length) return
      event.preventDefault()
      event.stopPropagation()
      setAnchor({ x: event.clientX, y: event.clientY, items: usable })
      setNav(INITIAL_NAV)
      setPlacement({ left: event.clientX, top: event.clientY, ready: false })
    },
    []
  )

  // 先以隐藏状态挂载，测量真实尺寸后再落位，贴边时向内收拢
  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return
    // 同上：必须用布局尺寸而不是 getBoundingClientRect（入场动画带 scale，量出来偏小）
    const panel = menuRef.current
    const maxLeft = window.innerWidth - panel.offsetWidth - VIEWPORT_PADDING
    const maxTop = window.innerHeight - panel.offsetHeight - VIEWPORT_PADDING
    setPlacement({
      left: Math.max(VIEWPORT_PADDING, Math.min(anchor.x, maxLeft)),
      top: Math.max(VIEWPORT_PADDING, Math.min(anchor.y, maxTop)),
      ready: true,
    })
  }, [anchor])

  // 关闭时机：外部按下、Esc、滚动、窗口尺寸变化/失焦
  useEffect(() => {
    if (!anchor) return

    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      closeContextMenu()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // 逐级关闭：先收子菜单，都收完了才关整个菜单
        setNav((prev) =>
          prev.path.length
            ? { path: prev.path.slice(0, -1), levels: prev.levels.slice(0, -1) }
            : prev
        )
        if (!nav.path.length) closeContextMenu()
        return
      }

      const items = itemsAtLevel(anchor.items, nav.path)
      const selectable = selectableIndices(items)
      if (!selectable.length) return

      const level = nav.path.length
      const current = nav.levels[level] ?? -1

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const position = selectable.indexOf(current)
        const next =
          e.key === 'ArrowDown'
            ? (position + 1) % selectable.length
            : (position - 1 + selectable.length) % selectable.length
        setNav((prev) => ({
          path: prev.path,
          levels: prev.levels.map((value, index) => (index === level ? selectable[next] : value)),
        }))
        return
      }

      const active = items[current]

      if (e.key === 'ArrowRight') {
        if (!active?.children?.length) return
        e.preventDefault()
        setNav((prev) => ({
          path: [...prev.path, active.id],
          levels: [...prev.levels, selectableIndices(active.children!)[0] ?? -1],
        }))
        return
      }

      if (e.key === 'ArrowLeft') {
        if (!nav.path.length) return
        e.preventDefault()
        setNav((prev) => ({
          path: prev.path.slice(0, -1),
          levels: prev.levels.slice(0, -1),
        }))
        return
      }

      if (e.key === 'Enter') {
        if (!active || active.disabled || active.separator) return
        e.preventDefault()
        if (active.children?.length) {
          setNav((prev) => ({
            path: [...prev.path, active.id],
            levels: [...prev.levels, selectableIndices(active.children!)[0] ?? -1],
          }))
        } else {
          closeContextMenu()
          active.onSelect?.()
        }
      }
    }

    const onDismiss = () => closeContextMenu()

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('blur', onDismiss)
    }
  }, [anchor, nav, closeContextMenu])

  /**
   * 输入框 / 多行文本框的右键菜单。
   *
   * 挂在 document 捕获阶段而不是逐个组件上：全应用的输入框都要覆盖，逐个挂必漏。
   * 只拦 INPUT / TEXTAREA，其余目标直接返回且不 stopPropagation，
   * 所以组件自己挂在祖先上的菜单照常工作。
   *
   * 选区与文本都在菜单打开的那一刻快照 —— 点击菜单按钮会让输入框失焦。
   */
  useEffect(() => {
    const onInputContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const el =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
          ? target
          : null
      if (!el) return
      // 复选框 / 文件 / 按钮这类 input 没有可编辑内容
      if (
        el instanceof HTMLInputElement &&
        [
          'checkbox',
          'radio',
          'file',
          'range',
          'color',
          'button',
          'submit',
          'reset',
          'image',
        ].includes(el.type)
      ) {
        return
      }

      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      const selected = getSelectionWithin(el)
      const value = el.value
      const canEdit = !el.disabled && !el.readOnly

      const copyWithToast = async (text: string, label: string) => {
        const ok = await copyText(text)
        showToast(ok ? label : '复制失败', ok ? 'default' : 'error')
      }

      /** 替换 [start, end) 区间。走 execCommand 以保留原生撤销栈 */
      const replaceRange = (text: string) => {
        el.focus()
        try {
          el.setSelectionRange(start, end)
        } catch {
          // 个别 type 不支持 setSelectionRange，忽略
        }
        if (document.execCommand('insertText', false, text)) return

        // 兜底：用原型上的 setter 改 value，再派发 input，让受控组件同步
        const proto =
          el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        setter?.call(el, value.slice(0, start) + text + value.slice(end))
        el.dispatchEvent(new Event('input', { bubbles: true }))
        const caret = start + text.length
        el.setSelectionRange(caret, caret)
      }

      const items: ContextMenuItem[] = [
        {
          id: 'input-cut',
          label: '剪切',
          shortcut: '⌘X',
          icon: <Scissors className="w-3.5 h-3.5" />,
          disabled: !canEdit || !selected,
          onSelect: async () => {
            if (!(await copyText(selected))) {
              showToast('剪切失败', 'error')
              return
            }
            replaceRange('')
            showToast('已剪切')
          },
        },
        {
          id: 'input-copy',
          label: '复制',
          shortcut: '⌘C',
          icon: <Copy className="w-3.5 h-3.5" />,
          disabled: !selected,
          onSelect: () => void copyWithToast(selected, '已复制选中内容'),
        },
        {
          id: 'input-paste',
          label: '粘贴',
          shortcut: '⌘V',
          icon: <ClipboardPaste className="w-3.5 h-3.5" />,
          disabled: !canEdit,
          onSelect: async () => {
            const text = await readText()
            if (!text) {
              showToast('剪贴板为空', 'error')
              return
            }
            replaceRange(text)
          },
        },
        { id: 'input-sep-1', separator: true },
        {
          id: 'input-select-all',
          label: '全选',
          shortcut: '⌘A',
          icon: <TextSelect className="w-3.5 h-3.5" />,
          disabled: !value,
          onSelect: () => {
            el.focus()
            el.select()
          },
        },
        {
          id: 'input-delete',
          label: '删除选中',
          icon: <Eraser className="w-3.5 h-3.5" />,
          disabled: !canEdit || !selected,
          onSelect: () => replaceRange(''),
        },
        { id: 'input-sep-2', separator: true },
        {
          id: 'input-clear',
          label: '清空',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          disabled: !canEdit || !value,
          onSelect: () => {
            el.focus()
            el.select()
            if (!document.execCommand('insertText', false, '')) {
              const proto =
                el instanceof HTMLTextAreaElement
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype
              Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, '')
              el.dispatchEvent(new Event('input', { bubbles: true }))
            }
            showToast('已清空')
          },
        },
      ]

      openContextMenu(event, items)
    }

    document.addEventListener('contextmenu', onInputContextMenu, true)
    return () => document.removeEventListener('contextmenu', onInputContextMenu, true)
  }, [openContextMenu, showToast])

  /** 悬停/点击时把某一层的高亮切到 index，并收起更深层 */
  const activateLevel = useCallback((level: number, index: number) => {
    setNav((prev) => ({
      path: prev.path.slice(0, level),
      levels: [...prev.levels.slice(0, level), index],
    }))
  }, [])

  const renderItems = (items: ContextMenuItem[], level: number): ReactNode =>
    items.map((item, index) => {
      if (item.separator) {
        return <div key={item.id} role="separator" className="context-menu-separator" />
      }

      const hasChildren = Boolean(item.children?.length)
      const expanded = hasChildren && nav.path[level] === item.id

      return (
        <div key={item.id} className="context-menu-submenu-host">
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            data-danger={item.danger ? 'true' : 'false'}
            data-active={nav.levels[level] === index ? 'true' : 'false'}
            onMouseEnter={() => activateLevel(level, index)}
            onClick={() => {
              if (hasChildren) {
                setNav((prev) => {
                  const alreadyOpen = prev.path[level] === item.id
                  if (alreadyOpen) {
                    return { path: prev.path.slice(0, level), levels: prev.levels.slice(0, level + 1) }
                  }
                  return {
                    path: [...prev.path.slice(0, level), item.id],
                    levels: [
                      ...prev.levels.slice(0, level + 1),
                      selectableIndices(item.children!)[0] ?? -1,
                    ],
                  }
                })
                return
              }
              closeContextMenu()
              item.onSelect?.()
            }}
            className="context-menu-item"
          >
            <span className="context-menu-icon">{item.icon}</span>
            <span className="context-menu-label">{item.label}</span>
            {hasChildren ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              item.shortcut && <kbd className="context-menu-shortcut">{item.shortcut}</kbd>
            )}
          </button>

          {expanded && (
            <SubmenuPanel>{renderItems(item.children!, level + 1)}</SubmenuPanel>
          )}
        </div>
      )
    })

  return (
    <ContextMenuContext.Provider value={{ openContextMenu, closeContextMenu }}>
      {children}
      {anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-orientation="vertical"
            className="context-menu no-drag"
            style={{
              left: placement.left,
              top: placement.top,
              visibility: placement.ready ? 'visible' : 'hidden',
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {renderItems(anchor.items, 0)}
          </div>,
          document.body
        )}
    </ContextMenuContext.Provider>
  )
}

export function useContextMenu() {
  const context = useContext(ContextMenuContext)
  if (!context) {
    throw new Error('useContextMenu must be used within a ContextMenuProvider')
  }
  return context
}
