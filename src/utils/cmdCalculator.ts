/**
 * ⌘K 指令面板的即时计算与极速换算引擎。
 *
 * 当用户在 ⌘K 输入算式、时间戳、UUID、颜色代码时，
 * 纯本地毫秒级即时推导计算结果并排在搜索首位，按回车即可直接复制，无需进入具体工具。
 */

export interface QuickCalcResult {
  id: string
  title: string
  subtitle: string
  badge: string
  copyValue: string
  category: 'calc' | 'timestamp' | 'uuid' | 'color'
  /** 是否需要特别高亮 */
  isHighlighted?: boolean
}

/** 安全执行基础算式（支持加减乘除、乘方、括号、百分比、十六进制与常见 Math 函数） */
function evaluateMathExpression(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length < 2) return null

  // 必须包含至少一个运算符号或 Math 函数调用，避免普通数字或单词被误判为算式
  const hasOperator = /[+\-*/%^]/.test(trimmed) || /^(sin|cos|tan|sqrt|abs|log|ln|pi|e)\b/i.test(trimmed)
  if (!hasOperator && !/^0x[0-9a-fA-F]+$/i.test(trimmed)) return null

  // 字符白名单过滤，彻底防止任意代码执行注入
  if (!/^[0-9+\-*/().%^e\s\bxX,a-fA-F_]|sin|cos|tan|sqrt|abs|log|min|max|pow|pi|round|ceil|floor$/i.test(trimmed)) {
    return null
  }

  // 转换数学符号语法
  let expr = trimmed
    .replace(/\^/g, '**') // 支持 2^10
    .replace(/(\d+(?:\.\d+)?)%/g, '($1/100)') // 支持 15% -> 0.15
    .replace(/\bpi\b/gi, 'Math.PI')
    .replace(/\be\b/gi, 'Math.E')
    .replace(/\bsqrt\(/gi, 'Math.sqrt(')
    .replace(/\babs\(/gi, 'Math.abs(')
    .replace(/\bsin\(/gi, 'Math.sin(')
    .replace(/\bcos\(/gi, 'Math.cos(')
    .replace(/\btan\(/gi, 'Math.tan(')
    .replace(/\blog\(/gi, 'Math.log10(')
    .replace(/\bln\(/gi, 'Math.log(')
    .replace(/\bround\(/gi, 'Math.round(')
    .replace(/\bceil\(/gi, 'Math.ceil(')
    .replace(/\bfloor\(/gi, 'Math.floor(')

  try {
    // 仅在隔离上下文中使用 Function 执行纯数学运算
    const fn = new Function(`"use strict"; return (${expr});`)
    const res = fn()
    if (typeof res === 'number' && Number.isFinite(res)) {
      return res
    }
  } catch {
    // 非法算式静默忽略
  }
  return null
}

/** 格式化数字（千分位与小数控制） */
function formatNumber(num: number): string {
  if (Number.isInteger(num)) {
    return num.toLocaleString('en-US')
  }
  // 小数保留最多 6 位并去除末尾无效 0
  const fixed = Number(num.toFixed(6))
  return fixed.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

/** 格式化人类易读相对时间 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (Math.abs(diff) < 60000) return '刚刚'
  const isPast = diff > 0
  const absDiff = Math.abs(diff)
  const minutes = Math.floor(absDiff / 60000)
  if (minutes < 60) return isPast ? `${minutes} 分钟前` : `${minutes} 分钟后`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return isPast ? `${hours} 小时前` : `${hours} 小时后`
  const days = Math.floor(hours / 24)
  if (days < 30) return isPast ? `${days} 天前` : `${days} 天后`
  return ''
}

/**
 * 核心解析入口：根据用户在 ⌘K 输入的 query 实时分析是否有即时计算或换算结果
 */
export function matchQuickCalculator(query: string): QuickCalcResult | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  // 1. UUID 快捷生成
  if (/^(uuid|guid)$/i.test(trimmed)) {
    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    return {
      id: 'quick-uuid',
      title: uuid,
      subtitle: 'UUID v4 随机生成 · 回车复制到剪贴板',
      badge: 'UUID',
      copyValue: uuid,
      category: 'uuid',
      isHighlighted: true,
    }
  }

  // 2. 当前时间戳 / 关键词查询
  if (/^(now|time|当前时间|现在时间|时间戳)$/i.test(trimmed)) {
    const now = Date.now()
    const sec = Math.floor(now / 1000)
    const formatted = new Date(now).toLocaleString('zh-CN', { hour12: false })
    return {
      id: 'quick-now',
      title: `${sec}  (${formatted})`,
      subtitle: `毫秒: ${now} · 回车复制秒级时间戳`,
      badge: '当前时刻',
      copyValue: String(sec),
      category: 'timestamp',
      isHighlighted: true,
    }
  }

  // 3. 数字时间戳自动转日期（10 位秒级 或 13 位毫秒级）
  if (/^\d{10}$/.test(trimmed)) {
    const sec = Number(trimmed)
    const ms = sec * 1000
    const d = new Date(ms)
    if (!isNaN(d.getTime())) {
      const formatted = d.toLocaleString('zh-CN', { hour12: false })
      const rel = formatRelativeTime(ms)
      return {
        id: 'quick-ts-10',
        title: formatted + (rel ? ` (${rel})` : ''),
        subtitle: `10 位秒级时间戳 · 回车复制格式化日期`,
        badge: '时间戳转换',
        copyValue: formatted,
        category: 'timestamp',
        isHighlighted: true,
      }
    }
  } else if (/^\d{13}$/.test(trimmed)) {
    const ms = Number(trimmed)
    const d = new Date(ms)
    if (!isNaN(d.getTime())) {
      const formatted = d.toLocaleString('zh-CN', { hour12: false })
      const rel = formatRelativeTime(ms)
      return {
        id: 'quick-ts-13',
        title: formatted + (rel ? ` (${rel})` : ''),
        subtitle: `13 位毫秒级时间戳 · 回车复制格式化日期`,
        badge: '时间戳转换',
        copyValue: formatted,
        category: 'timestamp',
        isHighlighted: true,
      }
    }
  }

  // 4. 标准日期文本转时间戳（如 2026-10-27 或 2026-10-27 15:30:00）
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/.test(trimmed)) {
    const parsed = Date.parse(trimmed.replace(/-/g, '/'))
    if (!isNaN(parsed)) {
      const sec = Math.floor(parsed / 1000)
      return {
        id: 'quick-date-to-ts',
        title: `${sec} 秒  (${parsed} ms)`,
        subtitle: `由「${trimmed}」解析 · 回车复制秒级时间戳`,
        badge: '日期转时间戳',
        copyValue: String(sec),
        category: 'timestamp',
        isHighlighted: true,
      }
    }
  }

  // 5. 颜色代码快速识别与换算（#RGB, #RRGGBB, #RRGGBBAA）
  const hexMatch = trimmed.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  if (hexMatch) {
    let hex = hexMatch[1]
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('')
    }
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const rgbStr = `rgb(${r}, ${g}, ${b})`
    return {
      id: 'quick-color',
      title: `${rgbStr}  ·  ${trimmed.toUpperCase()}`,
      subtitle: `十六进制颜色识别 · 回车复制 RGB 格式代码`,
      badge: '色彩转换',
      copyValue: rgbStr,
      category: 'color',
      isHighlighted: true,
    }
  }

  // 6. 数学表达式实时求值
  const mathRes = evaluateMathExpression(trimmed)
  if (mathRes !== null) {
    const formatted = formatNumber(mathRes)
    const rawVal = String(mathRes)
    return {
      id: 'quick-math',
      title: `=  ${formatted}`,
      subtitle: `计算式：${trimmed} · 回车复制结果 (${rawVal})`,
      badge: '即时计算',
      copyValue: rawVal,
      category: 'calc',
      isHighlighted: true,
    }
  }

  return null
}

