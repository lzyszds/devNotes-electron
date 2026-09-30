/** 用户自定义翻译接口的请求构造与响应解析：OpenAI 兼容 / LibreTranslate */

import { translateFetch } from "./translateFetch";
import { translateStream } from "./translateStream";
import {
  buildThinkingOffParams,
  type LibreTranslateConfig,
  type OpenAICompatibleConfig,
} from "./translateConfig";

export interface AdapterOutcome {
  ok: boolean;
  text?: string;
  error?: string;
}

const OPENAI_TIMEOUT_MS = 60000;
const LIBRE_TIMEOUT_MS = 30000;

/** 发给 LLM 用英文语言名最稳，不要用语言码 */
const LLM_LANG_NAMES: Record<string, string> = {
  zh: "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
  pt: "Portuguese",
  it: "Italian",
  ar: "Arabic",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  ms: "Malay",
  tr: "Turkish",
  pl: "Polish",
  nl: "Dutch",
  hi: "Hindi",
};

export function llmLangName(code: string): string {
  return LLM_LANG_NAMES[code] || code;
}

/** LibreTranslate 用 ISO 639-1，不能用 GTX 那套 zh-CN */
const LIBRE_LANG_MAP: Record<string, string> = {
  zh: "zh",
  "zh-TW": "zt",
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

export function toLibreLangCode(code: string): string {
  return LIBRE_LANG_MAP[code] || code;
}

/** 拼接接口地址：去掉尾部斜杠，且用户已填完整路径时不重复追加 */
function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return "";
  return base.endsWith(path) ? base : `${base}${path}`;
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  return joinUrl(baseUrl, "/chat/completions");
}

export function buildLibreTranslateUrl(baseUrl: string): string {
  return joinUrl(baseUrl, "/translate");
}

export function buildTranslateSystemPrompt(sourceLang: string, targetLang: string): string {
  // 源语言为「自动检测」时不能把 auto 直译进句子（会变成 from auto to ...），改让模型自行判断
  const autoDetect = !sourceLang || sourceLang === "auto";
  return [
    "You are a professional software localization translator.",
    autoDetect
      ? `Detect the source language automatically and translate the text into ${llmLangName(targetLang)}.`
      : `Translate the user's text from ${llmLangName(sourceLang)} to ${llmLangName(targetLang)}.`,
    "Keep placeholders and unusual private-use symbols exactly as they appear.",
    'Output ONLY the translation: no quotation marks, no code fences, no explanations, no "Translation:" prefix.',
  ].join(" ");
}

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
];

/** 仅当整体被成对引号包裹时剥掉，正文内部的引号不动 */
function stripWrappingQuotes(text: string): string {
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  const pair = QUOTE_PAIRS.find(([open, close]) => open === first && close === last);
  if (!pair) return text;
  const inner = text.slice(1, -1);
  if (inner.includes(first) || inner.includes(last)) return text;
  return inner;
}

/** 清理模型的冗余包裹：代码围栏、「译文：」前缀、整体引号 */
export function cleanLLMOutput(raw: string): string {
  let text = raw.trim();

  const fence = text.match(/^```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/);
  if (fence) text = fence[1].trim();

  const prefix = text.match(
    /^(?:译文|翻译结果|翻译|Translation|Translated text|Output)\s*[:：]\s*/i
  );
  if (prefix) text = text.slice(prefix[0].length).trim();

  return stripWrappingQuotes(text).trim();
}

/** 从错误响应里抽出可读原因 */
export function extractErrorMessage(status: number, rawBody: string): string {
  const raw = (rawBody || "").trim();
  if (!raw) return `HTTP ${status}`;

  try {
    const data = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
      detail?: string;
    };
    const nested = typeof data?.error === "object" ? data.error?.message : data?.error;
    const message = nested || data?.message || data?.detail;
    if (typeof message === "string" && message.trim()) {
      const brief = message.trim();
      return status ? `HTTP ${status}：${brief}` : brief;
    }
  } catch {
    // 非 JSON 响应，走下面的截断逻辑
  }

  const brief = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  return status ? `HTTP ${status}：${brief}` : brief;
}

/** 兼容 content 为字符串 / 多模态数组 / null 三种形态 */
function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

export function parseOpenAIResponse(raw: string): AdapterOutcome {
  let data: {
    error?: unknown;
    choices?: { message?: { content?: unknown } }[];
  };
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "响应不是合法 JSON，接口地址可能不正确" };
  }

  if (data?.error) return { ok: false, error: extractErrorMessage(0, raw) };

  const content = normalizeMessageContent(data?.choices?.[0]?.message?.content);
  const text = cleanLLMOutput(content);
  if (!text) return { ok: false, error: "响应中没有译文内容" };

  return { ok: true, text };
}

export function parseLibreTranslateResponse(raw: string): AdapterOutcome {
  let data: { error?: unknown; translatedText?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "响应不是合法 JSON，接口地址可能不正确" };
  }

  if (typeof data?.error === "string" && data.error.trim()) {
    return { ok: false, error: data.error.trim() };
  }

  const text = data?.translatedText;
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "响应中没有译文内容" };
  }

  return { ok: true, text };
}

function inElectron(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI?.translateFetch;
}

/** 主进程代理请求失败时补一句排障提示 */
function describeFetchFailure(error: string | undefined): string {
  const reason = error || "网络请求失败";
  if (inElectron()) return reason;
  return `${reason}（浏览器预览模式可能被 CORS 拦截，建议使用桌面应用）`;
}

export async function translateWithOpenAI(
  text: string,
  sourceLang: string,
  targetLang: string,
  config: OpenAICompatibleConfig
): Promise<AdapterOutcome> {
  if (!text.trim()) return { ok: true, text };

  const url = buildChatCompletionsUrl(config.baseUrl);
  if (!url) return { ok: false, error: "未填写 Base URL" };
  if (!config.model.trim()) return { ok: false, error: "未填写模型名" };

  const body = JSON.stringify({
    model: config.model.trim(),
    temperature: 0,
    // 显式关流，避免兼容网关回 SSE 导致 JSON 解析失败
    stream: false,
    messages: [
      { role: "system", content: buildTranslateSystemPrompt(sourceLang, targetLang) },
      { role: "user", content: text },
    ],
    // 关掉推理模型的思考过程，否则首个可见字符要等好几秒
    ...buildThinkingOffParams(config),
  });

  const result = await translateFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body,
    timeout: OPENAI_TIMEOUT_MS,
  });

  if (result.status === 0 || result.error) {
    return { ok: false, error: describeFetchFailure(result.error) };
  }
  if (!result.ok) {
    return { ok: false, error: extractErrorMessage(result.status, result.text) };
  }

  return parseOpenAIResponse(result.text);
}

export async function translateWithLibreTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  config: LibreTranslateConfig
): Promise<AdapterOutcome> {
  if (!text.trim()) return { ok: true, text };

  const url = buildLibreTranslateUrl(config.baseUrl);
  if (!url) return { ok: false, error: "未填写服务地址" };

  const apiKey = config.apiKey.trim();
  const payload: Record<string, string> = {
    q: text,
    source: toLibreLangCode(sourceLang) || "auto",
    target: toLibreLangCode(targetLang),
    // 默认可能是 html，会把换行转成 <br> 污染 JSON 值
    format: "text",
  };
  if (apiKey) payload.api_key = apiKey;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // 部分分支实例只认 Authorization 头
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const result = await translateFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeout: LIBRE_TIMEOUT_MS,
  });

  if (result.status === 0 || result.error) {
    return { ok: false, error: describeFetchFailure(result.error) };
  }
  if (!result.ok) {
    return { ok: false, error: extractErrorMessage(result.status, result.text) };
  }

  return parseLibreTranslateResponse(result.text);
}

export interface ProbeOutcome extends AdapterOutcome {
  /** 本次测试的总耗时（毫秒）。失败时也有值，方便判断是超时还是立刻报错 */
  elapsedMs: number;
  /**
   * 首字延迟（毫秒）。只有 OpenAI 兼容接口能测出来 —— 它走流式，
   * 能精确知道第一个字什么时候到。LibreTranslate 没有流式，为 undefined。
   *
   * 挑模型时这个值比总耗时更贴近体感：总耗时受译文长度影响，而首字延迟
   * 决定"按下翻译到看见字开始动"这段等待。
   */
  firstTokenMs?: number;
}

/**
 * 设置弹窗的「测试连接」：真实翻译一句话，把 URL、密钥、模型名一次验完。
 *
 * 顺带把耗时带回去 —— 用户挑模型时，这个数字比"成功"两个字有用得多：
 * 同在能用的前提下，选快的那条链路才是重点。
 *
 * OpenAI 兼容接口走流式测：既验证 stream 是否可用（翻译页现在依赖它），
 * 又能拿到首字延迟。LibreTranslate 没有流式能力，只能测总耗时。
 */
export async function probeProvider(
  provider: "openai" | "libretranslate",
  config: OpenAICompatibleConfig | LibreTranslateConfig
): Promise<ProbeOutcome> {
  const sample = "Hello, world!";
  const startedAt = Date.now();

  if (provider === "openai") {
    let firstTokenMs: number | undefined;
    const result = await translateStream({
      text: sample,
      sourceLang: "en",
      targetLang: "zh",
      config: config as OpenAICompatibleConfig,
      onFirstToken: (ms) => {
        firstTokenMs = ms;
      },
      onDelta: () => {},
    });
    return {
      ok: result.ok,
      text: result.text,
      error: result.error,
      elapsedMs: Date.now() - startedAt,
      firstTokenMs,
    };
  }

  const outcome = await translateWithLibreTranslate(
    sample,
    "en",
    "zh",
    config as LibreTranslateConfig
  );
  return { ...outcome, elapsedMs: Date.now() - startedAt };
}
