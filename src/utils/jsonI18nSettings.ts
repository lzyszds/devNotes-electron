export type AutoExpandMode = "none" | "each" | "first" | "allWhenDone";

export interface JsonI18nSettings {
  /** 翻译完成后如何展开结果 */
  autoExpand: AutoExpandMode;
  /** 手风琴互斥：同时只展开一种语言 */
  exclusiveExpand: boolean;
  /** 全部完成后自动下载 JSON */
  autoDownload: boolean;
  /** 完成后桌面通知 */
  notifyOnComplete: boolean;
  /** 完成后自动保存历史 */
  autoSaveHistory: boolean;
  /** 完成后滚动到结果区域 */
  scrollToResults: boolean;
}

export const SETTINGS_STORAGE_KEY = "json-i18n-settings";

export const DEFAULT_SETTINGS: JsonI18nSettings = {
  autoExpand: "each",
  exclusiveExpand: false,
  autoDownload: false,
  notifyOnComplete: true,
  autoSaveHistory: true,
  scrollToResults: true,
};

export function mergeSettings(partial?: Partial<JsonI18nSettings>): JsonI18nSettings {
  return { ...DEFAULT_SETTINGS, ...partial };
}

export const AUTO_EXPAND_OPTIONS: {
  value: AutoExpandMode;
  label: string;
  desc: string;
}[] = [
  { value: "none", label: "不展开", desc: "保持折叠，手动点击查看" },
  { value: "each", label: "逐语言展开", desc: "每种语言译完立即展开" },
  { value: "first", label: "仅首个", desc: "全部完成后只展开第一种语言" },
  { value: "allWhenDone", label: "全部展开", desc: "全部完成后展开所有语言" },
];
