/** 用户自定义的在线翻译接口配置（单套配置，同时容纳两种接口形态） */

export type TranslateProvider = "openai" | "libretranslate";

export interface OpenAICompatibleConfig {
  /** 含版本段的 Base URL，如 https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  /** 如 gpt-4o-mini、deepseek-chat */
  model: string;
}

export interface LibreTranslateConfig {
  /** 如 http://127.0.0.1:5000 */
  baseUrl: string;
  /** 公共实例通常无需填写 */
  apiKey: string;
}

export interface TranslateApiConfig {
  provider: TranslateProvider;
  openai: OpenAICompatibleConfig;
  libretranslate: LibreTranslateConfig;
}

export const TRANSLATE_CONFIG_STORAGE_KEY = "translate-api-config";

export const DEFAULT_TRANSLATE_CONFIG: TranslateApiConfig = {
  provider: "openai",
  openai: { baseUrl: "", apiKey: "", model: "" },
  libretranslate: { baseUrl: "", apiKey: "" },
};

const PROVIDER_LABELS: Record<TranslateProvider, string> = {
  openai: "OpenAI 兼容",
  libretranslate: "LibreTranslate",
};

/** 引擎下拉里属于「自定义接口」的取值 */
export function isProvider(api: string): api is TranslateProvider {
  return api === "openai" || api === "libretranslate";
}

export function providerLabel(provider: TranslateProvider): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** 逐层合并，避免旧配置缺字段时把整组默认值顶掉 */
export function mergeTranslateConfig(
  partial?: Partial<TranslateApiConfig> | null
): TranslateApiConfig {
  const provider =
    partial?.provider && isProvider(partial.provider)
      ? partial.provider
      : DEFAULT_TRANSLATE_CONFIG.provider;

  return {
    provider,
    openai: { ...DEFAULT_TRANSLATE_CONFIG.openai, ...(partial?.openai || {}) },
    libretranslate: {
      ...DEFAULT_TRANSLATE_CONFIG.libretranslate,
      ...(partial?.libretranslate || {}),
    },
  };
}

/** 当前选中的接口是否已填写必填项 */
export function isProviderConfigured(config: TranslateApiConfig | null | undefined): boolean {
  if (!config) return false;
  if (config.provider === "openai") {
    const { baseUrl, apiKey, model } = config.openai;
    return !!(baseUrl.trim() && apiKey.trim() && model.trim());
  }
  return !!config.libretranslate.baseUrl.trim();
}

function hostOf(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "未填地址";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).host;
  } catch {
    return trimmed;
  }
}

/** 一行摘要，用于工具里显示当前打的是哪个接口 */
export function describeProvider(config: TranslateApiConfig | null | undefined): string {
  if (!config) return "";
  if (config.provider === "openai") {
    const model = config.openai.model.trim() || "未填模型";
    return `OpenAI 兼容 · ${model}`;
  }
  return `LibreTranslate · ${hostOf(config.libretranslate.baseUrl)}`;
}

// ================= 内存缓存与订阅 =================

let cachedConfig: TranslateApiConfig = DEFAULT_TRANSLATE_CONFIG;

type ConfigListener = (config: TranslateApiConfig) => void;
const configListeners = new Set<ConfigListener>();

/** 同步读取当前配置（翻译时使用） */
export function getCachedTranslateConfig(): TranslateApiConfig {
  return cachedConfig;
}

export function subscribeTranslateConfig(listener: ConfigListener): () => void {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
}

function publish(config: TranslateApiConfig) {
  cachedConfig = config;
  configListeners.forEach((listener) => listener(config));
}

/** electron-store 优先，localStorage 兜底 */
export async function loadTranslateConfig(): Promise<TranslateApiConfig> {
  try {
    let stored: unknown = null;

    if (window.electronAPI?.storeGet) {
      stored = await window.electronAPI.storeGet(TRANSLATE_CONFIG_STORAGE_KEY);
    }

    if (!stored || typeof stored !== "object") {
      const local = localStorage.getItem(TRANSLATE_CONFIG_STORAGE_KEY);
      if (local) stored = JSON.parse(local);
    }

    if (stored && typeof stored === "object") {
      publish(mergeTranslateConfig(stored as Partial<TranslateApiConfig>));
    }
  } catch {
    // 读取失败时沿用内存中的配置
  }

  return cachedConfig;
}

export async function saveTranslateConfig(
  config: TranslateApiConfig
): Promise<TranslateApiConfig> {
  const normalized = mergeTranslateConfig(config);
  const next: TranslateApiConfig = {
    provider: normalized.provider,
    openai: {
      baseUrl: normalized.openai.baseUrl.trim(),
      apiKey: normalized.openai.apiKey.trim(),
      model: normalized.openai.model.trim(),
    },
    libretranslate: {
      baseUrl: normalized.libretranslate.baseUrl.trim(),
      apiKey: normalized.libretranslate.apiKey.trim(),
    },
  };

  publish(next);

  try {
    await window.electronAPI?.storeSet?.(TRANSLATE_CONFIG_STORAGE_KEY, next);
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(TRANSLATE_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }

  return next;
}
