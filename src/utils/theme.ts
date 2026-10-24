/**
 * 全局唯一定义：OpenNotas / Notion 极简暖灰阶桌面工作台风格
 *
 * 彻底移除多主题与暗黑霓虹感，采用且仅保留唯一的“暖灰阶 + 炭黑高亮”工作台风格：
 * 一级/二级导航栏：#F3F3F1
 * 中间列表栏：#F9F9F8
 * 主画布/内容区：#FFFFFF
 * 边框分割线：1px solid #E6E6E3
 * 文字颜色：主文字 #191918，次要文字 #787774
 * 主操作/选中态：深炭黑 #1C1C1C + 纯白文字 #FFFFFF
 */

export type ThemeId = 'notion-warm'

export interface ThemeColors {
  primary: string
  primaryHover: string
  bg: string
  panel: string
  sidebar: string
  border: string
  hover: string
  text: string
  textMuted: string
  accent: string
}

export const NOTION_WARM_COLORS: ThemeColors = {
  primary: '#1C1C1C',
  primaryHover: '#2E2E2E',
  bg: '#FFFFFF',
  panel: '#FFFFFF',
  sidebar: '#F3F3F1',
  border: '#E6E6E3',
  hover: '#EAEAE7',
  text: '#191918',
  textMuted: '#787774',
  accent: '#1C1C1C',
}

export const DEFAULT_THEME: ThemeId = 'notion-warm'
