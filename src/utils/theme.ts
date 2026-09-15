/**
 * 全局主题管理规范与预设定义
 *
 * 包含 10 套精心设计的现代化主题（5 套浅色系 + 5 套深色系）：
 * 1. 经典浅色 (Light Default)
 * 2. 暖阳纸墨 (Warm Paper)
 * 3. 薄荷清夏 (Fresh Mint)
 * 4. 樱花绯梦 (Sakura Blossom)
 * 5. 碧海晴空 (Ocean Breeze)
 * 6. 极夜深色 (Midnight Dark)
 * 7. 东京暗夜 (Tokyo Night)
 * 8. 德古拉之夜 (Dracula)
 * 9. 幽静深苔 (Forest Pine)
 * 10. 暮色暖咖 (Sunset Twilight)
 */

export type ThemeMode = 'light' | 'dark'

export type ThemeId =
  | 'light'
  | 'paper'
  | 'mint'
  | 'sakura'
  | 'ocean'
  | 'dark'
  | 'tokyo-night'
  | 'dracula'
  | 'forest'
  | 'sunset'

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
  category: 'default' | 'paper' | 'nature' | 'sweet' | 'tech'
  categoryLabel: string
  description: string
  colors: ThemeColors
  /** 调色板预览点 (主色、面板色、底色、强调色) */
  swatches: string[]
}

export const THEMES: ThemePreset[] = [
  // ================= 浅色系 (Light Themes) =================
  {
    id: 'light',
    name: '经典浅色',
    englishName: 'Light Default',
    mode: 'light',
    category: 'default',
    categoryLabel: '经典',
    description: '极简纯白明朗底色，经典青蓝科技感点缀，简约清爽',
    colors: {
      primary: '#218397',
      primaryHover: '#50bdcf',
      bg: '#ffffff',
      panel: '#ffffff',
      sidebar: '#f8fafc',
      border: '#e2e8f0',
      hover: '#f1f5f9',
      text: '#0f172a',
      textMuted: '#64748b',
      accent: '#50bdcf',
    },
    swatches: ['#218397', '#50bdcf', '#ffffff', '#f8fafc'],
  },
  {
    id: 'paper',
    name: '暖阳纸墨',
    englishName: 'Warm Paper',
    mode: 'light',
    category: 'paper',
    categoryLabel: '护眼',
    description: '羊皮纸柔和暖白，书卷墨香与琥珀暖棕，久读不累',
    colors: {
      primary: '#b4621f',
      primaryHover: '#d48332',
      bg: '#fbf8f2',
      panel: '#ffffff',
      sidebar: '#f4eee2',
      border: '#e6dbcd',
      hover: '#eee4d6',
      text: '#2c2523',
      textMuted: '#78716c',
      accent: '#d48332',
    },
    swatches: ['#b4621f', '#d48332', '#fbf8f2', '#f4eee2'],
  },
  {
    id: 'mint',
    name: '薄荷清夏',
    englishName: 'Fresh Mint',
    mode: 'light',
    category: 'nature',
    categoryLabel: '自然',
    description: '清透浅绿微风，翡翠生机与自然绿意，舒缓身心',
    colors: {
      primary: '#0d8457',
      primaryHover: '#16a36d',
      bg: '#f1faf5',
      panel: '#ffffff',
      sidebar: '#e4f5ec',
      border: '#cce8d9',
      hover: '#d8f0e3',
      text: '#13382c',
      textMuted: '#3b7a68',
      accent: '#10b981',
    },
    swatches: ['#0d8457', '#10b981', '#f1faf5', '#e4f5ec'],
  },
  {
    id: 'sakura',
    name: '樱花绯梦',
    englishName: 'Sakura Rose',
    mode: 'light',
    category: 'sweet',
    categoryLabel: '雅致',
    description: '淡雅柔粉暖白，豆沙绯红点缀，精致温柔且富有格调',
    colors: {
      primary: '#de2152',
      primaryHover: '#f43f6e',
      bg: '#fff6f8',
      panel: '#ffffff',
      sidebar: '#fae7ec',
      border: '#f3cede',
      hover: '#f8dce5',
      text: '#381e26',
      textMuted: '#885866',
      accent: '#fb7193',
    },
    swatches: ['#de2152', '#fb7193', '#fff6f8', '#fae7ec'],
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

  // ================= 深色系 (Dark Themes) =================
  {
    id: 'dark',
    name: '极夜深色',
    englishName: 'Midnight Dark',
    mode: 'dark',
    category: 'default',
    categoryLabel: '经典',
    description: '纯正深黑科技极客风，深邃专注，夜间长时间作业首选',
    colors: {
      primary: '#218397',
      primaryHover: '#50bdcf',
      bg: '#090a0f',
      panel: '#12141a',
      sidebar: '#0e1015',
      border: '#232733',
      hover: '#1b1f2b',
      text: '#e2e8f0',
      textMuted: '#94a3b8',
      accent: '#50bdcf',
    },
    swatches: ['#50bdcf', '#218397', '#090a0f', '#12141a'],
  },
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
    id: 'dracula',
    name: '德古拉之夜',
    englishName: 'Dracula Dark',
    mode: 'dark',
    category: 'tech',
    categoryLabel: '极客',
    description: '经典高对比暗夜灰紫，品红与亮珊瑚点缀，传奇程序员配色',
    colors: {
      primary: '#ff79c6',
      primaryHover: '#bd93f9',
      bg: '#1e1f29',
      panel: '#282a36',
      sidebar: '#21222c',
      border: '#44475a',
      hover: '#383a4c',
      text: '#f8f8f2',
      textMuted: '#6272a4',
      accent: '#bd93f9',
    },
    swatches: ['#ff79c6', '#bd93f9', '#1e1f29', '#282a36'],
  },
  {
    id: 'forest',
    name: '幽静深苔',
    englishName: 'Forest Pine',
    mode: 'dark',
    category: 'nature',
    categoryLabel: '护眼',
    description: '墨绿深沉暗林底蕴，云杉松针青翠，深邃护眼而宁静',
    colors: {
      primary: '#10b981',
      primaryHover: '#34d37f',
      bg: '#0c1512',
      panel: '#13201b',
      sidebar: '#0f1a16',
      border: '#20362e',
      hover: '#1a2e26',
      text: '#e1ece6',
      textMuted: '#75998a',
      accent: '#34d37f',
    },
    swatches: ['#10b981', '#34d37f', '#0c1512', '#13201b'],
  },
  {
    id: 'sunset',
    name: '暮色暖咖',
    englishName: 'Sunset Twilight',
    mode: 'dark',
    category: 'sweet',
    categoryLabel: '温暖',
    description: '炭黑暖灰底蕴，落日熔金焦糖暖橙，温暖舒适且柔和',
    colors: {
      primary: '#f97316',
      primaryHover: '#fb923c',
      bg: '#161311',
      panel: '#1f1a17',
      sidebar: '#191513',
      border: '#362c26',
      hover: '#2a221d',
      text: '#ede5e1',
      textMuted: '#9c8980',
      accent: '#fb923c',
    },
    swatches: ['#f97316', '#fb923c', '#161311', '#1f1a17'],
  },
]

export const THEME_STORAGE_KEY = 'fehelper-theme'
export const DEFAULT_THEME: ThemeId = 'light'

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
    // 兼容历史版本如果存了 'dark' 或 'light'
    if (saved === 'dark') return 'dark'
    if (saved === 'light') return 'light'
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
 * 快捷切换：在当前模式对应的另一半模式中找对偶主题
 */
export function getOppositeTheme(currentId: ThemeId): ThemeId {
  const current = getThemePreset(currentId)
  if (current.mode === 'dark') {
    // 从深色切到浅色
    switch (currentId) {
      case 'tokyo-night':
        return 'ocean'
      case 'dracula':
        return 'sakura'
      case 'forest':
        return 'mint'
      case 'sunset':
        return 'paper'
      case 'dark':
      default:
        return 'light'
    }
  } else {
    // 从浅色切到深色
    switch (currentId) {
      case 'ocean':
        return 'tokyo-night'
      case 'sakura':
        return 'dracula'
      case 'mint':
        return 'forest'
      case 'paper':
        return 'sunset'
      case 'light':
      default:
        return 'dark'
    }
  }
}
