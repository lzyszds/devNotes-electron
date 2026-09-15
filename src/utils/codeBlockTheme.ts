/**
 * 代码块配色设置。
 *
 * 档位就是 **shiki 的主题 id**，清单直接由 shiki 自带的那 65 套主题生成，
 * 所以所见即所得那边选什么就是什么（见 milkdownShiki.ts）。
 *
 * Cherry 侧对不上号：它只有十来套 Prism 主题（`[data-code-block-theme=…]`），
 * 跟 shiki 的 65 套没有一一对应。历史上那 8 个档位有精确映射（见 CHERRY_THEME_BY_ID），
 * 其余的按明暗取 Cherry 的通用主题 —— 也就是说选了 Dracula，所见即所得是 Dracula，
 * 双栏那边只是通用深色。这是一处有意的降级，换取这边能覆盖 shiki 的全部主题。
 */

import { bundledThemesInfo } from 'shiki/themes'
import type { BundledTheme } from 'shiki/themes'

/** 档位 id 即 shiki 主题 id */
export type CodeBlockThemeId = BundledTheme

export interface CodeBlockThemePreset {
  id: CodeBlockThemeId
  /** 显示名，直接取 shiki 的 displayName（如 One Dark Pro） */
  label: string
  /** 写到 .cherry 的 data-code-block-theme 上；取值来自 cherry-markdown.css 的 [data-code-block-theme=…] 选择器 */
  cherry: string
  /** 该主题是深色还是浅色，供设置面板标注、也用于推 Cherry 的通用主题 */
  tone: 'dark' | 'light'
}

/**
 * 有精确对应的那些档位。键是 shiki 主题 id，值是 Cherry 的 Prism 主题名。
 *
 * 这 8 个是换成 shiki 之前就在用的档位，映射关系原样保留 ——
 * 用户从旧版本升上来时配色不会变（旧的 'one-dark' 不在新清单里，会落到同色的默认档）。
 */
const CHERRY_THEME_BY_ID: Partial<Record<BundledTheme, string>> = {
  'one-dark-pro': 'one-dark',
  'one-light': 'one-light',
  'dark-plus': 'vs-dark',
  'light-plus': 'vs-light',
  monokai: 'okaidia',
  'github-dark-high-contrast': 'dark',
  'github-light-high-contrast': 'default',
  'solarized-light': 'solarized-light',
}

/** Cherry 侧没有对应主题时退到的通用档：它自己的 dark / default 两套 */
const CHERRY_FALLBACK: Record<'dark' | 'light', string> = { dark: 'dark', light: 'default' }

/** 全部 shiki 主题，按 shiki 自己的顺序 */
export const CODE_BLOCK_THEMES: CodeBlockThemePreset[] = bundledThemesInfo.map(
  ({ id, displayName, type }) => {
    // shiki 的清单里 id 只声明成 string，这里按 BundledTheme 收窄（它本来就取自这套主题）
    const themeId = id as BundledTheme
    return {
      id: themeId,
      label: displayName,
      cherry: CHERRY_THEME_BY_ID[themeId] ?? CHERRY_FALLBACK[type],
      tone: type,
    }
  }
)

export const DEFAULT_CODE_BLOCK_THEME: CodeBlockThemeId = 'one-dark-pro'

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
