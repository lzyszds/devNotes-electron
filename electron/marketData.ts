import crypto from 'node:crypto'
import { fetchViaNet } from './proxy'

export type MarketKind = 'contract' | 'spot'
/** 详情页 / 侧栏走势图共用的周期；默认 1h 兼容旧调用 */
export type CandleInterval = '1h' | '4h' | '1d'

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
  /** 今开（股票腾讯字段；合约一般无） */
  open?: number
  /** 昨收 */
  prevClose?: number
  /** 成交量（A 股为手，美港股为本币口径数量） */
  volume?: number
  /** 换手率 % */
  turnoverRate?: number
  /** 市盈率 TTM */
  pe?: number
  /** 市净率 */
  pb?: number
  /** 振幅 % */
  amplitude?: number
  /** 流通市值（亿元） */
  floatMarketCap?: number
  /** 总市值（亿元） */
  marketCap?: number
  updatedAt: number
}

/** 腾讯 ~ 分隔字段里取有限数字；空串 / 非数字一律丢掉，交给 UI 显示 -- */
function optNum(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export type MarketNewsCategory = 'equity' | 'crypto' | 'exchange'
export type MarketNewsSentiment = 'bull' | 'bear' | 'neutral'

export interface MarketNewsItem {
  title: string
  url: string
  source: string
  publishedAt: string
  /** 股票 / 加密货币 / 交易所 */
  category: MarketNewsCategory
  /** 利多 / 利空 / 中性（标题启发式，仅供参考） */
  sentiment: MarketNewsSentiment
}

export interface MarketNewsPageResult {
  items: MarketNewsItem[]
  page: number
  pageSize: number
  totalCount: number
  hasMore: boolean
}

export type FetchMarketNewsOptions = {
  page?: number
  pageSize?: number
  /** 跳过主进程短缓存，强制回源（手动刷新首页用） */
  force?: boolean
}

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
  SNDK: '闪迪',
  TSLA: '特斯拉',
  NVDA: '英伟达',
  AAPL: '苹果',
  AMZN: '亚马逊',
  GOOG: '谷歌',
  GOOGL: '谷歌',
  META: 'Meta',
  AMD: '超威',
  NFLX: '奈飞',
  COIN: 'Coinbase',
  BABA: '阿里巴巴',
  PDD: '拼多多',
  BTC: '比特币',
  ETH: '以太坊',
  SOL: 'Solana',
}

/** Gate 上常见美股 / 合成合约 ticker，用来给行情标 asset=equity */
const EQUITY_TICKER_RE =
  /^(MU|MSFT|SPCX|SNDK|TSLA|NVDA|AAPL|AMZN|GOOG|GOOGL|META|INTU|AMD|NFLX|COIN|BABA|PDD|HOOD|PLTR|UBER|ABNB|NKE|DIS|BA|JPM|V|MA|COST|AVGO|ORCL|CRM|INTC|QCOM|TSM|AAL|AAOI|AAPU|ABBV|ACN|ADBE|ADI|ADSK)$/i

function contractAsset(base: string): 'crypto' | 'equity' {
  return EQUITY_TICKER_RE.test(base) ? 'equity' : 'crypto'
}

function quoteDisplayName(base: string): string {
  return SYMBOL_NAMES[base.toUpperCase()] ?? base
}

/*
 * 资产/持仓/现货三个接口各自独立成败：成功的字段照实给（0 与空数组是真值），
 * 失败的字段置 null 并记录原因。渲染层据此区分「真实空仓」与「没拿到数据」，
 * 绝不能把失败折成 0 展示成零资产。null 也不会进 JSON 序列化缓存。
 */
export interface GateAccountData {
  /** 合约账户权益（futures/usdt/accounts.total，已含浮盈） */
  total: number | null
  available: number | null
  unrealisedPnl: number | null
  /**
   * 账户资产合计（合约 total + 现货 USDT），未另加浮盈。
   * 总资产估值请用 totalAsset + unrealisedPnl。
   */
  totalAsset: number | null
  totalAssetSpot: number | null
  openPositions: GatePosition[] | null
  spotBalances: GateSpotBalance[] | null
  balanceError?: string
  positionError?: string
  spotError?: string
  partial?: boolean
  updatedAt: number
}

const cache = new Map<string, { at: number; data: MarketQuote[] }>()
/* 资讯按页缓存；翻页后各页独立 TTL，避免首页缓存挡住第 2 页 */
const newsPageCache = new Map<string, { at: number; data: MarketNewsPageResult }>()
const NEWS_PAGE_CACHE_TTL_MS = 3 * 60_000
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

/* 调试日志限频：轮询很密，一分钟打一次就够对照字段 */
const GATE_LOG_INTERVAL_MS = 60_000
const gateLogAt = new Map<string, number>()

function logGateOnce(url: string, authenticated: boolean, data: unknown) {
  if (!url.includes('api.gateio.ws')) return
  const now = Date.now()
  const last = gateLogAt.get(url) ?? 0
  if (now - last < GATE_LOG_INTERVAL_MS) return
  gateLogAt.set(url, now)
  console.log('[Gate]', authenticated ? 'AUTH' : 'PUB', url, data)
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
  const data = JSON.parse(response.text) as T
  logGateOnce(url, authenticated, data)
  return data
}

export async function fetchMarketQuotes(payload: { spot: string[]; contracts: string[] }): Promise<MarketQuote[]> {
  const spot = [...new Set(payload.spot.map((item) => item.trim()).filter(Boolean))].slice(0, 30)
  const contracts = [...new Set(payload.contracts.map((item) => item.toUpperCase()).filter((item) => SYMBOL.test(item)))].slice(0, 30)
  const key = `${spot.join(',')}|${contracts.join(',')}`
  const cached = cache.get(key)
  /* 渲染层可设 1s/3s 刷新，缓存不能比最短间隔还长，否则选了也白选 */
  if (cached && Date.now() - cached.at < 800) return cached.data

  const work: Promise<MarketQuote[]>[] = []
  if (contracts.length) work.push((async () => {
    const rows = await Promise.allSettled(contracts.map((symbol) => getJson<Array<Record<string, string>>>(`https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${encodeURIComponent(`${symbol.replace(/USDT$/, '')}_USDT`)}`)))
    const successful = rows.flatMap((result) => result.status === 'fulfilled' ? result.value.map((row) => {
      const symbol = row.contract.replace('_', '')
      const base = symbol.replace(/USDT$/i, '')
      return {
        symbol,
        name: quoteDisplayName(base),
        kind: 'contract' as const,
        asset: contractAsset(base),
        price: Number(row.last),
        change: Number(row.change_price),
        changePercent: Number(row.change_percentage),
        currency: 'USDT',
        high24h: Number(row.high_24h),
        low24h: Number(row.low_24h),
        turnover24h: Number(row.volume_24h_quote ?? row.volume_24h_settle),
        markPrice: Number(row.mark_price),
        fundingRate: Number(row.funding_rate) * 100,
        fundingIntervalHours: Number(row.funding_interval ?? 28_800) / 3600,
        openInterest: Number(row.total_size) * Number(row.mark_price),
        updatedAt: Date.now(),
      }
    }).filter((quote) => quote.price > 0 && Number.isFinite(quote.changePercent)) : [])
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
      /*
       * 字段下标沿用社区常见映射（与 WeChatStock / 多数开源解析一致）：
       * 4 昨收 5 今开 36 量 38 换手 39 PE 43 振幅 44 流通市值 45 总市值 46 PB。
       * 港美股部分字段可能为空，optNum 会丢掉。
       */
      quotes.push({
        symbol: requestedSymbol?.endsWith('USDT') ? `${quoteSymbol}USDT` : quoteSymbol,
        name: fields[1] || symbol,
        kind: 'spot',
        asset: 'equity',
        price,
        change,
        changePercent,
        currency: isUS ? 'USD' : symbol.startsWith('hk') ? 'HKD' : 'CNY',
        high24h: optNum(fields[33]),
        low24h: optNum(fields[34]),
        turnover24h: Number.isFinite(turnover) ? turnover : undefined,
        open: optNum(fields[5]),
        prevClose: optNum(fields[4]),
        volume: optNum(fields[36]),
        turnoverRate: optNum(fields[38]),
        pe: optNum(fields[39]),
        amplitude: optNum(fields[43]),
        floatMarketCap: optNum(fields[44]),
        marketCap: optNum(fields[45]),
        pb: optNum(fields[46]),
        updatedAt: Date.now(),
      })
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

/*
 * 热门列表：Gate 一次给全市场 ticker，主进程按成交额排好后整份缓存，
 * 渲染层用 offset/limit 切片翻页 —— 别每次翻页都打 Gate。
 */
const HOT_FULL_CAP = 500
const HOT_CACHE_TTL_MS = 8_000
const hotFullCache = new Map<string, { at: number; data: MarketQuote[] }>()

export type HotFuturesPage = {
  items: MarketQuote[]
  offset: number
  limit: number
  total: number
  hasMore: boolean
}

async function loadHotFuturesFull(
  assetFilter: 'all' | 'crypto' | 'equity',
  force = false,
): Promise<MarketQuote[]> {
  const cacheKey = `hot-full:${assetFilter}`
  const cached = hotFullCache.get(cacheKey)
  if (!force && cached && Date.now() - cached.at < HOT_CACHE_TTL_MS) {
    return cached.data
  }

  const rows = await getJson<Array<Record<string, string>>>(
    'https://api.gateio.ws/api/v4/futures/usdt/tickers',
  )
  const quotes = rows
    .map((row) => {
      const symbol = String(row.contract || '').replace('_', '')
      if (!symbol.endsWith('USDT')) return null
      const base = symbol.replace(/USDT$/i, '')
      const asset = contractAsset(base)
      if (assetFilter !== 'all' && asset !== assetFilter) return null
      const price = Number(row.last)
      const changePercent = Number(row.change_percentage)
      if (!(price > 0) || !Number.isFinite(changePercent)) return null
      return {
        symbol,
        name: quoteDisplayName(base),
        kind: 'contract' as const,
        asset,
        price,
        change: Number(row.change_price),
        changePercent,
        currency: 'USDT',
        high24h: Number(row.high_24h),
        low24h: Number(row.low_24h),
        turnover24h: Number(row.volume_24h_quote ?? row.volume_24h_settle),
        markPrice: Number(row.mark_price),
        fundingRate: Number(row.funding_rate) * 100,
        fundingIntervalHours: Number(row.funding_interval ?? 28_800) / 3600,
        openInterest: Number(row.total_size) * Number(row.mark_price),
        updatedAt: Date.now(),
      } satisfies MarketQuote
    })
    .filter((q): q is MarketQuote => Boolean(q))
    .sort((a, b) => (b.turnover24h ?? 0) - (a.turnover24h ?? 0))
    .slice(0, HOT_FULL_CAP)

  hotFullCache.set(cacheKey, { at: Date.now(), data: quotes })
  if (hotFullCache.size > 8) {
    const oldest = hotFullCache.keys().next().value
    if (oldest) hotFullCache.delete(oldest)
  }
  return quotes
}

/**
 * 行情发现页分页：offset 起取 limit 条；force 时整份榜单回源。
 * 兼容旧调用：只传 limit 且不传 offset 时，等价于 offset=0。
 */
export async function fetchHotFutures(payload?: {
  limit?: number
  offset?: number
  assetFilter?: 'all' | 'crypto' | 'equity'
  force?: boolean
}): Promise<HotFuturesPage> {
  const assetFilter = payload?.assetFilter ?? 'all'
  const offset = Math.max(0, Math.round(payload?.offset ?? 0))
  const limit = Math.min(80, Math.max(10, Math.round(payload?.limit ?? 40)))
  const all = await loadHotFuturesFull(assetFilter, Boolean(payload?.force))
  const items = all.slice(offset, offset + limit)
  return {
    items,
    offset,
    limit,
    total: all.length,
    hasMore: offset + items.length < all.length,
  }
}

function candleLimit(interval: CandleInterval): number {
  if (interval === '1d') return 60
  if (interval === '4h') return 42
  return 24
}

/** 把更细周期收盘价按 every 根收成一根（取区间末收），给没有原生 4h 的美股用 */
function downsampleCloses(closes: number[], every: number): number[] {
  if (every <= 1 || closes.length < 2) return closes
  const out: number[] = []
  for (let i = every - 1; i < closes.length; i += every) out.push(closes[i]!)
  const last = closes[closes.length - 1]!
  if (!out.length || out[out.length - 1] !== last) out.push(last)
  return out
}

function parseSinaJsonpArray(text: string): unknown[] {
  const start = text.indexOf('(')
  const end = text.lastIndexOf(')')
  if (start < 0 || end <= start) return []
  const parsed: unknown = JSON.parse(text.slice(start + 1, end))
  return Array.isArray(parsed) ? parsed : []
}

async function fetchUsEquityCandles(symbol: string, interval: CandleInterval): Promise<number[]> {
  const raw = symbol.toUpperCase()
  const headers = { Accept: 'application/javascript, text/plain, */*', referer: 'https://finance.sina.com.cn/' }
  /* 日线走 DailyK；小时级仍用 60 分线，4h 再降采样 */
  if (interval === '1d') {
    const response = await fetchViaNet({
      url: `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_${raw}=/US_MinKService.getDailyK?symbol=${raw}`,
      timeout: 8000,
      headers,
    })
    if (!response.ok) throw new Error(response.error || `Sina DailyK HTTP ${response.status}`)
    const rows = parseSinaJsonpArray(response.text)
    return rows
      .flatMap((row) => {
        if (!row || typeof row !== 'object') return []
        const c = Number((row as { c?: unknown }).c)
        return Number.isFinite(c) ? [c] : []
      })
      .slice(-candleLimit('1d'))
  }

  const response = await fetchViaNet({
    url: `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20${raw}=/US_MinKService.getMinK?symbol=${raw}&type=60`,
    timeout: 6000,
    headers,
  })
  if (!response.ok) throw new Error(response.error || `Sina HTTP ${response.status}`)
  const rows = parseSinaJsonpArray(response.text)
  const closes = rows
    .filter((row): row is { d: string; c: unknown } => Boolean(row) && typeof (row as { d?: unknown }).d === 'string' && Number.isFinite(Number((row as { c?: unknown }).c)))
    .sort((a, b) => a.d.localeCompare(b.d))
    .map((row) => Number(row.c))
    .filter(Number.isFinite)
  if (interval === '4h') return downsampleCloses(closes, 4).slice(-candleLimit('4h'))
  return closes.slice(-candleLimit('1h'))
}

async function fetchCnHkEquityCandles(symbol: string, interval: CandleInterval): Promise<number[]> {
  /* scale: 60=小时；日 K 用 240；4h 无原生档，取 60 后再每 4 根收一根 */
  const scale = interval === '1d' ? 240 : 60
  const datalen = interval === '4h' ? 200 : candleLimit(interval === '1d' ? '1d' : '1h') * (interval === '4h' ? 4 : 1)
  const response = await fetchViaNet({
    url: `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${encodeURIComponent(symbol.toLowerCase())}&scale=${scale}&ma=no&datalen=${datalen}`,
    timeout: 8000,
    headers: { Accept: 'application/json, text/plain, */*', referer: 'https://finance.sina.com.cn/' },
  })
  if (!response.ok) throw new Error(response.error || `Sina CN K 线 HTTP ${response.status}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(response.text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const closes = parsed
    .flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const c = Number((row as { close?: unknown }).close)
      return Number.isFinite(c) ? [c] : []
    })
  if (interval === '4h') return downsampleCloses(closes, 4).slice(-candleLimit('4h'))
  return closes.slice(-candleLimit(interval))
}

export async function fetchMarketCandles(payload: {
  symbol: string
  kind: MarketKind
  interval?: CandleInterval
}): Promise<number[]> {
  try {
    const symbol = payload.symbol.trim()
    const interval: CandleInterval =
      payload.interval === '4h' || payload.interval === '1d' ? payload.interval : '1h'
    const limit = candleLimit(interval)

    /* 美股代码不带前缀；腾讯分钟线只有当日，跨交易日改走新浪 */
    if (payload.kind === 'spot' && /^[A-Z]{1,6}$/i.test(symbol) && !STOCK_SYMBOL.test(symbol)) {
      return await fetchUsEquityCandles(symbol, interval)
    }
    /* A / 港股：sh600000 / sz000001 / hk00700 */
    if (payload.kind === 'spot' && STOCK_SYMBOL.test(symbol)) {
      return await fetchCnHkEquityCandles(symbol, interval)
    }

    const raw = symbol.replace(/[-_]?USDT$/i, '').toUpperCase()
    if (!/^[A-Z0-9]{1,32}$/i.test(raw)) return []
    const pair = `${raw}_USDT`
    const gateInterval = interval === '1d' ? '1d' : interval === '4h' ? '4h' : '1h'
    if (payload.kind === 'spot') {
      const rows = await getJson<Array<string[]>>(
        `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}&interval=${gateInterval}&limit=${limit}`,
      )
      /* 按时间戳升序排序，保证 Sparkline 从左往右呈现过去到现在的走势 */
      return rows
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map((row) => Number(row[2]))
        .filter(Number.isFinite)
    }
    const rows = await getJson<Array<{ t: number; c: string }>>(
      `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${encodeURIComponent(pair)}&interval=${gateInterval}&limit=${limit}`,
    )
    return rows
      .sort((a, b) => Number(a.t) - Number(b.t))
      .map((row) => Number(row.c))
      .filter(Number.isFinite)
  } catch {
    /* 迷你走势折线仅作辅助展示，请求失败静默降级为空数组，避免 IPC handler 未捕获异常 */
    return []
  }
}

/*
 * 资讯改走 Gate Moments 官方接口（与官网「快讯」同源），已是简体标题，
 * 不必再拼 RSS + 翻译。利多/利空优先用接口 change 字段，没有再回退标题启发式。
 * 翻页走 page / page_size；保持接口返回顺序，不做跨页重排。
 */
const GATE_NEWS_URL =
  'https://social-cdn.gposts.net/moments/api/v1/moment/message/news_v1'

const EXCHANGE_RE =
  /\b(binance|coinbase|okx|bybit|kraken|mexc|bitget|kucoin|huobi|htx|gate\.?io|upbit|listing|delist(?:ing)?)\b|币安|歐易|欧易|火币|火幣|幣安|交易所|上幣|上币|下架/i

const BULL_RE =
  /\b(surge|soar|rally|jump|gain|rise|upgrade|bullish|inflow|record\s+high|ath|approval)\b|利好|利多|上涨|上漲|暴涨|暴漲|大涨|大漲|飙升|飆升|新高|看涨|看漲|突破|强劲|強勁|超预期|超預期/i

const BEAR_RE =
  /\b(plunge|tumble|crash|drop|fall|miss|downgrade|hack|ban|lawsuit|outflow|liquidat|bearish|sell[- ]?off|slump)\b|利空|下跌|下挫|暴跌|大跌|重挫|崩盘|崩盤|看跌|卖压|賣壓|下调|下調|不及预期|不及預期|爆仓|爆倉/i

type GateNewsCurrencyItem = {
  kind?: string
  name?: string
  title?: string
  pair?: string
  exchange_name?: string
}

type GateNewsRow = {
  id?: string | number
  slug?: string
  title?: string
  nickname?: string
  create_timest?: number | string
  update_timest?: string
  change?: { bull?: number; bear?: number; change_status?: number }
  currency_items?: GateNewsCurrencyItem[]
  currencies?: string[]
}

function classifySentimentFromTitle(title: string): MarketNewsSentiment {
  const bull = BULL_RE.test(title)
  const bear = BEAR_RE.test(title)
  if (bull && !bear) return 'bull'
  if (bear && !bull) return 'bear'
  return 'neutral'
}

function classifyGateSentiment(
  title: string,
  change?: GateNewsRow['change'],
): MarketNewsSentiment {
  const bull = Number(change?.bull ?? 0)
  const bear = Number(change?.bear ?? 0)
  if (bull > bear && bull > 0) return 'bull'
  if (bear > bull && bear > 0) return 'bear'
  const status = Number(change?.change_status ?? 0)
  if (status === 1) return 'bull'
  if (status === 2) return 'bear'
  return classifySentimentFromTitle(title)
}

function classifyGateCategory(
  title: string,
  currencies: GateNewsCurrencyItem[] | undefined,
): MarketNewsCategory {
  const kinds = (currencies ?? []).map((c) => String(c.kind || '').toLowerCase())
  if (kinds.some((k) => k === 'stock' || k.includes('stock') || k.includes('tradfi'))) {
    return 'equity'
  }
  if (EXCHANGE_RE.test(title)) return 'exchange'
  if (kinds.some((k) => k === 'futures' || k === 'spot' || k.includes('crypto'))) {
    return 'crypto'
  }
  /* Gate 快讯主体是加密行情，未标注币种时也归加密 */
  return 'crypto'
}

/**
 * Gate 详情页路径是 /zh/news/detail/{slug}，旧的 /zh/post/news/ 已 404。
 * slug 本身一般是 ascii-连字符，仍 encode 一下防中文 slug。
 */
function gateNewsUrl(row: GateNewsRow): string {
  const slug = String(row.slug || '').trim()
  if (slug) return `https://www.gate.com/zh/news/detail/${encodeURIComponent(slug)}`
  const id = String(row.id || '').trim()
  if (id) return `https://www.gate.com/zh/news/detail/${encodeURIComponent(id)}`
  return 'https://www.gate.com/zh/crypto-market-news'
}

/** 把本地缓存里残留的旧详情路径改到现行地址，避免点进去还是 404 */
export function normalizeGateNewsUrl(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return raw
  return raw
    .replace(
      /^https?:\/\/(?:www\.)?gate\.(?:com|io)\/(?:zh\/)?post\/news\//i,
      'https://www.gate.com/zh/news/detail/',
    )
    .replace(
      /^https?:\/\/(?:www\.)?gate\.(?:com|io)\/news\/detail\//i,
      'https://www.gate.com/zh/news/detail/',
    )
}

function gateNewsPublishedAt(row: GateNewsRow): string {
  const ts = Number(row.create_timest)
  if (Number.isFinite(ts) && ts > 0) {
    /* Gate 给的是秒级时间戳 */
    return new Date(ts * 1000).toISOString()
  }
  const updated = String(row.update_timest || '').trim()
  if (updated) {
    const parsed = Date.parse(updated.replace(' ', 'T') + 'Z')
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return ''
}

export async function fetchMarketNews(
  options: FetchMarketNewsOptions = {},
): Promise<MarketNewsPageResult> {
  const page = Math.max(1, Math.min(100, Math.round(options.page ?? 1)))
  const pageSize = Math.max(5, Math.min(40, Math.round(options.pageSize ?? 20)))
  const cacheKey = `gate-moments:p${page}:s${pageSize}`
  const cached = newsPageCache.get(cacheKey)
  if (!options.force && cached && Date.now() - cached.at < NEWS_PAGE_CACHE_TTL_MS) {
    return cached.data
  }

  const response = await fetchViaNet({
    url: GATE_NEWS_URL,
    method: 'POST',
    timeout: 12000,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'x-gate-applang': 'cn',
      'x-gate-device-type': '3',
      'x-gate-social-jwt': '',
      Referer: 'https://www.gate.com/',
    },
    body: JSON.stringify({
      page,
      page_size: pageSize,
      filter_tag: '',
      moments_token: '',
      platform: 'web',
      appLang: 'cn',
    }),
  })
  if (!response.ok) {
    if (cached) return cached.data
    throw new Error(response.error || `Gate 资讯 HTTP ${response.status}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(response.text)
  } catch {
    if (cached) return cached.data
    throw new Error('Gate 资讯响应不是合法 JSON')
  }

  const root = isRecord(payload) ? payload : null
  const data = root && isRecord(root.data) ? root.data : null
  const list = data && Array.isArray(data.news_list) ? data.news_list : []
  const totalCount = Math.max(0, Number(data?.total_count) || 0)

  const items: MarketNewsItem[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    if (!isRecord(raw)) continue
    const row = raw as GateNewsRow
    const title = String(row.title || '').trim()
    if (!title) continue
    const url = gateNewsUrl(row)
    if (seen.has(url)) continue
    seen.add(url)
    const currencyItems = Array.isArray(row.currency_items)
      ? (row.currency_items.filter(isRecord) as GateNewsCurrencyItem[])
      : undefined
    items.push({
      title,
      url,
      source: String(row.nickname || 'Gate News').trim() || 'Gate News',
      publishedAt: gateNewsPublishedAt(row),
      category: classifyGateCategory(title, currencyItems),
      sentiment: classifyGateSentiment(title, row.change),
    })
  }

  if (!items.length && cached) return cached.data

  const result: MarketNewsPageResult = {
    items,
    page,
    pageSize,
    totalCount,
    hasMore:
      items.length > 0 &&
      (totalCount > 0
        ? page * pageSize < totalCount
        : items.length >= pageSize),
  }

  newsPageCache.set(cacheKey, { at: Date.now(), data: result })
  if (newsPageCache.size > 40) {
    const oldest = newsPageCache.keys().next().value
    if (oldest) newsPageCache.delete(oldest)
  }
  return result
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

  const futTotal = futAccOk ? Number(futAcc!.total) : null
  const unrealisedPnl =
    futAccOk && isFiniteField(futAcc, 'unrealised_pnl')
      ? Number(futAcc!.unrealised_pnl)
      : null
  const totalAssetSpot = spotAccOk
    ? spotBalances
        .filter((b) => b.currency.toUpperCase() === 'USDT')
        .reduce((sum, b) => sum + b.available + b.locked, 0)
    : null
  /* 合约 total + 现货；估值在渲染层用 totalAsset + unrealisedPnl */
  const totalAsset =
    futTotal != null || totalAssetSpot != null
      ? (futTotal ?? 0) + (totalAssetSpot ?? 0)
      : null

  const failed = [futAccOk, futPosOk, spotAccOk].filter((ok) => !ok).length
  return {
    total: futTotal,
    available: futAccOk ? Number(futAcc!.available) : null,
    unrealisedPnl,
    totalAsset,
    totalAssetSpot,
    openPositions: futPosOk ? openPositions : null,
    spotBalances: spotAccOk ? spotBalances : null,
    balanceError: futAccOk ? undefined : accountFailureReason(futAccResult),
    positionError: futPosOk ? undefined : accountFailureReason(futPosResult),
    spotError: spotAccOk ? undefined : accountFailureReason(spotAccResult),
    partial: failed > 0,
    updatedAt: Date.now(),
  }
}
