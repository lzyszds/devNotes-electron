import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Copy,
  History,
  Palette,
  Pipette,
} from 'lucide-react'
import {
  BTN,
  CARD_BODY,
  ToolCard,
  ToolCardHeader,
  ToolHistoryOverlay,
  ToolShell,
} from '../ui'
import { useToast } from '../ui/Toast'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import { copyText } from '../../utils/clipboard'

/* ---------------- 颜色空间数学计算 ---------------- */

interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

function rgbToHex({ r, g, b, a }: RGBA): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`
  if (a < 1) {
    const alphaHex = Math.round(a * 255).toString(16).padStart(2, '0')
    return `${base}${alphaHex}`.toUpperCase()
  }
  return base.toUpperCase()
}

function hexToRgba(hex: string): RGBA | null {
  let cleaned = hex.trim().replace(/^#/, '')
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map((c) => c + c).join('')
  } else if (cleaned.length === 4) {
    cleaned = cleaned.split('').map((c) => c + c).join('')
  }

  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16)
    const g = parseInt(cleaned.slice(2, 4), 16)
    const b = parseInt(cleaned.slice(4, 6), 16)
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null
    return { r, g, b, a: 1 }
  }

  if (cleaned.length === 8) {
    const r = parseInt(cleaned.slice(0, 2), 16)
    const g = parseInt(cleaned.slice(2, 4), 16)
    const b = parseInt(cleaned.slice(4, 6), 16)
    const a = parseInt(cleaned.slice(6, 8), 16) / 255
    if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) return null
    return { r, g, b, a: Number(a.toFixed(2)) }
  }

  return null
}

function rgbToHsl({ r, g, b, a }: RGBA): { h: number; s: number; l: number; a: number } {
  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255

  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)
        break
      case gNorm:
        h = (bNorm - rNorm) / d + 2
        break
      case bNorm:
        h = (rNorm - gNorm) / d + 4
        break
    }
    h /= 6
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
    a,
  }
}

/** 计算相对亮度（Relative Luminance, WCAG 2.1） */
function getLuminance({ r, g, b }: RGBA): number {
  const a = [r, g, b].map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722
}

/** 计算两种颜色之间的对比度（Contrast Ratio: 1 到 21） */
function getContrastRatio(fg: RGBA, bg: RGBA): number {
  const lum1 = getLuminance(fg)
  const lum2 = getLuminance(bg)
  const brightest = Math.max(lum1, lum2)
  const darkest = Math.min(lum1, lum2)
  return Number(((brightest + 0.05) / (darkest + 0.05)).toFixed(2))
}

/** 估算近似 OKLCH 颜色 */
function rgbToOklch({ r, g, b }: RGBA): string {
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const lightness = Number(l.toFixed(2))
  const chroma = Number(((Math.max(r, g, b) - Math.min(r, g, b)) / 255) * 0.35).toFixed(2)
  const hsl = rgbToHsl({ r, g, b, a: 1 })
  return `oklch(${lightness} ${chroma} ${hsl.h})`
}

/* 预设调色板 */
const PALETTE_PRESETS = [
  { name: 'Indigo', hex: '#4F46E5' },
  { name: 'Sky Blue', hex: '#0EA5E9' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Notion Gray', hex: '#191918' },
  { name: 'Warm Paper', hex: '#F7F6F3' },
  { name: 'Zinc Dark', hex: '#27272A' },
]

/* 经典阴影预设 */
const SHADOW_PRESETS = [
  { name: '极简细边', x: 0, y: 1, blur: 3, spread: 0, alpha: 0.08 },
  { name: '暖灰卡片', x: 0, y: 4, blur: 12, spread: -2, alpha: 0.12 },
  { name: '浮空模态', x: 0, y: 20, blur: 25, spread: -5, alpha: 0.18 },
  { name: '立体硬阴影', x: 4, y: 4, blur: 0, spread: 0, alpha: 0.9 },
]

/**
 * CSS 颜色与设计工具：
 * 提供颜色空间全格式互转、原生吸管、WCAG 无障碍可读性校验与 Box-Shadow 阴影调节。
 */
export default function ColorPaletteTool() {
  const { showToast } = useToast()
  const [color, setColor] = useState<RGBA>({ r: 79, g: 70, b: 229, a: 1 })
  const [hexInput, setHexInput] = useState('#4F46E5')
  const [showHistory, setShowHistory] = useState(false)

  // 阴影调节器状态
  const [shadowX, setShadowX] = useState(0)
  const [shadowY, setShadowY] = useState(8)
  const [shadowBlur, setShadowBlur] = useState(24)
  const [shadowSpread, setShadowSpread] = useState(-4)
  const [shadowAlpha, setShadowAlpha] = useState(0.15)
  const [shadowInset, setShadowInset] = useState(false)

  // 历史记录
  const { history, saveHistory, clearHistory, removeHistoryItem } =
    useToolHistory<string>('color-palette')
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      const parsed = hexToRgba(item.data)
      if (parsed) {
        setColor(parsed)
        setHexInput(rgbToHex(parsed))
      }
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  // 派生格式
  const hexValue = useMemo(() => rgbToHex(color), [color])
  const hslValue = useMemo(() => {
    const { h, s, l, a } = rgbToHsl(color)
    return a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${a})` : `hsl(${h}, ${s}%, ${l}%)`
  }, [color])
  const rgbValue = useMemo(() => {
    return color.a < 1
      ? `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`
      : `rgb(${color.r}, ${color.g}, ${color.b})`
  }, [color])
  const oklchValue = useMemo(() => rgbToOklch(color), [color])

  // 无障碍对比度
  const whiteRatio = useMemo(() => getContrastRatio(color, { r: 255, g: 255, b: 255, a: 1 }), [color])
  const darkRatio = useMemo(() => getContrastRatio(color, { r: 25, g: 25, b: 24, a: 1 }), [color])

  // 阴影 CSS
  const shadowCss = useMemo(() => {
    const insetStr = shadowInset ? 'inset ' : ''
    return `box-shadow: ${insetStr}${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowSpread}px rgba(0, 0, 0, ${shadowAlpha});`
  }, [shadowX, shadowY, shadowBlur, shadowSpread, shadowAlpha, shadowInset])

  // 更新颜色并记录历史
  const updateColor = useCallback((next: RGBA) => {
    setColor(next)
    const nextHex = rgbToHex(next)
    setHexInput(nextHex)
  }, [])

  // 保存到历史（防抖）
  useEffect(() => {
    const timer = setTimeout(() => {
      saveHistory(hexValue, hexValue)
    }, 600)
    return () => clearTimeout(timer)
  }, [hexValue, saveHistory])

  // 调用浏览器原生吸管
  const handleEyeDropper = async () => {
    if (typeof window !== 'undefined' && 'EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper()
        const result = await eyeDropper.open()
        if (result?.sRGBHex) {
          const parsed = hexToRgba(result.sRGBHex)
          if (parsed) {
            updateColor(parsed)
            showToast(`已吸取颜色：${result.sRGBHex}`, 'default')
          }
        }
      } catch {
        // 用户取消或未授权
      }
    } else {
      showToast('当前环境不支持屏幕吸管 API', 'error')
    }
  }

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyText(text)
    showToast(ok ? `已复制 ${label}` : '复制失败', ok ? 'default' : 'error')
  }

  return (
    <ToolShell
      icon={Palette}
      title="CSS 颜色与设计"
      badge="Color & Design"
      actions={
        <>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className={`${BTN.secondary} h-8 px-3`}
          >
            <History size={14} />
            <span>历史</span>
          </button>
        </>
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="调色历史库"
          items={history}
          onClear={clearHistory}
          onDelete={removeHistoryItem}
          onPick={(item) => {
            const parsed = hexToRgba(item.data)
            if (parsed) {
              updateColor(parsed)
            }
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
          renderItemTitle={(item) => (
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-4 rounded-md border border-[#E6E6E3] shrink-0"
                style={{ backgroundColor: item.data }}
              />
              <span className="font-mono font-medium">{item.data}</span>
            </div>
          )}
        />
      }
    >
      <div className="tool-cascade grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ================= 左侧：取色与格式换算 ================= */}
        <div className="flex flex-col gap-4">
          <ToolCard>
            <ToolCardHeader
              title="颜色调节与转换"
              actions={
                <div className="flex items-center gap-1.5">
                  {'EyeDropper' in (typeof window !== 'undefined' ? window : {}) && (
                    <button
                      type="button"
                      onClick={handleEyeDropper}
                      className="inline-flex items-center gap-1 text-xs text-[#191918] bg-[#F3F3F1] hover:bg-[#EAEAE7] border border-[#E6E6E3] px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                    >
                      <Pipette size={13} />
                      <span>屏幕吸管</span>
                    </button>
                  )}
                </div>
              }
            />
            <div className={CARD_BODY}>
              {/* 大色块展示与原生选择器 */}
              <div className="flex gap-4 items-center mb-4">
                <div className="relative w-24 h-24 rounded-2xl border border-[#E6E6E3] shadow-inner overflow-hidden shrink-0 group">
                  {/* 透明网格棋盘底图 */}
                  <div
                    className="absolute inset-0 bg-[linear-gradient(45deg,#EFEFEF_25%,transparent_25%),linear-gradient(-45deg,#EFEFEF_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#EFEFEF_75%),linear-gradient(-45deg,transparent_75%,#EFEFEF_75%)] bg-[size:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0]"
                  />
                  {/* 实际色彩层 */}
                  <div
                    className="absolute inset-0 transition-colors"
                    style={{ backgroundColor: rgbValue }}
                  />
                  <input
                    type="color"
                    value={hexValue.slice(0, 7)}
                    onChange={(e) => {
                      const next = hexToRgba(e.target.value)
                      if (next) updateColor({ ...next, a: color.a })
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    title="点击调出色盘"
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none text-white text-[10px] font-medium">
                    选色
                  </div>
                </div>

                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#787774] w-12 shrink-0">HEX</span>
                    <input
                      type="text"
                      value={hexInput}
                      onChange={(e) => {
                        setHexInput(e.target.value)
                        const parsed = hexToRgba(e.target.value)
                        if (parsed) setColor(parsed)
                      }}
                      className="flex-1 h-8 px-2.5 rounded-lg border border-[#E6E6E3] text-xs font-mono text-[#191918] bg-white outline-none focus:border-[#1C1C1C]"
                    />
                  </div>

                  {/* 透明度滑动条 */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#787774] w-12 shrink-0">Alpha</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={color.a}
                      onChange={(e) => updateColor({ ...color, a: parseFloat(e.target.value) })}
                      className="flex-1 h-1.5 accent-[#1C1C1C] cursor-pointer"
                    />
                    <span className="text-xs font-mono text-[#787774] w-10 text-right">
                      {Math.round(color.a * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* 格式转换列表 */}
              <div className="space-y-2 border-t border-[#E6E6E3] pt-3">
                {[
                  { label: 'HEX', val: hexValue },
                  { label: 'RGB', val: rgbValue },
                  { label: 'HSL', val: hslValue },
                  { label: 'OKLCH', val: oklchValue },
                  { label: 'CSS Var', val: `--color: ${hexValue};` },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between p-2 rounded-lg bg-[#FBFBFA] border border-[#E6E6E3] text-xs"
                  >
                    <span className="font-semibold text-[#787774] w-16">{item.label}</span>
                    <code className="flex-1 font-mono text-[#191918] truncate px-2 select-all">
                      {item.val}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(item.val, item.label)}
                      className="h-6 w-6 rounded flex items-center justify-center text-[#787774] hover:text-[#191918] hover:bg-white transition-colors cursor-pointer"
                      title="复制"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                ))}
              </div>

              {/* 推荐预设色彩 */}
              <div className="mt-4 pt-3 border-t border-[#E6E6E3]">
                <div className="text-[11px] font-semibold text-[#787774] mb-2">常用设计预设</div>
                <div className="flex flex-wrap gap-2">
                  {PALETTE_PRESETS.map((p) => (
                    <button
                      key={p.hex}
                      type="button"
                      onClick={() => {
                        const parsed = hexToRgba(p.hex)
                        if (parsed) updateColor(parsed)
                      }}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#E6E6E3] bg-white hover:bg-[#F3F3F1] transition-all cursor-pointer text-xs"
                    >
                      <span
                        className="w-3 h-3 rounded-full border border-black/10 shrink-0"
                        style={{ backgroundColor: p.hex }}
                      />
                      <span className="text-[11px] text-[#191918]">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </ToolCard>

          {/* ================= 无障碍对比度卡片 ================= */}
          <ToolCard>
            <ToolCardHeader title="WCAG 2.1 无障碍色彩可读性评分" />
            <div className={CARD_BODY}>
              <div className="grid grid-cols-2 gap-3">
                {/* 与纯白对比 */}
                <div
                  className="p-3.5 rounded-xl border border-[#E6E6E3] flex flex-col justify-between h-28 transition-colors"
                  style={{ backgroundColor: rgbValue, color: '#FFFFFF' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">白字预览 (White)</span>
                    <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-black/20">
                      {whiteRatio} : 1
                    </span>
                  </div>
                  <div className="text-[11px] opacity-90">正文可读性演示文本</div>
                  <div className="flex gap-1.5 text-[10px]">
                    <span
                      className={`px-1 rounded ${
                        whiteRatio >= 4.5 ? 'bg-emerald-500/80 text-white' : 'bg-rose-500/80 text-white'
                      }`}
                    >
                      AA {whiteRatio >= 4.5 ? '通过' : '未通过'}
                    </span>
                    <span
                      className={`px-1 rounded ${
                        whiteRatio >= 7 ? 'bg-emerald-500/80 text-white' : 'bg-black/30 text-white'
                      }`}
                    >
                      AAA {whiteRatio >= 7 ? '通过' : '未达标'}
                    </span>
                  </div>
                </div>

                {/* 与暖黑对比 */}
                <div
                  className="p-3.5 rounded-xl border border-[#E6E6E3] flex flex-col justify-between h-28 transition-colors"
                  style={{ backgroundColor: rgbValue, color: '#191918' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">黑字预览 (Dark)</span>
                    <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-black/10">
                      {darkRatio} : 1
                    </span>
                  </div>
                  <div className="text-[11px] opacity-90">正文可读性演示文本</div>
                  <div className="flex gap-1.5 text-[10px]">
                    <span
                      className={`px-1 rounded ${
                        darkRatio >= 4.5 ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                      }`}
                    >
                      AA {darkRatio >= 4.5 ? '通过' : '未通过'}
                    </span>
                    <span
                      className={`px-1 rounded ${
                        darkRatio >= 7 ? 'bg-emerald-600 text-white' : 'bg-black/20 text-[#191918]'
                      }`}
                    >
                      AAA {darkRatio >= 7 ? '通过' : '未达标'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </ToolCard>
        </div>

        {/* ================= 右侧：Box-Shadow 阴影调节器 ================= */}
        <div className="flex flex-col gap-4">
          <ToolCard>
            <ToolCardHeader
              title="CSS Box-Shadow 阴影可视化生成器"
              actions={
                <button
                  type="button"
                  onClick={() => handleCopy(shadowCss, '阴影 CSS 代码')}
                  className="inline-flex items-center gap-1 text-xs text-[#191918] bg-[#F3F3F1] hover:bg-[#EAEAE7] border border-[#E6E6E3] px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                >
                  <Copy size={13} />
                  <span>复制 CSS</span>
                </button>
              }
            />
            <div className={CARD_BODY}>
              {/* 实时阴影预览区 */}
              <div className="h-44 rounded-xl border border-[#E6E6E3] bg-[#FBFBFA] flex items-center justify-center p-6 mb-4">
                <div
                  className="w-32 h-20 rounded-xl bg-white border border-[#E6E6E3] flex items-center justify-center text-xs font-semibold text-[#191918] transition-all"
                  style={{
                    boxShadow: `${shadowInset ? 'inset ' : ''}${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowSpread}px rgba(0, 0, 0, ${shadowAlpha})`,
                  }}
                >
                  阴影卡片
                </div>
              </div>

              {/* 滑块调节面板 */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[#787774] w-20">X 轴偏移</span>
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    value={shadowX}
                    onChange={(e) => setShadowX(Number(e.target.value))}
                    className="flex-1 h-1.5 accent-[#1C1C1C] cursor-pointer"
                  />
                  <span className="text-xs font-mono text-[#787774] w-12 text-right">{shadowX}px</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[#787774] w-20">Y 轴偏移</span>
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    value={shadowY}
                    onChange={(e) => setShadowY(Number(e.target.value))}
                    className="flex-1 h-1.5 accent-[#1C1C1C] cursor-pointer"
                  />
                  <span className="text-xs font-mono text-[#787774] w-12 text-right">{shadowY}px</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[#787774] w-20">模糊半径 (Blur)</span>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    value={shadowBlur}
                    onChange={(e) => setShadowBlur(Number(e.target.value))}
                    className="flex-1 h-1.5 accent-[#1C1C1C] cursor-pointer"
                  />
                  <span className="text-xs font-mono text-[#787774] w-12 text-right">{shadowBlur}px</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[#787774] w-20">扩散半径 (Spread)</span>
                  <input
                    type="range"
                    min={-20}
                    max={30}
                    value={shadowSpread}
                    onChange={(e) => setShadowSpread(Number(e.target.value))}
                    className="flex-1 h-1.5 accent-[#1C1C1C] cursor-pointer"
                  />
                  <span className="text-xs font-mono text-[#787774] w-12 text-right">{shadowSpread}px</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[#787774] w-20">不透明度</span>
                  <input
                    type="range"
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={shadowAlpha}
                    onChange={(e) => setShadowAlpha(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 accent-[#1C1C1C] cursor-pointer"
                  />
                  <span className="text-xs font-mono text-[#787774] w-12 text-right">
                    {Math.round(shadowAlpha * 100)}%
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#E6E6E3]">
                  <label className="flex items-center gap-2 text-xs font-medium text-[#191918] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shadowInset}
                      onChange={(e) => setShadowInset(e.target.checked)}
                      className="rounded accent-[#1C1C1C]"
                    />
                    <span>内阴影 (inset)</span>
                  </label>

                  <div className="flex gap-1.5">
                    {SHADOW_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          setShadowX(preset.x)
                          setShadowY(preset.y)
                          setShadowBlur(preset.blur)
                          setShadowSpread(preset.spread)
                          setShadowAlpha(preset.alpha)
                          setShadowInset(false)
                        }}
                        className="px-2 py-0.5 rounded text-[11px] bg-[#F3F3F1] hover:bg-[#EAEAE7] text-[#191918] border border-[#E6E6E3] transition-colors cursor-pointer"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 生成的代码预览 */}
              <div className="mt-4 p-2.5 rounded-lg bg-[#191918] text-white font-mono text-xs select-all">
                <code>{shadowCss}</code>
              </div>
            </div>
          </ToolCard>
        </div>
      </div>
    </ToolShell>
  )
}
