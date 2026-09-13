/**
 * Milkdown 的代码块配色。
 *
 * 与 Cherry 侧靠 `data-code-block-theme` 属性切换不同,Milkdown 走 highlight.js:
 * lowlight 做语法分析产出 hljs-* 类名,再由一份 hljs 主题 CSS 上色。
 * 主题 CSS 在 node_modules 里,运行时拿不到(打包后是 asar),所以用 Vite 的
 * `?inline` 在构建期把 8 个档位对应的 CSS 各读成字符串,按需写进同一个 <style>。
 *
 * 放在单独文件而不是 codeBlockTheme.ts 里:那个模块被设置面板引用,
 * 把这 8 份 CSS 挂上去会让设置面板的 chunk 白白变大一截。
 */

import { getCodeBlockPreset } from './codeBlockTheme'
import type { CodeBlockThemeId } from './codeBlockTheme'

import atomOneDark from 'highlight.js/styles/atom-one-dark.css?inline'
import atomOneLight from 'highlight.js/styles/atom-one-light.css?inline'
import monokai from 'highlight.js/styles/monokai.css?inline'
import stackoverflowDark from 'highlight.js/styles/stackoverflow-dark.css?inline'
import stackoverflowLight from 'highlight.js/styles/stackoverflow-light.css?inline'
import kimbieLight from 'highlight.js/styles/kimbie-light.css?inline'
import vs from 'highlight.js/styles/vs.css?inline'
import vs2015 from 'highlight.js/styles/vs2015.css?inline'

/** 主题名取自 highlight.js/styles 下的文件名,与 codeBlockTheme.ts 的 hljs 字段一一对应 */
const THEME_CSS: Record<string, string> = {
  'atom-one-dark': atomOneDark,
  'atom-one-light': atomOneLight,
  monokai,
  'stackoverflow-dark': stackoverflowDark,
  'stackoverflow-light': stackoverflowLight,
  'kimbie-light': kimbieLight,
  vs,
  vs2015,
}

const STYLE_ID = 'milkdown-hljs-style'

/**
 * 把当前档位对应的主题 CSS 写进页面里的 <style>。
 *
 * 复用同一个标签而不是每次新建:标签顺序不变,就不会出现新旧样式互相压制、
 * 切换瞬间闪一下的情况。全局只有 Milkdown 会产出 .hljs 元素,所以放 head 里是安全的。
 */
export function applyMilkdownCodeTheme(id: CodeBlockThemeId): void {
  const { hljs } = getCodeBlockPreset(id)
  const css = THEME_CSS[hljs] ?? THEME_CSS['atom-one-dark']

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
}
