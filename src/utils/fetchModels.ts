/*
 * 从 OpenAI 兼容接口拉取可用模型列表。
 *
 * 走 /models 端点，这是 OpenAI 兼容规范的强制部分，各家网关都实现了。
 * 返回体形如 { data: [{ id: "Qwen/Qwen3-30B-A3B-Instruct-2507" }, ...] }。
 *
 * 用主进程代理发请求（跟翻译走同一条路），绕开 CORS 并复用代理配置。
 */

import { translateFetch } from './translateFetch'
import type { OpenAICompatibleConfig } from './translateConfig'

export interface ModelInfo {
  id: string
  /** 服务商给的展示名，没有就用 id */
  label: string
}

export interface FetchModelsResult {
  ok: boolean
  models: ModelInfo[]
  error?: string
}

/** 与请求构造处保持一致：补上 /v1 后缀 */
function buildModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  // 已经带版本段就不再补。Ollama 的地址是 /v1 结尾，同样适用
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`
}

export async function fetchModels(config: OpenAICompatibleConfig): Promise<FetchModelsResult> {
  const url = buildModelsUrl(config.baseUrl)
  if (!url) return { ok: false, models: [], error: '未填写 Base URL' }

  const headers: Record<string, string> = { Accept: 'application/json' }
  // 本地 Ollama 之类不需要密钥，有才带上
  if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`

  const result = await translateFetch(url, { method: 'GET', headers, timeout: 15000 })
  if (result.status === 0 || result.error) {
    return { ok: false, models: [], error: result.error || '请求失败' }
  }
  if (!result.ok) {
    return { ok: false, models: [], error: `HTTP ${result.status}：${result.text.slice(0, 200)}` }
  }

  try {
    const parsed = JSON.parse(result.text)
    // 有的网关把列表塞在 data，有的直接给数组，两种都认
    const raw = Array.isArray(parsed) ? parsed : parsed?.data
    if (!Array.isArray(raw)) {
      return { ok: false, models: [], error: '返回格式不是模型列表' }
    }

    const models: ModelInfo[] = raw
      .map((item: unknown) => {
        if (typeof item === 'string') return { id: item, label: item }
        const record = item as { id?: unknown; name?: unknown }
        const id = typeof record?.id === 'string' ? record.id : ''
        if (!id) return null
        return { id, label: typeof record?.name === 'string' ? record.name : id }
      })
      .filter((item): item is ModelInfo => item !== null)
      // 按 id 排序，长列表里好找
      .sort((a, b) => a.id.localeCompare(b.id))

    if (!models.length) return { ok: false, models: [], error: '接口没有返回任何模型' }
    return { ok: true, models }
  } catch {
    return { ok: false, models: [], error: '返回内容不是合法 JSON' }
  }
}
