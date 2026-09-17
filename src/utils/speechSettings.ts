/**
 * 朗读译文的语音偏好。
 *
 * 朗读走浏览器的 Web Speech API（speechSynthesis），音色来自操作系统自带的
 * TTS 引擎 —— 这里没有任何音频文件，「好不好听」完全取决于挑了哪个 voice，
 * 以及语速 / 音调。不指定 voice 时浏览器会用它最默认的那个，在多数系统上
 * 恰好是最机械的一个，所以把这几项放出来让用户自己调。
 *
 * 与其他设置一样收口在模块级状态：工具里的朗读和设置面板里的试听是两个入口，
 * 各自 setState 会把偏好散到两处，这里统一存，两边都只订阅。
 */

export interface SpeechSettings {
  /** 指定音色的 voiceURI；空串表示「按朗读语言自动挑一个」 */
  voiceURI: string
  /** 语速，0.5 ~ 2 */
  rate: number
  /** 音调，0 ~ 2 */
  pitch: number
  /** 音量，0 ~ 1 */
  volume: number
}

export const SPEECH_DEFAULTS: SpeechSettings = {
  voiceURI: '',
  rate: 1,
  pitch: 1,
  volume: 1,
}

export const SPEECH_LIMITS = {
  rate: { min: 0.5, max: 2, step: 0.1 },
  pitch: { min: 0, max: 2, step: 0.1 },
  volume: { min: 0, max: 1, step: 0.05 },
} as const

const STORAGE_KEY = 'fehelper-speech-settings'

const listeners = new Set<(settings: SpeechSettings) => void>()

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min

function readSettings(): SpeechSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...SPEECH_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<SpeechSettings>
    return {
      voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : SPEECH_DEFAULTS.voiceURI,
      rate: clamp(Number(parsed.rate), SPEECH_LIMITS.rate.min, SPEECH_LIMITS.rate.max),
      pitch: clamp(Number(parsed.pitch), SPEECH_LIMITS.pitch.min, SPEECH_LIMITS.pitch.max),
      volume: clamp(Number(parsed.volume), SPEECH_LIMITS.volume.min, SPEECH_LIMITS.volume.max),
    }
  } catch {
    return { ...SPEECH_DEFAULTS }
  }
}

let current = readSettings()

export function getSpeechSettings(): SpeechSettings {
  return current
}

export function saveSpeechSettings(patch: Partial<SpeechSettings>): SpeechSettings {
  current = {
    voiceURI: patch.voiceURI ?? current.voiceURI,
    rate: clamp(patch.rate ?? current.rate, SPEECH_LIMITS.rate.min, SPEECH_LIMITS.rate.max),
    pitch: clamp(patch.pitch ?? current.pitch, SPEECH_LIMITS.pitch.min, SPEECH_LIMITS.pitch.max),
    volume: clamp(patch.volume ?? current.volume, SPEECH_LIMITS.volume.min, SPEECH_LIMITS.volume.max),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // 隐私模式下写不进去，本次会话内仍然生效
  }
  listeners.forEach((notify) => notify(current))
  return current
}

export function subscribeSpeechSettings(notify: (settings: SpeechSettings) => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

/** 当前环境有没有朗读能力（部分 Android WebView 没有 speechSynthesis） */
export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** 系统可用音色。首次调用常常是空数组，配合 subscribeVoices 用 */
export function listVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return []
  return window.speechSynthesis.getVoices()
}

/**
 * 订阅音色列表。列表是异步填充的 —— 首次 getVoices() 多半返回空，
 * 要等 voiceschanged 事件才有内容，所以这里先立刻发一次、再挂监听。
 */
export function subscribeVoices(notify: (voices: SpeechSynthesisVoice[]) => void): () => void {
  if (!isSpeechSupported()) {
    notify([])
    return () => {}
  }
  const synth = window.speechSynthesis
  const emit = () => notify(synth.getVoices())
  emit()
  synth.addEventListener('voiceschanged', emit)
  return () => synth.removeEventListener('voiceschanged', emit)
}

/**
 * 短语言码补成全的 BCP-47 标签。
 * speechSynthesis 按标签匹配音色，只给 'zh' 时不少系统会挑不到中文音色、
 * 退回默认那个（通常还是英文的）。
 */
const LANG_TAG: Record<string, string> = {
  zh: 'zh-CN',
  'zh-TW': 'zh-TW',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  ru: 'ru-RU',
  pt: 'pt-PT',
  it: 'it-IT',
  ar: 'ar-SA',
  vi: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
  ms: 'ms-MY',
  tr: 'tr-TR',
  pl: 'pl-PL',
  nl: 'nl-NL',
  hi: 'hi-IN',
}

export function toLangTag(code: string): string {
  return LANG_TAG[code] ?? code
}

/**
 * 造一条朗读请求，参数取自当前设置。
 * 工具里的「朗读译文」和设置面板里的「试听」共用这一条，两处听感才一致。
 */
export function createUtterance(text: string, langCode: string): SpeechSynthesisUtterance | null {
  if (!isSpeechSupported() || !text.trim()) return null

  const settings = getSpeechSettings()
  const voices = listVoices()
  const tag = toLangTag(langCode)

  // 用户明确挑过就用它；否则按语言找一个系统音色。
  // 这一步是「难听」的主要来源：不指定时浏览器给的是最默认那个。
  const voice =
    (settings.voiceURI && voices.find((item) => item.voiceURI === settings.voiceURI)) ||
    voices.find((item) => item.lang.toLowerCase() === tag.toLowerCase()) ||
    voices.find((item) => item.lang.toLowerCase().startsWith(langCode.slice(0, 2).toLowerCase())) ||
    null

  const utter = new SpeechSynthesisUtterance(text)
  if (voice) utter.voice = voice
  utter.lang = voice?.lang || tag
  utter.rate = settings.rate
  utter.pitch = settings.pitch
  utter.volume = settings.volume
  return utter
}

/** 按当前设置朗读一段文本；返回是否真的读起来了 */
export function speak(text: string, langCode: string): boolean {
  if (!isSpeechSupported()) return false
  const utter = createUtterance(text, langCode)
  if (!utter) return false
  // 连点两次时要打断上一条，否则会排队念完
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utter)
  return true
}

export function stopSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.cancel()
}
