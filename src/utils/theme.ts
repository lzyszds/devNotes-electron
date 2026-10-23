/**
 * 全局主题管理规范与精选预设定义
 *
 * 专注核心视觉质感，精简保留 4 套高辨识度特色主题：
 * 深色系：
 * 1. 东京暗夜 (Tokyo Night) - 霓虹夜蓝紫极客风格
 * 2. 暗夜流光 (One Dark Pro) - Atom 经典深空蓝灰高级工程师风
 *
 * 浅色系：
 * 3. 北欧初雪 (Nordic Snow) - 冰川冷灰与极简初雪纯白
 * 4. 碧海晴空 (Ocean Breeze) - 海盐天蓝明透开朗风格
 */

export type ThemeMode = 'light' | 'dark'

export type ThemeId =
  | 'tokyo-night'
  | 'one-dark'
  | 'nordic-snow'
  | 'ocean'

export interface ThemeColors {
  /** 主品牌高亮色 (对应 brand-600) */
  primary: string
  /** 主品牌辅色 (对应 brand-500) */
  primaryHover: string
  /** 界面主背景色 */
  bg: string
  /** 面板/卡片背景色 */
  panel: string
  /** 侧边栏背景色 */
  sidebar: string
  /** 边框分割线颜色 */
  border: string
  /** 悬浮高亮色 */
  hover: string
  /** 主要正文字色 */
  text: string
  /** 次级说明字色 */
  textMuted: string
  /** 装饰辅色 (用于微缩视窗或高光点缀) */
  accent: string
}

export interface ThemePreset {
  id: ThemeId
  name: string
  englishName: string
  mode: ThemeMode
  category: 'default' | 'nature' | 'tech'
  categoryLabel: string
  description: string
  colors: ThemeColors
  /** 调色板预览点 (主色、面板色、底色、强调色) */
  swatches: string[]
}

export const THEMES: ThemePreset[] = [
  // ================= 深色系 (Dark Themes) =================
  {
    id: 'tokyo-night',
    name: '东京暗夜',
    englishName: 'Tokyo Night',
    mode: 'dark',
    category: 'tech',
    categoryLabel: '极客',
    description: '风靡全球的潮流霓虹蓝紫夜色，沉浸式数码极客质感',
    colors: {
      primary: '#7aa2f7',
      primaryHover: '#bb9af7',
      bg: '#16161e',
      panel: '#1a1b26',
      sidebar: '#13141c',
      border: '#292e42',
      hover: '#23283b',
      text: '#c0caf5',
      textMuted: '#787c99',
      accent: '#bb9af7',
    },
    swatches: ['#7aa2f7', '#bb9af7', '#16161e', '#1a1b26'],
  },
  {
    id: 'one-dark',
    name: '暗夜流光',
    englishName: 'One Dark Pro',
    mode: 'dark',
    category: 'tech',
    categoryLabel: '雅致',
    description: 'Atom 经典深空蓝灰底色，天青冷蓝主调，久看不累的高级工程师风',
    colors: {
      primary: '#61afef',
      primaryHover: '#74b9f3',
      bg: '#21252b',
      panel: '#282c34',
      sidebar: '#1b1d23',
      border: '#353b45',
      hover: '#2f343e',
      text: '#abb2bf',
      textMuted: '#7f848e',
      accent: '#98c379',
    },
    swatches: ['#61afef', '#98c379', '#21252b', '#282c34'],
  },

  // ================= 浅色系 (Light Themes) =================
  {
    id: 'nordic-snow',
    name: '北欧初雪',
    englishName: 'Nordic Snow',
    mode: 'light',
    category: 'default',
    categoryLabel: '极简',
    description: '冰川冷灰与纯粹初雪银白，低饱和度理性格调，纯净耐看',
    colors: {
      primary: '#475569',
      primaryHover: '#64748b',
      bg: '#f8fafc',
      panel: '#ffffff',
      sidebar: '#edf2f7',
      border: '#cbd5e1',
      hover: '#e2e8f0',
      text: '#0f172a',
      textMuted: '#475569',
      accent: '#94a3b8',
    },
    swatches: ['#475569', '#94a3b8', '#f8fafc', '#edf2f7'],
  },
  {
    id: 'ocean',
    name: '碧海晴空',
    englishName: 'Ocean Breeze',
    mode: 'light',
    category: 'nature',
    categoryLabel: '清爽',
    description: '海天一色浅蓝明透，蔚蓝海风清新开阔，开朗专注',
    colors: {
      primary: '#0170c5',
      primaryHover: '#0c8ee9',
      bg: '#f1f7fd',
      panel: '#ffffff',
      sidebar: '#e3f0fc',
      border: '#cce2f7',
      hover: '#d8eafb',
      text: '#102a43',
      textMuted: '#486581',
      accent: '#36a6f4',
    },
    swatches: ['#0170c5', '#36a6f4', '#f1f7fd', '#e3f0fc'],
  },
]

export const THEME_STORAGE_KEY = 'fehelper-theme'
export const DEFAULT_THEME: ThemeId = 'tokyo-night'

/**
 * 校验字符串是否为合法的主题 ID
 */
export function isThemeId(val: unknown): val is ThemeId {
  return typeof val === 'string' && THEMES.some((t) => t.id === val)
}

/**
 * 读取本地缓存的主题 ID，容错降级回退
 */
export function getCachedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeId(saved)) return saved
    // 兼容历史版本已移除主题的平滑迁移
    if (['light', 'paper', 'mint', 'sakura', 'lavender', 'matcha', 'honey-amber', 'rose-clay'].includes(saved as string)) {
      return 'nordic-snow'
    }
    if (['dark', 'dracula', 'forest', 'sunset', 'cyberpunk', 'nord-dark', 'monokai-pro', 'solarized-dark'].includes(saved as string)) {
      return 'tokyo-night'
    }
  } catch {
    // ignore
  }
  return DEFAULT_THEME
}

/**
 * 保存主题偏好到 localStorage
 */
export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id)
  } catch {
    // ignore
  }
}

/**
 * 获取指定主题预设对象
 */
export function getThemePreset(id: ThemeId): ThemePreset {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/**
 * 判断指定主题属于浅色还是深色模式
 */
export function isDarkTheme(id: ThemeId): boolean {
  return getThemePreset(id).mode === 'dark'
}

/**
 * 快捷切换：在深浅对偶主题之间精准切换
 * - 东京暗夜 (tokyo-night) ↔ 碧海晴空 (ocean)
 * - 暗夜流光 (one-dark) ↔ 北欧初雪 (nordic-snow)
 */
export function getOppositeTheme(currentId: ThemeId): ThemeId {
  const current = getThemePreset(currentId)
  if (current.mode === 'dark') {
    return currentId === 'tokyo-night' ? 'ocean' : 'nordic-snow'
  } else {
    return currentId === 'ocean' ? 'tokyo-night' : 'one-dark'
  }
}
