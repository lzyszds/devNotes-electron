import { net, session } from 'electron'
import type Store from 'electron-store'

export type ProxyMode = 'system' | 'manual' | 'direct'

export interface ProxyConfig {
  mode: ProxyMode
  /** 如 127.0.0.1:7890 或 socks5://127.0.0.1:1080 */
  url?: string
}

const PROXY_STORE_KEY = 'proxy-config'

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  mode: 'system',
}

export function getProxyConfig(store: Store): ProxyConfig {
  const saved = store.get(PROXY_STORE_KEY) as ProxyConfig | undefined
  return saved?.mode ? saved : DEFAULT_PROXY_CONFIG
}

export function setProxyConfig(store: Store, config: ProxyConfig): ProxyConfig {
  const normalized = normalizeProxyConfig(config)
  store.set(PROXY_STORE_KEY, normalized)
  return normalized
}

function normalizeProxyConfig(config: ProxyConfig): ProxyConfig {
  if (config.mode !== 'manual') {
    return { mode: config.mode }
  }

  const url = config.url?.trim()
  if (!url) {
    return { mode: 'system' }
  }

  return { mode: 'manual', url }
}

function toProxyRules(url: string): string {
  const trimmed = url.trim()

  if (trimmed.startsWith('socks5://') || trimmed.startsWith('socks4://')) {
    return trimmed
  }

  const withoutScheme = trimmed.replace(/^https?:\/\//, '')
  return `http=${withoutScheme};https=${withoutScheme}`
}

export async function applyProxyConfig(store: Store): Promise<ProxyConfig> {
  const config = getProxyConfig(store)

  if (config.mode === 'system') {
    await session.defaultSession.setProxy({ mode: 'system' })
    return config
  }

  if (config.mode === 'manual' && config.url) {
    await session.defaultSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: toProxyRules(config.url),
    })
    return config
  }

  await session.defaultSession.setProxy({ mode: 'direct' })
  return { mode: 'direct' }
}

export async function resolveProxyForUrl(url: string): Promise<string> {
  return session.defaultSession.resolveProxy(url)
}

export interface NetFetchOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeout?: number
}

export interface NetFetchResult {
  ok: boolean
  status: number
  text: string
  error?: string
}

/** 使用 Electron net 模块发起请求，自动走 session 代理配置 */
export function fetchViaNet(options: NetFetchOptions): Promise<NetFetchResult> {
  return new Promise((resolve) => {
    const request = net.request({
      method: options.method || 'GET',
      url: options.url,
      session: session.defaultSession,
    })

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://translate.google.com/',
      ...options.headers,
    }

    for (const [key, value] of Object.entries(headers)) {
      if (value) request.setHeader(key, value)
    }

    const timeoutMs = options.timeout ?? 10000
    const timer = setTimeout(() => {
      request.abort()
    }, timeoutMs)

    let responseData = ''

    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseData += chunk.toString()
      })

      response.on('end', () => {
        clearTimeout(timer)
        const status = response.statusCode || 0
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: responseData,
        })
      })

      response.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          ok: false,
          status: 0,
          text: '',
          error: err.message,
        })
      })
    })

    request.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        status: 0,
        text: '',
        error: err.message,
      })
    })

    request.on('abort', () => {
      clearTimeout(timer)
      resolve({
        ok: false,
        status: 0,
        text: '',
        error: '请求超时',
      })
    })

    if (options.body) {
      request.write(options.body)
    }
    request.end()
  })
}

export async function testGoogleTranslate(store: Store): Promise<{
  ok: boolean
  proxy: string
  status: number
  error?: string
}> {
  await applyProxyConfig(store)

  const testUrl =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&dj=1&q=hi'

  const proxy = await resolveProxyForUrl(testUrl)
  const result = await fetchViaNet({ url: testUrl, timeout: 15000 })

  const translated = parseGtxResponse(result.text)

  return {
    ok: result.ok && !!translated,
    proxy,
    status: result.status,
    error: result.error || (!translated ? '响应解析失败，代理可能未生效' : undefined),
  }
}

function parseGtxResponse(raw: string): string | null {
  let text = raw.trim()
  if (!text) return null
  if (text.startsWith(")]}'")) {
    text = text.slice(text.indexOf('\n') + 1).trim()
  }
  try {
    const data = JSON.parse(text)
    if (data?.sentences) {
      return data.sentences.map((s: { trans?: string }) => s.trans || '').join('').trim() || null
    }
    if (Array.isArray(data?.[0])) {
      return data[0].map((item: unknown[]) => item?.[0]).filter(Boolean).join('').trim() || null
    }
  } catch {
    return null
  }
  return null
}
