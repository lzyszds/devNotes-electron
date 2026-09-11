export interface TranslateFetchResult {
  ok: boolean;
  status: number;
  text: string;
  error?: string;
}

const GTX_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 将 Google Translate URL 映射到 Vite 开发代理路径 */
function resolveDevProxyUrl(url: string): string {
  if (url.startsWith("https://translate-pa.googleapis.com/v1/translateHtml")) {
    return "/api/gtx-translate-html";
  }
  if (url.startsWith("https://translate.google.com/translate_a/elementHtml")) {
    return "/api/gtx-element-html";
  }
  if (url.includes("/translate_a/single")) {
    const parsed = new URL(url);
    return `/api/gtx-single${parsed.search}`;
  }
  return url;
}

function useElectronProxy(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI?.translateFetch;
}

function isGoogleTranslateUrl(url: string): boolean {
  return (
    url.includes("translate.googleapis.com") ||
    url.includes("translate.google.com") ||
    url.includes("translate-pa.googleapis.com")
  );
}

/** 绕过浏览器 CORS：Electron 主进程代理 / Vite 开发代理 */
export async function translateFetch(
  url: string,
  init?: RequestInit & { timeout?: number }
): Promise<TranslateFetchResult> {
  const headers = init?.headers as Record<string, string> | undefined;
  const body =
    typeof init?.body === "string"
      ? init.body
      : init?.body
        ? String(init.body)
        : undefined;
  const timeout = init?.timeout ?? (isGoogleTranslateUrl(url) ? 10000 : 15000);

  if (useElectronProxy()) {
    try {
      return await window.electronAPI!.translateFetch!({
        url,
        method: init?.method,
        headers,
        body,
        timeout,
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        text: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    const proxyUrl = resolveDevProxyUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(proxyUrl, {
      method: init?.method,
      headers: {
        Accept: "application/json",
        ...(headers || {}),
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function translateFetchJson<T>(
  url: string,
  init?: RequestInit & { timeout?: number }
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const result = await translateFetch(url, init);
  if (result.error || result.status === 0) {
    return {
      ok: false,
      status: result.status,
      data: null,
      error: result.error || "网络请求失败",
    };
  }
  if (!result.text) {
    return { ok: result.ok, status: result.status, data: null };
  }
  try {
    return {
      ok: result.ok,
      status: result.status,
      data: JSON.parse(result.text) as T,
    };
  } catch {
    return { ok: false, status: result.status, data: null };
  }
}

let gtxUnavailable: boolean | null = null;

export function resetGtxCache() {
  gtxUnavailable = null;
}

/** 探测 Google 翻译是否可达，不可达时跳过后续 GTX 请求 */
export async function isGtxReachable(): Promise<boolean> {
  if (gtxUnavailable === true) return false;

  const probeUrl =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&dj=1&q=hi";

  const result = await translateFetch(probeUrl, { timeout: 8000 });

  if (result.status === 0 || result.error) {
    gtxUnavailable = true;
    console.warn("[翻译] Google 翻译不可达，将跳过 GTX API:", result.error);
    return false;
  }

  const translated = parseGtxSingleResponse(result.text);
  if (!result.ok || !translated) {
    gtxUnavailable = true;
    console.warn(
      "[翻译] Google 翻译探测失败:",
      result.error || `HTTP ${result.status}`
    );
    return false;
  }

  gtxUnavailable = false;
  return true;
}

export const gtxRequestHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": GTX_USER_AGENT,
  Referer: "https://translate.google.com/",
});

/** 解析 Google GTX single 接口响应（兼容 dj=1 对象格式和经典数组格式） */
export function parseGtxSingleResponse(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;

  // Google XSSI 防劫持前缀
  if (text.startsWith(")]}'")) {
    text = text.slice(text.indexOf("\n") + 1).trim();
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  // dj=1 格式: { sentences: [{ trans: "..." }] }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const sentences = (data as { sentences?: { trans?: string }[] }).sentences;
    if (Array.isArray(sentences)) {
      const result = sentences.map((s) => s.trans || "").join("");
      return result.trim() || null;
    }
  }

  // 经典数组格式: [[["译文","原文",...],...],null,"lang"]
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const result = (data[0] as unknown[])
      .map((item) => (Array.isArray(item) ? String(item[0] || "") : ""))
      .filter(Boolean)
      .join("");
    return result.trim() || null;
  }

  return null;
}

export function buildGtxSingleUrl(
  baseUrl: string,
  sl: string,
  tl: string,
  text: string,
  useDj = false
): string {
  const params = new URLSearchParams({
    client: "gtx",
    sl,
    tl,
    dt: "t",
    q: text,
  });
  if (useDj) params.set("dj", "1");
  return `${baseUrl}?${params.toString()}`;
}
