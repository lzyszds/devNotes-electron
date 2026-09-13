/**
 * 翻译相关的语言清单（单一来源）。
 *
 * 原先私有限定在 JsonI18nTool 组件内部，文本翻译工具也需要同一份，故提取到 utils 共享，
 * 避免出现第 5 份并行维护的码表（另有 LANG_CODE_MAP / LLM_LANG_NAMES / LIBRE_LANG_MAP
 * 三张表服务各自引擎，语义不同，不在此合并）。
 *
 * code 必须与上述三张表的 key 保持一致。
 */

export interface LanguageOption {
  code: string;
  name: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "zh", name: "中文" },
  { code: "zh-TW", name: "繁体中文" },
  { code: "en", name: "英文" },
  { code: "ja", name: "日语" },
  { code: "ko", name: "韩语" },
  { code: "fr", name: "法语" },
  { code: "de", name: "德语" },
  { code: "es", name: "西班牙语" },
  { code: "ru", name: "俄语" },
  { code: "pt", name: "葡萄牙语" },
  { code: "it", name: "意大利语" },
  { code: "ar", name: "阿拉伯语" },
  { code: "vi", name: "越南语" },
  { code: "th", name: "泰语" },
  { code: "id", name: "印尼语" },
  { code: "ms", name: "马来语" },
  { code: "tr", name: "土耳其语" },
  { code: "pl", name: "波兰语" },
  { code: "nl", name: "荷兰语" },
  { code: "hi", name: "印地语" },
];

/** 「自动检测源语言」的哨兵值：GTX 走 sl=auto、LibreTranslate 走 source=auto、LLM 走提示词分支 */
export const AUTO_LANG = "auto";

/** 语言码 → 中文名；未知码原样返回（"auto" 由调用方显示成「自动检测」） */
export function langName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name || code;
}
