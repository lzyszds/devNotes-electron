import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

/*
 * 数据格式互转。统一先解析成 JS 值，再序列化成目标格式：
 * JSON / YAML / TOML 是任意嵌套结构；CSV 是对象数组；.env 与 URL Query 是扁平对象。
 */

export type DataFormat = 'json' | 'yaml' | 'toml' | 'csv' | 'env' | 'query'

export const DATA_FORMATS: { id: DataFormat; label: string }[] = [
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'csv', label: 'CSV' },
  { id: 'env', label: '.env' },
  { id: 'query', label: 'URL Query' },
]

type Value = unknown

/* ---------------- CSV ---------------- */

/** 轻量 CSV 解析：支持双引号包裹、引号转义（""）和字段内换行；第一行作为表头 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (quoted) throw new Error('CSV 里有没闭合的双引号')
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

function parseCsv(text: string): Value {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return []
  const [header, ...body] = rows
  return body.map((cells) => {
    const obj: Record<string, string> = {}
    header.forEach((key, i) => {
      obj[key] = cells[i] ?? ''
    })
    return obj
  })
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function stringifyCsv(value: Value): string {
  const list = Array.isArray(value) ? value : [value]
  const headers: string[] = []
  for (const item of list) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const key of Object.keys(item)) if (!headers.includes(key)) headers.push(key)
    }
  }
  if (headers.length === 0) throw new Error('CSV 需要对象数组，例如 [{"name":"a"}]')
  const lines = [headers.map(csvCell).join(',')]
  for (const item of list) {
    const obj = (item ?? {}) as Record<string, unknown>
    lines.push(headers.map((h) => csvCell(obj[h])).join(','))
  }
  return lines.join('\n')
}

/* ---------------- .env ---------------- */

function parseEnv(text: string): Value {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line)
    if (!match) throw new Error(`无法解析这一行：${line}`)
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      // 未加引号时去掉行尾注释（前面有空格的 #）
      value = value.replace(/\s+#.*$/, '').trim()
    }
    out[match[1]] = value
  }
  return out
}

function stringifyEnv(value: Value): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('.env 需要一个扁平对象')
  return Object.entries(value as Record<string, unknown>)
    .map(([key, val]) => {
      const text = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
      return /[\s#"'$`\\]/.test(text) || text === '' ? `${key}="${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : `${key}=${text}`
    })
    .join('\n')
}

/* ---------------- URL Query ---------------- */

/** 接受完整 URL、以 ? 开头的串，或裸的 a=1&b=2；重复的键合并成数组 */
function parseQuery(text: string): Value {
  let query = text.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(query)) {
    query = new URL(query).search
  }
  query = query.replace(/^\?/, '').replace(/#.*$/, '')
  const params = new URLSearchParams(query)
  const out: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    out[key] = all.length > 1 ? all : all[0]
  }
  return out
}

function stringifyQuery(value: Value): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('URL Query 需要一个扁平对象')
  const params = new URLSearchParams()
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(val)) {
      val.forEach((item) => params.append(key, typeof item === 'object' ? JSON.stringify(item) : String(item)))
    } else if (val !== null && typeof val === 'object') {
      params.append(key, JSON.stringify(val))
    } else {
      params.append(key, val === null || val === undefined ? '' : String(val))
    }
  }
  return params.toString()
}

/* ---------------- 统一入口 ---------------- */

export function parseData(text: string, format: DataFormat): Value {
  if (!text.trim()) throw new Error('输入为空')
  switch (format) {
    case 'json':
      return JSON.parse(text)
    case 'yaml':
      return parseYaml(text)
    case 'toml':
      return parseToml(text)
    case 'csv':
      return parseCsv(text)
    case 'env':
      return parseEnv(text)
    case 'query':
      return parseQuery(text)
  }
}

export function stringifyData(value: Value, format: DataFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(value, null, 2)
    case 'yaml':
      return stringifyYaml(value)
    case 'toml':
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TOML 需要顶层是对象')
      return stringifyToml(value as Record<string, unknown>)
    case 'csv':
      return stringifyCsv(value)
    case 'env':
      return stringifyEnv(value)
    case 'query':
      return stringifyQuery(value)
  }
}

/** 根据内容猜输入格式，猜不准时返回 null，由用户手动选 */
export function guessFormat(text: string): DataFormat | null {
  const t = text.trim()
  if (!t) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^\?/.test(t)) return 'query'
  if (/^[\[{]/.test(t)) {
    try {
      JSON.parse(t)
      return 'json'
    } catch {
      // 不是合法 JSON，继续往下猜
    }
  }
  if (/^[\w.-]+=[^\n&]*(&[\w.-]+=[^\n&]*)+$/.test(t)) return 'query'
  if (/^[A-Za-z_][A-Za-z0-9_.-]*=/m.test(t) && !/[{:]\s/.test(t.split('\n')[0] ?? '')) return 'env'
  if (/^\s*\[[^\]]+\]\s*$/m.test(t) || /^[\w.-]+\s*=\s*.+$/m.test(t)) return 'toml'
  if (/^[\w-]+\s*:\s*/m.test(t)) return 'yaml'
  if (t.includes(',') && t.split('\n').length > 1) return 'csv'
  return null
}
