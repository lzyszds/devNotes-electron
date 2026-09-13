/**
 * 代码块配色设置。
 *
 * Cherry 与 Milkdown 的主题体系完全不同、名字也对不上号：
 *   - Cherry 用 Prism 的 11 个主题，通过 .cherry 上的 data-code-block-theme 属性切换
 *   - Milkdown 走 highlight.js：lowlight 做语法分析产出 hljs-* 类名，
 *     再由 hljs 的 CSS 主题上色，通过替换 <style id="milkdown-hljs-style"> 的内容切换
 * 所以这里定义一组「档位」，每档同时映射到两边各自真实存在的主题名，
 * 用户在设置里选的是档位，两个内核各取各的名字。
 */

export type CodeBlockThemeId =
  | 'one-dark'
  | 'one-light'
  | 'vs-dark'
  | 'vs-light'
  | 'monokai'
  | 'contrast-dark'
  | 'contrast-light'
  | 'solarized'

export interface CodeBlockThemePreset {
  id: CodeBlockThemeId
  label: string
  hint: string
  /** 写到 .cherry 的 data-code-block-theme 上；取值来自 cherry-markdown.css 的 [data-code-block-theme=…] 选择器 */
  cherry: string
  /** highlight.js 主题名，对应 highlight.js/styles/<name>.css，由编辑器按需内联注入 */
  hljs: string
  /** 该主题是深色还是浅色，供设置面板标注 */
  tone: 'dark' | 'light'
}

export const CODE_BLOCK_THEMES: CodeBlockThemePreset[] = [
  {
    id: 'one-dark',
    label: 'One Dark',
    hint: 'Atom 风深色，蓝紫调，最百搭',
    cherry: 'one-dark',
    hljs: 'atom-one-dark',
    tone: 'dark',
  },
  {
    id: 'one-light',
    label: 'One Light',
    hint: 'Atom 风浅色，白底柔和',
    cherry: 'one-light',
    hljs: 'atom-one-light',
    tone: 'light',
  },
  {
    id: 'vs-dark',
    label: 'VS Code Dark',
    hint: 'VS Code 默认深色，蓝色关键字',
    cherry: 'vs-dark',
    hljs: 'vs2015',
    tone: 'dark',
  },
  {
    id: 'vs-light',
    label: 'VS Code Light',
    hint: 'VS Code 默认浅色，白底蓝字',
    cherry: 'vs-light',
    hljs: 'vs',
    tone: 'light',
  },
  {
    id: 'monokai',
    label: 'Monokai',
    hint: '经典深色，高饱和暖调',
    cherry: 'okaidia',
    hljs: 'monokai',
    tone: 'dark',
  },
  {
    id: 'contrast-dark',
    label: '高对比深色',
    hint: '深底高对比，长时间阅读省力',
    cherry: 'dark',
    hljs: 'stackoverflow-dark',
    tone: 'dark',
  },
  {
    id: 'contrast-light',
    label: '高对比浅色',
    hint: '浅底高对比，强光环境下更清楚',
    cherry: 'default',
    hljs: 'stackoverflow-light',
    tone: 'light',
  },
  {
    id: 'solarized',
    label: 'Solarized 暖调',
    hint: '米黄纸感底色，低对比不刺眼',
    cherry: 'solarized-light',
    hljs: 'kimbie-light',
    tone: 'light',
  },
]

/** 原先是写死的 one-dark，作为默认值延续下来 */
export const DEFAULT_CODE_BLOCK_THEME: CodeBlockThemeId = 'one-dark'

/** 与同层的编辑器偏好（fehelper-editor-mode / -view / -split）保持一致，直接落 localStorage */
export const CODE_BLOCK_THEME_STORAGE_KEY = 'fehelper-code-theme'

export function getCodeBlockPreset(id: CodeBlockThemeId): CodeBlockThemePreset {
  return CODE_BLOCK_THEMES.find((item) => item.id === id) ?? CODE_BLOCK_THEMES[0]
}

function isCodeBlockThemeId(value: unknown): value is CodeBlockThemeId {
  return CODE_BLOCK_THEMES.some((item) => item.id === value)
}

// ================= 内存缓存与订阅 =================
// 骨架同 translateConfig.ts：设置面板改完要立刻作用到已经挂载的编辑器实例上，
// 而编辑器不在设置面板的 React 子树里，只能靠模块级订阅广播。

function readStoredTheme(): CodeBlockThemeId {
  try {
    const saved = localStorage.getItem(CODE_BLOCK_THEME_STORAGE_KEY)
    if (isCodeBlockThemeId(saved)) return saved
  } catch {
    // 读取失败（隐私模式等）时用默认值
  }
  return DEFAULT_CODE_BLOCK_THEME
}

/*
 * 直接在这里读，不提供异步的 load()。
 * 编辑器是在自己的 useEffect 里构造实例并取当前档位的，而 React 的 effect 自下而上执行 ——
 * 编辑器组件的 effect 会早于 App 的 effect，若把读取放在 App 里再往下传，首次挂载必然拿到默认值。
 * localStorage 本来就是同步的，模块初始化时读掉最省事。
 */
let cachedTheme: CodeBlockThemeId = readStoredTheme()

type ThemeListener = (id: CodeBlockThemeId) => void
const themeListeners = new Set<ThemeListener>()

/** 同步读取当前档位（编辑器构造时要用） */
export function getCachedCodeBlockTheme(): CodeBlockThemeId {
  return cachedTheme
}

export function subscribeCodeBlockTheme(listener: ThemeListener): () => void {
  themeListeners.add(listener)
  return () => {
    themeListeners.delete(listener)
  }
}

function publish(id: CodeBlockThemeId) {
  cachedTheme = id
  themeListeners.forEach((listener) => listener(id))
}

export function saveCodeBlockTheme(id: CodeBlockThemeId): void {
  if (!isCodeBlockThemeId(id)) return

  // 先广播再落盘：订阅者同步拿到新值，编辑器立刻变色，不必等写盘完成
  publish(id)

  try {
    localStorage.setItem(CODE_BLOCK_THEME_STORAGE_KEY, id)
  } catch {
    // ignore
  }
}
