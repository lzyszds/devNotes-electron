import { useEffect, useMemo, useState } from 'react'
import { Play, RotateCcw, Volume2 } from 'lucide-react'
import { NoteCard, Select, type SelectOption } from '../ui'
import Tooltip from '../ui/Tooltip'
import {
  SPEECH_DEFAULTS,
  SPEECH_LIMITS,
  getSpeechSettings,
  isSpeechSupported,
  listVoices,
  saveSpeechSettings,
  speak,
  stopSpeaking,
  subscribeSpeechSettings,
  subscribeVoices,
  type SpeechSettings,
} from '../../utils/speechSettings'

const LABEL_CLASS = 'block text-xs font-semibold text-slate-700 dark:text-slate-300'

/** 常用语种排前面，其余按标签排 —— 中文用户最先要的就是这两类 */
const PREFERRED_LANGS = ['zh', 'en']

/** BCP-47 标签翻成「中文（中国）」这类可读名字，翻不出来就退回原标签 */
function langLabel(tag: string): string {
  try {
    return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

/** 数值滑杆。项目里没有 Slider 组件，沿用工具页那套原生 range 的写法 */
function SettingSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  onChange: (next: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className={LABEL_CLASS}>{label}</span>
        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
          {value.toFixed(step < 0.1 ? 2 : 1)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 dark:bg-dark-hover accent-brand-600"
      />
      <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">{hint}</p>
    </div>
  )
}

/** 全局设置 · 语音朗读：译文朗读用的音色与语速 */
export default function SpeechPanel() {
  const [settings, setSettings] = useState<SpeechSettings>(getSpeechSettings)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(listVoices)

  useEffect(() => subscribeSpeechSettings(setSettings), [])
  // 音色列表是异步填充的，订阅里会先立刻发一次、再等 voiceschanged
  useEffect(() => subscribeVoices(setVoices), [])
  // 离开这一页就别继续念了
  useEffect(() => stopSpeaking, [])

  // 系统音色动辄上百个，平铺着找太费劲：按语种收进二级菜单，
  // 父项右侧还会挂上该语种下已选的那个音色，收起时也知道选的是谁
  const voiceOptions: SelectOption[] = useMemo(() => {
    const groups = new Map<string, SelectOption[]>()
    for (const voice of voices) {
      const tag = voice.lang || '未知语种'
      const item: SelectOption = { value: voice.voiceURI, label: voice.name }
      const bucket = groups.get(tag)
      if (bucket) bucket.push(item)
      else groups.set(tag, [item])
    }

    const rank = (tag: string) => {
      const index = PREFERRED_LANGS.indexOf(tag.split('-')[0].toLowerCase())
      return index === -1 ? PREFERRED_LANGS.length : index
    }

    return [
      { value: '', label: '跟随朗读语言自动选择' },
      ...[...groups.entries()]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([tag, children]) => ({ value: `lang:${tag}`, label: langLabel(tag), children })),
    ]
  }, [voices])

  if (!isSpeechSupported()) {
    return (
      <NoteCard title="语音朗读" icon={Volume2}>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          当前环境没有提供语音合成能力（缺少 <code className="font-mono">speechSynthesis</code>），
          朗读按钮会提示不可用。桌面端与多数浏览器不受影响。
        </p>
      </NoteCard>
    )
  }

  // 试听文案跟着所选音色的语种走，否则用中文音色念英文会很怪
  const pickedVoice = voices.find((voice) => voice.voiceURI === settings.voiceURI)
  const speakLang = pickedVoice?.lang ?? 'zh-CN'
  const sampleText = speakLang.toLowerCase().startsWith('zh')
    ? '这是一段朗读试听，语速与音调都可以在下面调整。'
    : 'This is a speech preview. You can tune the rate and pitch below.'

  return (
    <div className="space-y-4">
      <NoteCard title="朗读音色" icon={Volume2}>
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>音色</label>
            <Select
              value={settings.voiceURI}
              onChange={(value) => saveSpeechSettings({ voiceURI: value })}
              options={voiceOptions}
              className="w-full mt-1.5"
              placeholder="跟随朗读语言自动选择"
              title="朗读用的系统音色"
            />
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
              音色来自操作系统自带的语音引擎（这里没有任何音频文件）。
              不指定时浏览器会用它最默认的那个，多数系统上恰好是最机械的一个 ——
              挑一个自然些的通常立竿见影。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SettingSlider
              label="语速"
              hint="0.5 慢 · 2.0 快"
              value={settings.rate}
              min={SPEECH_LIMITS.rate.min}
              max={SPEECH_LIMITS.rate.max}
              step={SPEECH_LIMITS.rate.step}
              onChange={(rate) => saveSpeechSettings({ rate })}
            />
            <SettingSlider
              label="音调"
              hint="越低越沉稳"
              value={settings.pitch}
              min={SPEECH_LIMITS.pitch.min}
              max={SPEECH_LIMITS.pitch.max}
              step={SPEECH_LIMITS.pitch.step}
              onChange={(pitch) => saveSpeechSettings({ pitch })}
            />
            <SettingSlider
              label="音量"
              hint="相对系统音量"
              value={settings.volume}
              min={SPEECH_LIMITS.volume.min}
              max={SPEECH_LIMITS.volume.max}
              step={SPEECH_LIMITS.volume.step}
              onChange={(volume) => saveSpeechSettings({ volume })}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => speak(sampleText, speakLang)}
              className="tool-button-secondary h-8"
            >
              <Play size={13} />
              <span>试听</span>
            </button>
            <Tooltip content="恢复默认音色与参数">
              <button
                type="button"
                onClick={() => {
                  stopSpeaking()
                  setSettings(saveSpeechSettings(SPEECH_DEFAULTS))
                }}
                className="tool-button-secondary h-8"
              >
                <RotateCcw size={13} />
                <span>恢复默认</span>
              </button>
            </Tooltip>
            {voices.length === 0 && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                系统还没返回音色列表，稍等片刻
              </span>
            )}
          </div>
        </div>
      </NoteCard>
    </div>
  )
}
