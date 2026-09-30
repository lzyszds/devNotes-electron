/** 用户自定义的在线翻译接口配置（单套配置，同时容纳两种接口形态） */

export type TranslateProvider = "openai" | "libretranslate";

export interface OpenAICompatibleConfig {
  /** 含版本段的 Base URL，如 https://api.siliconflow.cn/v1 */
  baseUrl: string;
  apiKey: string;
  /** 如 Qwen/Qwen3-30B-A3B-Instruct-2507、gpt-4o-mini */
  model: string;
  /**
   * 关闭思考模式。
   *
   * 推理模型（Qwen3.5 系列、DeepSeek-R1 等）会先生成一大段思考再输出答案，
   * 翻译场景下纯属浪费 —— 实测 Qwen3.5-9B 首字要 5.4 秒，其中 98% 花在思考上。
   * 打开这个开关会在请求里带上对应的参数让模型直接回答。
   *
   * 各家网关的参数名不统一（见 THINKING_OFF_PARAM 的说明），所以做成可选项
   * 而不是默认行为 —— 不认这个参数的接口会直接报错。
   */
  disableThinking?: boolean;
  /**
   * 关闭思考时用什么参数名。
   *
   * 主流有两种写法，各家兼容网关认的不一样：
   *  - 'enable_thinking'：传 enable_thinking: false（阿里百炼、部分硅基流动模型）
   *  - 'chat_template_kwargs'：传 chat_template_kwargs: { enable_thinking: false }（vLLM 系）
   * 默认用第一种，报错时换第二种。
   */
  thinkingParam?: ThinkingParamStyle;
}

export type ThinkingParamStyle = "enable_thinking" | "chat_template_kwargs";

/**
 * 构造「关闭思考」要带的额外请求字段。
 *
 * 返回空对象表示不关闭。两处请求（流式 / 非流式）都用它，保证行为一致。
 *
 * 参数名各家不统一是这个功能的固有麻烦：`enable_thinking` 是阿里百炼与部分
 * 硅基流动模型的写法，`chat_template_kwargs` 是 vLLM 系的写法。传错的后果
 * 一般是接口报「未知参数」，所以做成用户可切换，而不是猜一个。
 */
export function buildThinkingOffParams(
  config: OpenAICompatibleConfig
): Record<string, unknown> {
  if (!config.disableThinking) return {};
  if (config.thinkingParam === "chat_template_kwargs") {
    return { chat_template_kwargs: { enable_thinking: false } };
  }
  return { enable_thinking: false };
}

/** 服务商预设：填 Base URL 与常见模型，省得用户去翻文档 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  /** 推荐的模型名，第一个作为默认填入 */
  models: string[];
  /** 该服务商的模型列表接口是否需要额外处理 */
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "siliconflow",
    label: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      "Qwen/Qwen3-30B-A3B-Instruct-2507",
      "Qwen/Qwen2.5-7B-Instruct",
      "Qwen/Qwen3.5-9B",
      "deepseek-ai/DeepSeek-V3",
    ],
    note: "Qwen3.5 系列默认开思考模式，翻译会很慢，建议打开下方「关闭思考模式」",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat"],
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o"],
  },
  {
    id: "dashscope",
    label: "阿里百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
  },
  {
    id: "moonshot",
    label: "月之暗面",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k"],
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-plus"],
  },
  {
    id: "ollama",
    label: "Ollama(本地)",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: ["qwen2.5:7b", "llama3.1:8b"],
    note: "本地模型无需 API Key，随便填一个即可",
  },
];

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
      disableThinking: normalized.openai.disableThinking === true,
      // 没选就落回默认写法，免得存成 undefined 后读取端还要判空
      thinkingParam: normalized.openai.thinkingParam ?? "enable_thinking",
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
