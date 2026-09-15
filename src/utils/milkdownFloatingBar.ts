import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * 浮出工具条的驱动接口。`TooltipProvider` 在结构上天然满足这个形状
 * （它的 `update` 签名是 `(view, prevState?) => void`），这里只取需要的那一个方法，
 * 免得工具函数反过来依赖 UI 层的类。
 */
export type FloatingBarDriver = {
  update: (view: EditorView, prevState?: EditorState) => void
}

/**
 * 「每次视图更新都去问一次浮条要不要显示」的插件。
 *
 * 为什么非要有这个插件：`@milkdown/plugin-tooltip` 不会自己驱动 `TooltipProvider`。
 * 它的 `tooltipFactory()` 只是往容器里塞了一对空的 `$ctx` + `$prose`，
 * 谁来调 `provider.update()` 得消费方自己接。而 `update()` 必须**每一次** ProseMirror
 * 视图更新都被调到，否则浮层永远不出现 —— 左侧块手柄当初完全不工作，就是漏了这一步。
 *
 * 这里没有沿用官方那套「先 ctx.set(spec) 再让插件 ctx.get(spec)」的写法：
 * 那样必须赶在 `editor.create()` 之前把 spec 塞进 ctx，而 provider 需要 React 渲染出来的
 * 宿主元素，两者时序天然打架。改成让 `$prose` 的工厂函数直接闭包捕获 ref，
 * provider 建好之前 `getDriver()` 返回 null、空转即可，时序问题自然消失。
 *
 * 注意 `floatingBar()` 必须在编辑器构造的 effect 里调用（闭包捕获的是那一次渲染的 ref）。
 */
export function floatingBar(id: string, getDriver: () => FloatingBarDriver | null) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey(`fehelper-${id}-floating-bar`),
        view: () => ({
          update: (view, prevState) => {
            getDriver()?.update(view, prevState)
          },
        }),
      })
  )
}
