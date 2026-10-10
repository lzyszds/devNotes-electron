/*
 * 翻译页的选项偏好：引擎、实时翻译、合并断行、识别语言。
 *
 * 这些原来是组件的 useState，每次挂载都回到写死的初值 —— 用户选了
 * OpenAI，切走再回来又变回 LibreTranslate。存在 electron-store 里
 * （跟其它设置一致，也顺带能被云同步带走）。
 *
 * 语言选择（源/目标/我的语言）不在这里，它们在 TranslateContext 里
 * 有自己的读写路径。
 */

import type { TranslationAPI } from './jsonI18nTranslate'
import type { OcrLanguage } from './ocr'

export const TRANSLATE_PREFS_KEY = 'text-translate-prefs'

export interface TranslatePrefs {
  /** 翻译引擎 */
  api: TranslationAPI
  /** 输入停顿即翻译 */
  autoTranslate: boolean
  /** 合并 PDF/代码复制来的硬换行 */
  unwrapLines: boolean
  /** OCR 识别语言 */
  ocrLang: OcrLanguage
}

export const DEFAULT_TRANSLATE_PREFS: TranslatePrefs = {
  api: 'libretranslate',
  autoTranslate: true,
  unwrapLines: false,
  ocrLang: 'chi_sim+eng',
}

/** 逐项校验，存储里混进脏值时回退默认，不让它污染整个配置 */
export function mergeTranslatePrefs(partial?: Partial<TranslatePrefs> | null): TranslatePrefs {
  if (!partial || typeof partial !== 'object') return { ...DEFAULT_TRANSLATE_PREFS }
  const api = partial.api
  const ocrLang = partial.ocrLang
  return {
    api:
      api === 'openai' || api === 'libretranslate' || api === 'gtx' || api === 'mymemory'
        ? api
        : DEFAULT_TRANSLATE_PREFS.api,
    autoTranslate:
      typeof partial.autoTranslate === 'boolean'
        ? partial.autoTranslate
        : DEFAULT_TRANSLATE_PREFS.autoTranslate,
    unwrapLines:
      typeof partial.unwrapLines === 'boolean'
        ? partial.unwrapLines
        : DEFAULT_TRANSLATE_PREFS.unwrapLines,
    ocrLang:
      ocrLang === 'chi_sim+eng' || ocrLang === 'eng' || ocrLang === 'chi_sim'
        ? ocrLang
        : DEFAULT_TRANSLATE_PREFS.ocrLang,
  }
}

export async function loadTranslatePrefs(): Promise<TranslatePrefs> {
  try {
    const saved = await window.electronAPI?.storeGet?.(TRANSLATE_PREFS_KEY)
    return mergeTranslatePrefs(saved as Partial<TranslatePrefs> | undefined)
  } catch {
    return { ...DEFAULT_TRANSLATE_PREFS }
  }
}

export async function saveTranslatePrefs(prefs: TranslatePrefs): Promise<void> {
  try {
    await window.electronAPI?.storeSet?.(TRANSLATE_PREFS_KEY, prefs)
  } catch {
    // 存不进去不影响本次会话使用，忽略
  }
}
