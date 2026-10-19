/*
 * 项目级 AI 渠道：一套 OpenAI 兼容接口的配置（Base URL / Key / 模型），
 * 全项目的 AI 功能都从这里取。服务商预设复用翻译配置里的列表，
 * 选「自定义」就是手填任意兼容地址。
 *
 * 与「AI 与翻译」里的翻译接口配置相互独立，互不覆盖。
 */

import { PROVIDER_PRESETS, type ProviderPreset } from './translateConfig'
import { translateFetch } from './translateFetch'

export interface AiChannelConfig {
  /** 含版本段的 Base URL，如 https://api.deepseek.com/v1；可以不带版本段 */
  baseUrl: string
  apiKey: string
  model: string
}

export const AI_CHANNEL_STORAGE_KEY = 'ai-channel-config'

export const DEFAULT_AI_CHANNEL: AiChannelConfig = {
  baseUrl: '',
  apiKey: '',
  model: '',
}

/** 首次接入的推荐服务商（价格低、中文能力好、接口兼容 OpenAI） */
export const AI_RECOMMENDED_PRESET_ID = 'deepseek'

export const AI_PRESETS: ProviderPreset[] = PROVIDER_PRESETS

export function findAiPreset(baseUrl: string): ProviderPreset | undefined {
  const trimmed = baseUrl.trim()
  return AI_PRESETS.find((preset) => preset.baseUrl === trimmed)
}

export function mergeAiChannel(partial?: Partial<AiChannelConfig> | null): AiChannelConfig {
  return {
    baseUrl: typeof partial?.baseUrl === 'string' ? partial.baseUrl : DEFAULT_AI_CHANNEL.baseUrl,
    apiKey: typeof partial?.apiKey === 'string' ? partial.apiKey : DEFAULT_AI_CHANNEL.apiKey,
    model: typeof partial?.model === 'string' ? partial.model : DEFAULT_AI_CHANNEL.model,
  }
}

export function isAiChannelConfigured(config: AiChannelConfig | null | undefined): boolean {
  if (!config) return false
  return !!(config.baseUrl.trim() && config.model.trim())
}

// ================= 内存缓存与订阅 =================

let cachedConfig: AiChannelConfig = DEFAULT_AI_CHANNEL

type AiChannelListener = (config: AiChannelConfig) => void
const listeners = new Set<AiChannelListener>()

export function getCachedAiChannel(): AiChannelConfig {
  return cachedConfig
}

export function subscribeAiChannel(listener: AiChannelListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(config: AiChannelConfig) {
  cachedConfig = config
  listeners.forEach((listener) => listener(config))
}

/** electron-store 优先，localStorage 兜底 */
export async function loadAiChannel(): Promise<AiChannelConfig> {
  try {
    let stored: unknown = null

    if (window.electronAPI?.storeGet) {
      stored = await window.electronAPI.storeGet(AI_CHANNEL_STORAGE_KEY)
    }

    if (!stored || typeof stored !== 'object') {
      const local = localStorage.getItem(AI_CHANNEL_STORAGE_KEY)
      if (local) stored = JSON.parse(local)
    }

    if (stored && typeof stored === 'object') {
      publish(mergeAiChannel(stored as Partial<AiChannelConfig>))
    }
  } catch {
    // 读取失败时沿用内存中的配置
  }

  return cachedConfig
}

export async function saveAiChannel(config: AiChannelConfig): Promise<AiChannelConfig> {
  const next: AiChannelConfig = {
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
  }

  publish(next)

  try {
    await window.electronAPI?.storeSet?.(AI_CHANNEL_STORAGE_KEY, next)
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(AI_CHANNEL_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }

  return next
}

// ================= 调用 =================

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiChatOptions {
  temperature?: number
  maxTokens?: number
}

export interface AiChatResult {
  ok: boolean
  text: string
  error?: string
  elapsedMs: number
}

/** 与 fetchModels 保持一致：没写版本段就补 /v1 */
export function buildChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`
}

/**
 * 非流式调用 chat/completions，返回完整回复文本。
 * 走主进程代理（绕开 CORS、复用代理配置）。需要流式的功能再单独加。
 */
export async function chatCompletion(
  messages: AiChatMessage[],
  options: AiChatOptions = {},
  config: AiChannelConfig = cachedConfig,
): Promise<AiChatResult> {
  const startedAt = Date.now()
  const fail = (error: string): AiChatResult => ({
    ok: false,
    text: '',
    error,
    elapsedMs: Date.now() - startedAt,
  })

  const url = buildChatUrl(config.baseUrl)
  if (!url) return fail('未填写 Base URL')
  if (!config.model.trim()) return fail('未选择模型')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`

  const result = await translateFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model.trim(),
      messages,
      stream: false,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
    }),
    // 推理模型（先思考再回答）单次可能要一两分钟，别按普通模型定超时
    timeout: 180000,
  })

  if (result.status === 0 || result.error) {
    return fail(result.error || '请求失败')
  }
  if (!result.ok) {
    return fail(`HTTP ${result.status}：${result.text.slice(0, 200)}`)
  }

  try {
    const parsed = JSON.parse(result.text)
    const message = parsed?.choices?.[0]?.message
    const content = message?.content
    if (typeof content === 'string' && content.trim()) {
      return { ok: true, text: content, elapsedMs: Date.now() - startedAt }
    }

    // 推理模型（NVIDIA NIM 的 nemotron / step / glm 等）会把思考写在
    // reasoning_content，正式回答在 content。token 预算不够时思考没跑完就被
    // 截断，content 会是 null —— 这时至少把思考内容返回，别报「没有回复内容」。
    const reasoning = message?.reasoning_content
    if (typeof reasoning === 'string' && reasoning.trim()) {
      return { ok: true, text: reasoning, elapsedMs: Date.now() - startedAt }
    }

    return fail('返回中没有回复内容')
  } catch {
    return fail('返回不是合法的 JSON')
  }
}
