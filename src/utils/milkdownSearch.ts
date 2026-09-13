/**
 * 所见即所得的查找替换。
 *
 * `prosemirror-search` 没有安装，Milkdown 也不提供任何现成查找能力，所以自己写。
 *
 * 位置计算直接遍历文本节点、在节点内匹配，**得到的就是文档绝对位置** ——
 * 刻意不走 posToTextOffset / textOffsetToPos 那套「文本投影 + 偏移换算」，
 * 少一层映射就少一处会整体错位的地方（那类 bug 表现为高亮框打在错的地方，极难调）。
 *
 * 代价是匹配不能跨文本节点（跨 mark 的匹配会被拆成两段）。在所见即所得里
 * 用户搜的都是可见文本，跨 mark 的长串很少见，这个取舍是划算的。
 */
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export interface SearchMatch {
  from: number
  to: number
}

export interface SearchState {
  query: string
  matches: SearchMatch[]
  /** 当前命中项下标，-1 表示没有 */
  current: number
}

export const searchPluginKey = new PluginKey<SearchState>('md-search')

/** 在文档里找出所有匹配。空查询返回空数组 */
function findMatches(doc: EditorState['doc'], query: string): SearchMatch[] {
  if (!query) return []
  const matches: SearchMatch[] = []
  const needle = query.toLowerCase()

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const haystack = node.text.toLowerCase()
    let index = haystack.indexOf(needle)
    while (index !== -1) {
      matches.push({ from: pos + index, to: pos + index + query.length })
      index = haystack.indexOf(needle, index + query.length)
    }
    return true
  })

  return matches
}

/**
 * 状态里只存 query / matches / current，装饰集在 decorations 里现算。
 * 这样文档一变（用户打字）匹配就自动跟着更新，不需要额外的同步逻辑。
 */
export const milkdownSearchPlugin = $prose(
  () =>
    new Plugin<SearchState>({
      key: searchPluginKey,
      state: {
        init: () => ({ query: '', matches: [], current: -1 }),
        apply(tr, value) {
          const meta = tr.getMeta(searchPluginKey) as Partial<SearchState> | undefined
          // 文档没动、也没有新指令时原样返回，省掉一次全文扫描
          if (!tr.docChanged && !meta) return value

          const next = meta ? { ...value, ...meta } : value
          const matches = findMatches(tr.doc, next.query)
          // 替换后命中数会变少，current 夹回合法范围
          const current = matches.length
            ? Math.min(next.current < 0 ? 0 : next.current, matches.length - 1)
            : -1
          return { ...next, matches, current }
        },
      },
      props: {
        decorations(state) {
          const value = searchPluginKey.getState(state)
          if (!value?.matches.length) return null
          const decorations = value.matches.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class:
                index === value.current ? 'md-search-hit md-search-hit--current' : 'md-search-hit',
            })
          )
          return DecorationSet.create(state.doc, decorations)
        },
      },
    })
)

export function getSearchState(view: EditorView): SearchState | null {
  return searchPluginKey.getState(view.state) ?? null
}

/** 设置查询串，并把当前项重置到第一个 */
export function setSearchQuery(view: EditorView, query: string): SearchState | null {
  view.dispatch(view.state.tr.setMeta(searchPluginKey, { query, current: 0 }))
  return getSearchState(view)
}

/** 上下移动当前命中项，越过边界时回绕 */
export function moveSearchCursor(view: EditorView, delta: 1 | -1): SearchState | null {
  const value = getSearchState(view)
  if (!value?.matches.length) return null
  const current = (value.current + delta + value.matches.length) % value.matches.length
  view.dispatch(view.state.tr.setMeta(searchPluginKey, { current }))
  return { ...value, current }
}

/** 把某个命中项选中并滚进视野 */
export function selectSearchMatch(view: EditorView, index: number): void {
  const match = getSearchState(view)?.matches[index]
  if (!match) return
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to))
  )
  scrollToPos(view, match.from)
}

/** 把文档位置滚进视野中央 */
export function scrollToPos(view: EditorView, pos: number): void {
  try {
    const dom = view.domAtPos(Math.min(pos, view.state.doc.content.size))
    const el =
      dom.node instanceof HTMLElement ? dom.node : (dom.node.parentElement as HTMLElement | null)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  } catch {
    // 位置越界时忽略：文档刚被改过，位置已失效
  }
}

/**
 * 替换当前命中项。
 *
 * 这里**不主动跳下一个** —— 替换后文档变了、matches 会在 apply 里重算，
 * current 指向的是「新的第 current 项」，语义上正好就是原位置的下一个匹配。
 */
export function replaceCurrent(view: EditorView, replacement: string): boolean {
  const value = getSearchState(view)
  const match = value?.matches[value.current]
  if (!match) return false
  view.dispatch(view.state.tr.insertText(replacement, match.from, match.to))
  return true
}

/** 替换全部。从后往前应用，避免前面的替换把后面的位置顶偏 */
export function replaceAllMatches(view: EditorView, replacement: string): number {
  const value = getSearchState(view)
  if (!value?.matches.length) return 0

  const count = value.matches.length
  let tr = view.state.tr
  for (let i = value.matches.length - 1; i >= 0; i -= 1) {
    const match = value.matches[i]
    tr = tr.insertText(replacement, match.from, match.to)
  }
  view.dispatch(tr)
  return count
}

/** 清空查询与高亮 */
export function clearSearch(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(searchPluginKey, { query: '', matches: [], current: -1 }))
}
