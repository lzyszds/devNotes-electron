import {
  translateFetch,
  isGtxReachable,
  parseGtxSingleResponse,
  buildGtxSingleUrl,
} from "./translateFetch";
import { runPool } from "./concurrencyPool";
import { translateWithProtection } from "./termProtection";
import {
  isProvider,
  isProviderConfigured,
  providerLabel,
  type TranslateApiConfig,
  type TranslateProvider,
} from "./translateConfig";
import { translateWithLibreTranslate, translateWithOpenAI } from "./translateProviders";

export type TranslationAPI = "gtx" | "mymemory" | "openai" | "libretranslate";

export const LANG_CODE_MAP: Record<string, string> = {
  zh: "zh-CN",
  "zh-TW": "zh-TW",
  en: "en",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
  es: "es",
  ru: "ru",
  pt: "pt",
  it: "it",
  ar: "ar",
  vi: "vi",
  th: "th",
  id: "id",
  ms: "ms",
  tr: "tr",
  pl: "pl",
  nl: "nl",
  hi: "hi",
};

const GTX_SINGLE_URLS = [
  "https://translate.googleapis.com/translate_a/single",
  "https://translate.google.com/translate_a/single",
];

export const DEFAULT_TEXT_CONCURRENCY = 12;
export const DEFAULT_LANG_CONCURRENCY = 3;

let gtxReachableCache: boolean | null = null;

export async function checkGtxReachable(force = false): Promise<boolean> {
  if (!force && gtxReachableCache !== null) return gtxReachableCache;
  gtxReachableCache = await isGtxReachable();
  return gtxReachableCache;
}

export function resetGtxReachableCache() {
  gtxReachableCache = null;
}

async function translateOneGtx(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  if (!text.trim()) return text;

  const sl = LANG_CODE_MAP[sourceLang] || sourceLang;
  const tl = LANG_CODE_MAP[targetLang] || targetLang;

  for (const url of GTX_SINGLE_URLS) {
    for (const useDj of [false, true]) {
      try {
        const fullUrl = buildGtxSingleUrl(url, sl, tl, text, useDj);
        const result = await translateFetch(fullUrl, { timeout: 15000 });

        if (result.status === 0 || result.error || !result.ok || !result.text) {
          continue;
        }

        const translated = parseGtxSingleResponse(result.text);
        if (translated) return translated;
      } catch {
        // try next
      }
    }
  }

  return text;
}

async function translateOneMyMemory(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  if (!text.trim()) return text;

  const sl = LANG_CODE_MAP[sourceLang] || sourceLang;
  const tl = LANG_CODE_MAP[targetLang] || targetLang;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${tl}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return text;
    const data = await response.json();
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      return data.responseData.translatedText;
    }
  } catch {
    // fallback to original
  }
  return text;
}

export interface TranslateBatchOptions {
  texts: string[];
  sourceLang: string;
  targetLang: string;
  api: TranslationAPI;
  /** 自定义接口（openai / libretranslate）所需配置 */
  providerConfig?: TranslateApiConfig;
  textConcurrency?: number;
  protectedTerms?: string[];
  onProgress?: (done: number, total: number) => void;
}

export interface TranslateBatchResult {
  results: string[];
  apiUsed: string;
  /** 是否全部条目都翻译成功 */
  ok: boolean;
  error?: string;
}

export async function translateTextBatch(
  options: TranslateBatchOptions
): Promise<TranslateBatchResult> {
  const {
    texts,
    sourceLang,
    targetLang,
    api,
    providerConfig,
    textConcurrency = DEFAULT_TEXT_CONCURRENCY,
    protectedTerms = [],
    onProgress,
  } = options;

  // 自定义接口走独立路径：失败即报错，绝不改道 MyMemory
  if (isProvider(api)) {
    return translateBatchWithProvider(
      texts,
      sourceLang,
      targetLang,
      api,
      providerConfig,
      textConcurrency,
      protectedTerms,
      onProgress
    );
  }

  const translateOne = (text: string) =>
    translateWithProtection(text, protectedTerms, (t) =>
      translateOneGtx(t, sourceLang, targetLang)
    );

  const translateOneMyMemoryProtected = (text: string) =>
    translateWithProtection(text, protectedTerms, (t) =>
      translateOneMyMemory(t, sourceLang, targetLang)
    );

  if (api === "gtx") {
    const gtxOk = await checkGtxReachable();
    if (gtxOk) {
      try {
        const results = await runPool(
          texts,
          translateOne,
          textConcurrency,
          onProgress
        );
        const hasAny = results.some((r, i) => r && r.trim() && r !== texts[i]);
        if (hasAny) {
          return { results, apiUsed: "GTX Single (并发)", ok: true };
        }
      } catch (e) {
        console.warn("[翻译] GTX 并发失败:", (e as Error).message);
      }
    }
  }

  // MyMemory 限速，降低并发
  const results = await runPool(
    texts,
    translateOneMyMemoryProtected,
    Math.min(3, textConcurrency),
    onProgress
  );
  const hasAny = results.some((r, i) => r && r.trim() && r !== texts[i]);
  if (hasAny) {
    return { results, apiUsed: "MyMemory (并发)", ok: true };
  }

  return {
    results: texts.map((t) => t),
    apiUsed: "失败（原文保留）",
    ok: false,
    error: "GTX 与 MyMemory 均不可用",
  };
}

async function translateBatchWithProvider(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  provider: TranslateProvider,
  config: TranslateApiConfig | undefined,
  textConcurrency: number,
  protectedTerms: string[],
  onProgress?: (done: number, total: number) => void
): Promise<TranslateBatchResult> {
  const label = providerLabel(provider);

  if (!config || config.provider !== provider || !isProviderConfigured(config)) {
    return {
      results: texts.map((t) => t),
      apiUsed: "未配置",
      ok: false,
      error: `尚未配置「${label}」接口，请先在顶栏「翻译接口」设置中填写。`,
    };
  }

  const errors: string[] = [];
  let failed = 0;

  const translateOne = (text: string) =>
    translateWithProtection(text, protectedTerms, async (t) => {
      const outcome =
        provider === "openai"
          ? await translateWithOpenAI(t, sourceLang, targetLang, config.openai)
          : await translateWithLibreTranslate(
              t,
              sourceLang,
              targetLang,
              config.libretranslate
            );

      if (!outcome.ok || !outcome.text) {
        failed++;
        const reason = outcome.error || "翻译失败";
        if (!errors.includes(reason)) errors.push(reason);
        return t;
      }
      return outcome.text;
    });

  // 第三方实例与 LLM 普遍限流，压低并发
  const results = await runPool(
    texts,
    translateOne,
    Math.min(4, textConcurrency),
    onProgress
  );

  if (failed === 0) {
    return { results, apiUsed: `${label} (${texts.length})`, ok: true };
  }

  const succeeded = texts.length - failed;
  return {
    results,
    apiUsed: `${label} (${succeeded}/${texts.length})`,
    ok: false,
    error:
      succeeded > 0
        ? `部分条目翻译失败（${succeeded}/${texts.length} 成功）：${errors[0]}`
        : errors[0] || "全部条目翻译失败",
  };
}

export interface JsonNode {
  path: string;
  key: string;
  value: string;
}

export function extractStrings(
  obj: unknown,
  currentPath = "",
  results: JsonNode[] = []
): JsonNode[] {
  if (obj === null || obj === undefined) return results;

  if (typeof obj === "string") {
    results.push({
      path: currentPath,
      key: currentPath.split(".").pop() || currentPath,
      value: obj,
    });
  } else if (typeof obj === "object") {
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        extractStrings(item, `${currentPath}[${index}]`, results);
      });
    } else {
      Object.keys(obj).forEach((key) => {
        const newPath = currentPath ? `${currentPath}.${key}` : key;
        extractStrings((obj as Record<string, unknown>)[key], newPath, results);
      });
    }
  }

  return results;
}

export function applyTranslations(
  obj: unknown,
  translations: Map<string, string>,
  currentPath = ""
): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    const translated = translations.get(currentPath);
    return translated !== undefined ? translated : obj;
  }

  if (typeof obj === "object") {
    if (Array.isArray(obj)) {
      return obj.map((item, index) =>
        applyTranslations(item, translations, `${currentPath}[${index}]`)
      );
    }
    const result: Record<string, unknown> = {};
    Object.keys(obj).forEach((key) => {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      result[key] = applyTranslations(
        (obj as Record<string, unknown>)[key],
        translations,
        newPath
      );
    });
    return result;
  }

  return obj;
}

export interface LangTranslateResult {
  lang: string;
  data: unknown;
  apiUsed: string;
  translatedCount: number;
  totalCount: number;
  status: "done" | "error";
  error?: string;
}

export interface MultiLangTranslateOptions {
  parsed: unknown;
  stringsToTranslate: JsonNode[];
  sourceLang: string;
  targetLangs: string[];
  api: TranslationAPI;
  /** 自定义接口（openai / libretranslate）所需配置 */
  providerConfig?: TranslateApiConfig;
  textConcurrency?: number;
  langConcurrency?: number;
  protectedTerms?: string[];
  onLangStart?: (lang: string) => void;
  onLangProgress?: (lang: string, done: number, total: number) => void;
  onLangComplete?: (result: LangTranslateResult) => void;
  onOverallProgress?: (done: number, total: number) => void;
}

export async function translateMultiLang(
  options: MultiLangTranslateOptions
): Promise<LangTranslateResult[]> {
  const {
    parsed,
    stringsToTranslate,
    sourceLang,
    targetLangs,
    api,
    providerConfig,
    textConcurrency = DEFAULT_TEXT_CONCURRENCY,
    langConcurrency = DEFAULT_LANG_CONCURRENCY,
    protectedTerms = [],
    onLangStart,
    onLangProgress,
    onLangComplete,
    onOverallProgress,
  } = options;

  const texts = stringsToTranslate.map((s) => s.value);
  const totalWork = stringsToTranslate.length * targetLangs.length;
  let overallDone = 0;

  const translateOneLang = async (targetLang: string): Promise<LangTranslateResult> => {
    onLangStart?.(targetLang);

    try {
      const { results, apiUsed, ok, error } = await translateTextBatch({
        texts,
        sourceLang,
        targetLang,
        api,
        providerConfig,
        textConcurrency,
        protectedTerms,
        onProgress: (done, total) => {
          onLangProgress?.(targetLang, done, total);
        },
      });

      const translations = new Map<string, string>();
      let translatedCount = 0;

      stringsToTranslate.forEach((item, index) => {
        const translated = results[index];
        if (translated && translated !== item.value) {
          translations.set(item.path, translated);
          translatedCount++;
        } else {
          translations.set(item.path, item.value);
        }
      });

      overallDone += stringsToTranslate.length;
      onOverallProgress?.(overallDone, totalWork);

      const result: LangTranslateResult = {
        lang: targetLang,
        data: applyTranslations(parsed, translations),
        apiUsed,
        translatedCount,
        totalCount: stringsToTranslate.length,
        status: ok ? "done" : "error",
        error: ok ? undefined : error,
      };
      onLangComplete?.(result);
      return result;
    } catch (err) {
      overallDone += stringsToTranslate.length;
      onOverallProgress?.(overallDone, totalWork);

      const result: LangTranslateResult = {
        lang: targetLang,
        data: parsed,
        apiUsed: "",
        translatedCount: 0,
        totalCount: stringsToTranslate.length,
        status: "error",
        error: (err as Error).message,
      };
      onLangComplete?.(result);
      return result;
    }
  };

  return runPool(targetLangs, translateOneLang, langConcurrency);
}
