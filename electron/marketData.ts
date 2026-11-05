import crypto from 'node:crypto'
import { fetchViaNet } from './proxy'

export type MarketKind = 'contract' | 'spot'
export interface MarketQuote {
  symbol: string
  name: string
  kind: MarketKind
  asset: 'crypto' | 'equity'
  price: number
  changePercent: number
  change: number
  currency: string
  fundingRate?: number
  openInterest?: number
  high24h?: number
  low24h?: number
  markPrice?: number
  nextFundingTime?: number
  fundingIntervalHours?: number
  turnover24h?: number
  longRatio?: number
  updatedAt: number
}

export interface MarketNewsItem { title: string; url: string; source: string; publishedAt: string }

export interface GatePosition {
  contract: string
  symbol: string
  mode: string
  side: 'long' | 'short'
  size: number
  value: number
  entryPrice: number
  markPrice: number
  unrealisedPnl: number
  pnlPercent: number
  leverage: number
  liqPrice: number
  margin: number
}

export interface GateSpotBalance {
  currency: string
  available: number
  locked: number
}

export const SYMBOL_NAMES: Record<string, string> = {
  MU: '美光科技',
  MSFT: '微软',
  SPCX: 'SpaceX 合成',
  TSLA: '特斯拉',
  NVDA: '英伟达',
  AAPL: '苹果',
  AMZN: '亚马逊',
  GOOG: '谷歌',
  GOOGL: '谷歌',
  META: 'Meta',
  BTC: '比特币',
  ETH: '以太坊',
  SOL: 'Solana',
}

/*
 * 资产/持仓/现货三个接口各自独立成败：成功的字段照实给（0 与空数组是真值），
 * 失败的字段置 null 并记录原因。渲染层据此区分「真实空仓」与「没拿到数据」，
 * 绝不能把失败折成 0 展示成零资产。null 也不会进 JSON 序列化缓存。
 */
export interface GateAccountData {
  total: number | null
  available: number | null
  unrealisedPnl: number | null
  openPositions: GatePosition[] | null
  spotBalances: GateSpotBalance[] | null
  balanceError?: string
  positionError?: string
  spotError?: string
  partial?: boolean
  updatedAt: number
}

const cache = new Map<string, { at: number; data: MarketQuote[] }>()
const newsCache = new Map<string, { at: number; data: MarketNewsItem[] }>()
const STOCK_SYMBOL = /^(sh|sz|hk)[0-9]{4,6}$/i
const SYMBOL = /^[A-Z0-9]{2,32}$/

/* 凭据只由主进程从系统钥匙串解密后注入；公开行情不携带签名，避免账户配置影响公共数据。 */
let gateApiKey = ''
let gateApiSecret = ''

export function setGateCredentials(key: string, secret: string) {
  gateApiKey = key.trim()
  gateApiSecret = secret.trim()
}

export function hasGateCredentials() {
  return Boolean(gateApiKey && gateApiSecret)
}

/**
 * 凭据代际：每次保存/清除都自增。调用方先取号、拿到账户结果后再比对，
 * 避免旧凭据发起的慢请求在换 Key 之后才回来，把上一个账户的数据刷到界面上。
 */
let gateCredentialGeneration = 0

export function getGateCredentialGeneration() {
  return gateCredentialGeneration
}

export function invalidateGateCredentialGeneration() {
  gateCredentialGeneration++
  return gateCredentialGeneration
}

/** 生成 Gate.io V4 API 签名 Headers */
function getGateAuthHeaders(urlStr: string, method = 'GET', body = ''): Record<string, string> {
  if (!gateApiKey || !gateApiSecret) return {}
  try {
    const parsed = new URL(urlStr)
    const t = Math.floor(Date.now() / 1000)
    const urlPath = parsed.pathname
    const queryString = parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search
    const hashedPayload = crypto.createHash('sha512').update(body).digest('hex')
    const signatureString = `${method}\n${urlPath}\n${queryString}\n${hashedPayload}\n${t}`
    const sign = crypto.createHmac('sha512', gateApiSecret).update(signatureString).digest('hex')
    return {
      KEY: gateApiKey,
      Timestamp: String(t),
      SIGN: sign,
    }
  } catch {
    return {}
  }
}

async function getJson<T>(url: string, authenticated = false): Promise<T> {
  const authHeaders = authenticated ? getGateAuthHeaders(url, 'GET') : {}
  const response = await fetchViaNet({
    url,
    timeout: 6000,
    headers: {
      Accept: 'application/json',
      ...authHeaders,
    },
  })
  if (!response.ok) throw new Error(response.error || `HTTP ${response.status}`)
  return JSON.parse(response.text) as T
}

export async function fetchMarketQuotes(payload: { spot: string[]; contracts: string[] }): Promise<MarketQuote[]> {
  const spot = [...new Set(payload.spot.map((item) => item.trim()).filter(Boolean))].slice(0, 30)
  const contracts = [...new Set(payload.contracts.map((item) => item.toUpperCase()).filter((item) => SYMBOL.test(item)))].slice(0, 30)
  const key = `${spot.join(',')}|${contracts.join(',')}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < 10_000) return cached.data

  const work: Promise<MarketQuote[]>[] = []
  if (contracts.length) work.push((async () => {
    const rows = await Promise.allSettled(contracts.map((symbol) => getJson<Array<Record<string, string>>>(`https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${encodeURIComponent(`${symbol.replace(/USDT$/, '')}_USDT`)}`)))
    const successful = rows.flatMap((result) => result.status === 'fulfilled' ? result.value.map((row) => ({
      symbol: row.contract.replace('_', ''), name: row.contract.replace('_', ''), kind: 'contract' as const,
      asset: 'crypto' as const, price: Number(row.last), change: Number(row.change_price),
      changePercent: Number(row.change_percentage), currency: 'USDT', high24h: Number(row.high_24h),
      low24h: Number(row.low_24h), turnover24h: Number(row.volume_24h_quote ?? row.volume_24h_settle),
      markPrice: Number(row.mark_price), fundingRate: Number(row.funding_rate) * 100,
      fundingIntervalHours: Number(row.funding_interval ?? 28_800) / 3600,
      openInterest: Number(row.total_size) * Number(row.mark_price),
      updatedAt: Date.now(),
    })).filter((quote) => quote.price > 0 && Number.isFinite(quote.changePercent)) : [])
    const rejections = rows.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (rejections.length && !successful.length) {
      throw new Error(`合约行情请求失败: ${rejections[0].reason?.message || '网络异常'}`)
    }
    return successful
  })())

  const spotCrypto = spot.filter((item) => /^[A-Z0-9]{2,24}USDT$/.test(item.toUpperCase()) && !/^(MU|TSLA|NVDA|AAPL|MSFT|AMZN|GOOG|META)USDT$/.test(item.toUpperCase()))
  const spotStocks = spot.filter((item) => STOCK_SYMBOL.test(item) || /^[A-Z]{1,6}$/.test(item) || /^(MU|TSLA|NVDA|AAPL|MSFT|AMZN|GOOG|META)USDT$/.test(item.toUpperCase()))
  if (spotCrypto.length) work.push((async () => {
    const rows = await Promise.allSettled(spotCrypto.map((symbol) => getJson<Array<Record<string, string>>>(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(`${symbol.replace(/USDT$/, '')}_USDT`)}`)))
    const successful = rows.flatMap((result) => result.status === 'fulfilled' ? result.value.map((row) => ({
      symbol: row.currency_pair.replace('_', ''), name: row.currency_pair.replace('_', ''), kind: 'spot' as const,
      asset: 'crypto' as const, price: Number(row.last), change: Number(row.change_24h),
      changePercent: Number(row.change_percentage), currency: 'USDT', high24h: Number(row.high_24h),
      low24h: Number(row.low_24h), turnover24h: Number(row.quote_volume), updatedAt: Date.now(),
    })).filter((quote) => quote.price > 0 && Number.isFinite(quote.changePercent)) : [])
    const rejections = rows.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (rejections.length && !successful.length) {
      throw new Error(`现货行情请求失败: ${rejections[0].reason?.message || '网络异常'}`)
    }
    return successful
  })())
  if (spotStocks.length) work.push((async () => {
    const symbols = spotStocks.map((item) => STOCK_SYMBOL.test(item) ? item.toLowerCase() : `us${item.toUpperCase().replace(/USDT$/, '')}`).join(',')
    const response = await fetchViaNet({ url: `https://qt.gtimg.cn/q=${symbols}`, timeout: 6000, encoding: 'gbk', headers: { referer: 'https://gu.qq.com/' } })
    if (!response.ok) throw new Error(response.error || `Tencent HTTP ${response.status}`)
    const text = response.text
    const quotes: MarketQuote[] = []
    for (const row of text.match(/v_[^=]+="[^"]*"/g) ?? []) {
      const symbol = row.slice(2, row.indexOf('='))
      const fields = row.slice(row.indexOf('"') + 1, row.lastIndexOf('"')).split('~')
      const price = Number(fields[3]), change = Number(fields[31]), changePercent = Number(fields[32])
      if ((!STOCK_SYMBOL.test(symbol) && !/^us[A-Z]{1,6}$/.test(symbol)) || price <= 0 || !Number.isFinite(price) || !Number.isFinite(changePercent)) continue
      const isUS = symbol.startsWith('us')
      /* 腾讯 A 股成交额以万元计，港美股直接返回本币金额。 */
      const turnover = Number(fields[37]) * (/^(sh|sz)/.test(symbol) ? 10_000 : 1)
      const quoteSymbol = (isUS ? symbol.slice(2) : symbol).toUpperCase()
      const requestedSymbol = spotStocks.find((requested) => requested.toUpperCase().replace(/USDT$/, '') === quoteSymbol)?.toUpperCase()
      quotes.push({ symbol: requestedSymbol?.endsWith('USDT') ? `${quoteSymbol}USDT` : quoteSymbol, name: fields[1] || symbol, kind: 'spot', asset: 'equity', price, change, changePercent, currency: isUS ? 'USD' : symbol.startsWith('hk') ? 'HKD' : 'CNY', high24h: Number(fields[33]) || undefined, low24h: Number(fields[34]) || undefined, turnover24h: Number.isFinite(turnover) ? turnover : undefined, updatedAt: Date.now() })
    }
    return quotes
  })())

  const settled = await Promise.allSettled(work)
  const results = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
  const errors = settled.flatMap((result) => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : [])
  const missing = [...spot.map((symbol) => `spot:${symbol.toLowerCase()}`), ...contracts.map((symbol) => `contract:${symbol.toLowerCase()}`)].filter((wanted) => !results.some((item) => `${item.kind}:${item.symbol.toLowerCase()}` === wanted))
  if (results.length && missing.length) errors.push(`${missing.length} 个标的暂无行情`)
  if (!results.length && errors.length) throw new Error(errors.join('；'))
  if (errors.length && cached) {
    const freshKeys = new Set(results.map((item) => `${item.kind}:${item.symbol}`))
    results.push(...cached.data.filter((item) => !freshKeys.has(`${item.kind}:${item.symbol}`)))
  }
  if (cache.size > 50) cache.delete(cache.keys().next().value!)
  cache.set(key, { at: Date.now(), data: results })
  return results
}

export async function fetchMarketCandles(payload: { symbol: string; kind: MarketKind }): Promise<number[]> {
  try {
    const symbol = payload.symbol.trim()
    /* 美股代码不带 USDT；腾讯分钟线只有当日数据，跨交易日走势改用新浪 60 分钟线。 */
    if (payload.kind === 'spot' && /^[A-Z]{1,6}$/i.test(symbol)) {
      const raw = symbol.toUpperCase()
      const response = await fetchViaNet({
        url: `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20${raw}=/US_MinKService.getMinK?symbol=${raw}&type=60`,
        timeout: 6000,
        headers: { Accept: 'application/javascript, text/plain, */*', referer: 'https://finance.sina.com.cn/' },
      })
      if (!response.ok) throw new Error(response.error || `Sina HTTP ${response.status}`)
      const start = response.text.indexOf('(')
      const end = response.text.lastIndexOf(')')
      if (start < 0 || end <= start) return []
      const parsed: unknown = JSON.parse(response.text.slice(start + 1, end))
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((row): row is { d: string; c: unknown } => Boolean(row) && typeof row.d === 'string' && Number.isFinite(Number(row.c)))
        .sort((a, b) => a.d.localeCompare(b.d))
        .slice(-24)
        .map((row) => Number(row.c))
    }
    const raw = symbol.replace(/[-_]?USDT$/i, '').toUpperCase()
    if (!/^[A-Z0-9]{1,32}$/i.test(raw)) return []
    const pair = `${raw}_USDT`
    if (payload.kind === 'spot') {
      const rows = await getJson<Array<string[]>>(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}&interval=1h&limit=24`)
      /* 按时间戳升序排序，保证 Sparkline 从左往右呈现过去到现在的走势 */
      return rows.sort((a, b) => Number(a[0]) - Number(b[0])).map((row) => Number(row[2])).filter(Number.isFinite)
    }
    const rows = await getJson<Array<{ t: number; c: string }>>(`https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${encodeURIComponent(pair)}&interval=1h&limit=24`)
    return rows.sort((a, b) => Number(a.t) - Number(b.t)).map((row) => Number(row.c)).filter(Number.isFinite)
  } catch (error) {
    /* 迷你走势折线仅作辅助展示，请求失败（如冷门币无数据或网络抖动）静默降级为空数组，避免在 IPC handler 产生未捕获异常 */
    return []
  }
}

export async function fetchMarketNews(): Promise<MarketNewsItem[]> {
  const cached = newsCache.get('markets')
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.data
  const feeds = [{ source: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/' }]
  const settled = await Promise.allSettled(feeds.map(async (feed) => {
    const response = await fetchViaNet({ url: feed.url, timeout: 6000, headers: { Accept: 'application/rss+xml, application/xml, text/xml' } })
    if (!response.ok) throw new Error(response.error || `HTTP ${response.status}`)
    const items = [...response.text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0, 12)
    return items.map(([, item]) => {
      const read = (tag: string) => item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim() ?? ''
      let url = read('link')
      if (url.startsWith('http://')) url = `https://${url.slice(7)}`
      return { title: read('title'), url, source: feed.source, publishedAt: read('pubDate') }
    }).filter((item) => item.title && /^https?:\/\//i.test(item.url))
  }))
  const results = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 12)
  if (!results.length) {
    if (cached?.data.length) return cached.data
    return cached?.data ?? []
  }
  newsCache.set('markets', { at: Date.now(), data: results })
  return results
}

/* 成功响应形状校验：鉴权失败时 Gate 会回 200 + {label,message} 之类的错误体，不能当成有效数据。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isRecordList(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isRecord)
}

function isFiniteField(source: Record<string, unknown> | undefined, key: string) {
  return source != null && source[key] !== undefined && source[key] !== null && Number.isFinite(Number(source[key]))
}

/** 账户接口失败时上报简短、可读的原因，不透出 URL、签名头等内部信息。 */
function accountFailureReason(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'rejected') return (result.reason instanceof Error ? result.reason.message : '') || '请求失败'
  return isRecord(result.value) ? '响应异常' : '响应格式无效'
}

/** 获取 Gate.io 绑定账户的资产权益、未实现盈亏与实时持仓明细（包括股票合成合约等） */
export async function fetchGateAccount(): Promise<GateAccountData> {
  if (!hasGateCredentials()) throw new Error('请先配置 Gate.io 只读 API Key')
  const requestKey = gateApiKey
  const [futAccResult, futPosResult, spotAccResult] = await Promise.allSettled([
    getJson<Record<string, unknown>>('https://api.gateio.ws/api/v4/futures/usdt/accounts', true),
    getJson<Array<Record<string, unknown>>>('https://api.gateio.ws/api/v4/futures/usdt/positions', true),
    getJson<Array<Record<string, unknown>>>(`https://api.gateio.ws/api/v4/spot/accounts?${new URLSearchParams({ currency: 'USDT' }).toString()}`, true),
  ])
  // 请求途中凭据被换掉：结果已经不属于当前账户，直接丢弃，不参与聚合。
  if (gateApiKey !== requestKey) throw new Error('账户凭据已更新，请重新加载')

  const futAccOk = futAccResult.status === 'fulfilled' && isRecord(futAccResult.value)
    && isFiniteField(futAccResult.value, 'total') && isFiniteField(futAccResult.value, 'available')
  const futPosOk = futPosResult.status === 'fulfilled' && isRecordList(futPosResult.value)
  const spotAccOk = spotAccResult.status === 'fulfilled' && isRecordList(spotAccResult.value)
  const futAcc = futAccOk ? futAccResult.value as Record<string, unknown> : undefined
  const futPos = futPosOk ? futPosResult.value as Array<Record<string, unknown>> : []
  const spotAcc = spotAccOk ? spotAccResult.value as Array<Record<string, unknown>> : []

  const openPositions: GatePosition[] = futPos
    .filter((p) => Number(p.size) !== 0)
    .map((p) => {
      const size = Number(p.size)
      const entryPrice = Number(p.entry_price)
      const markPrice = Number(p.mark_price)
      const value = Number(p.value)
      const unrealisedPnl = Number(p.unrealised_pnl)
      const initialMargin = Number(p.initial_margin)
      const pnlPercent = initialMargin > 0
        ? (unrealisedPnl / initialMargin) * 100
        : value > 0 ? (unrealisedPnl / value) * 100 : 0
      const side = String(p.mode) === 'dual_short' || size < 0 ? ('short' as const) : ('long' as const)
      const contract = String(p.contract)
      return {
        contract,
        symbol: contract.replace(/_USDT$/, ''),
        mode: String(p.mode),
        side,
        size,
        value,
        entryPrice,
        markPrice,
        unrealisedPnl,
        pnlPercent,
        leverage: Number(p.lever || 1),
        liqPrice: Number(p.liq_price || 0),
        margin: initialMargin,
      }
    })

  const spotBalances: GateSpotBalance[] = spotAcc
    .filter((a) => Number(a.available) > 0 || Number(a.locked) > 0)
    .map((a) => ({
      currency: String(a.currency),
      available: Number(a.available),
      locked: Number(a.locked),
    }))

  const failed = [futAccOk, futPosOk, spotAccOk].filter((ok) => !ok).length
  return {
    total: futAccOk ? Number(futAcc!.total) : null,
    available: futAccOk ? Number(futAcc!.available) : null,
    // 未实现盈亏允许为 0，但字段缺失说明响应不完整，与账户余额同样按不可用处理。
    unrealisedPnl: futAccOk && isFiniteField(futAcc, 'unrealised_pnl') ? Number(futAcc!.unrealised_pnl) : null,
    openPositions: futPosOk ? openPositions : null,
    spotBalances: spotAccOk ? spotBalances : null,
    balanceError: futAccOk ? undefined : accountFailureReason(futAccResult),
    positionError: futPosOk ? undefined : accountFailureReason(futPosResult),
    spotError: spotAccOk ? undefined : accountFailureReason(spotAccResult),
    partial: failed > 0,
    updatedAt: Date.now(),
  }
}
