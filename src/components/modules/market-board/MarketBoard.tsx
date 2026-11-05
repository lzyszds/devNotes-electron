import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDown, ArrowUp, Banknote, Bell, Coins, ExternalLink, Eye, KeyRound, Newspaper, RefreshCw, Search, ShieldCheck, Star, Trash2, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import ToolShell from '../../ui/ToolShell'
import { useToast } from '../../ui/Toast'

type Market = 'contract' | 'spot' | 'position'
type Asset = 'crypto' | 'equity'
type Quote = { symbol: string; name: string; kind: 'contract' | 'spot'; asset: Asset; price: number; changePercent: number; change: number; currency: string; fundingRate?: number; openInterest?: number; turnover24h?: number; high24h?: number; low24h?: number; markPrice?: number; nextFundingTime?: number; fundingIntervalHours?: number; longRatio?: number; updatedAt: number }
type WatchItem = { symbol: string; name: string; kind: 'contract' | 'spot'; asset: Asset }
type News = { title: string; url: string; source: string; publishedAt: string }
type Alert = { id: string; symbol: string; direction: 'above' | 'below'; price: number; triggered: boolean }

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

/* 失败的接口回 null（不是 0），渲染层据此显示 --；只有成功响应里的 0 / 空数组才是真实空仓 */
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

const STORE_KEY = 'market-board-watchlist-v1'
const ALERT_KEY = 'market-board-alerts-v1'
const QUOTES_CACHE_KEY = 'market-board-quotes-cache-v1'
const CANDLES_CACHE_KEY = 'market-board-candles-cache-v1'
const LAST_UPDATED_KEY = 'market-board-last-updated-v1'
const NEWS_CACHE_KEY = 'market-board-news-cache-v1'
const MARKET_TAB_KEY = 'market-board-market-tab-v1'
const SELECTED_SYMBOL_KEY = 'market-board-selected-symbol-v1'
const ACCOUNT_CACHE_KEY = 'market-board-account-cache-v1'

const SYMBOL_NAMES: Record<string, string> = {
  MU: '美光科技 (Micron)',
  MSFT: '微软 (Microsoft)',
  SPCX: 'SpaceX 合成',
  TSLA: '特斯拉 (Tesla)',
  NVDA: '英伟达 (NVIDIA)',
  AAPL: '苹果 (Apple)',
  AMZN: '亚马逊 (Amazon)',
  GOOG: '谷歌 (Google)',
  GOOGL: '谷歌 (Google)',
  META: 'Meta (脸书)',
  BTC: '比特币 (Bitcoin)',
  ETH: '以太坊 (Ethereum)',
  SOL: 'Solana',
}

function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const DEFAULTS: WatchItem[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', kind: 'contract', asset: 'crypto' },
  { symbol: 'ETHUSDT', name: 'Ethereum', kind: 'contract', asset: 'crypto' },
  { symbol: 'SOLUSDT', name: 'Solana', kind: 'contract', asset: 'crypto' },
  { symbol: 'BTCUSDT', name: 'Bitcoin', kind: 'spot', asset: 'crypto' },
  { symbol: 'ETHUSDT', name: 'Ethereum', kind: 'spot', asset: 'crypto' },
  { symbol: 'SOLUSDT', name: 'Solana', kind: 'spot', asset: 'crypto' },
  { symbol: 'MU', name: 'Micron Technology', kind: 'spot', asset: 'equity' },
  { symbol: 'sh600000', name: '浦发银行', kind: 'spot', asset: 'equity' },
  { symbol: 'sz000001', name: '平安银行', kind: 'spot', asset: 'equity' },
  { symbol: 'hk00700', name: '腾讯控股', kind: 'spot', asset: 'equity' },
]
const fmt = (n: number, digits = 2) => {
  if (!Number.isFinite(n)) return '--'
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function money(n: number, currency = 'USDT', showPlus = false): string {
  if (!Number.isFinite(n)) return '--'
  const isNeg = n < 0
  const abs = Math.abs(n)
  const sign = isNeg ? '-' : (showPlus && n > 0 ? '+' : '')
  const digits = abs >= 100 ? 2 : (abs >= 1 ? 2 : 4)
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (currency === 'USDT' || currency === 'USD') return `${sign}$${formatted}`
  if (currency === 'CNY') return `${sign}¥${formatted}`
  if (currency === 'HKD') return `${sign}HK$${formatted}`
  return `${sign}${formatted} ${currency}`
}

function formatToken(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n < 0.0001) return n.toFixed(8).replace(/\.?0+$/, '')
  if (n < 1) return n.toFixed(4)
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function decodeHtmlEntities(str: string): string {
  if (!str) return ''
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
}
const baseSymbol = (symbol: string) => symbol.replace(/USDT$/i, '').toUpperCase()
const quoteKey = (item: { kind?: string; symbol: string }) => `${item.kind || 'contract'}:${item.symbol.toLowerCase()}`

function getSparklinePoints(
  series: number[] | undefined,
  quote: Quote | undefined,
  width = 96,
  height = 26
): string {
  let values: number[] = []
  if (Array.isArray(series) && series.length >= 2) {
    values = series
  } else if (quote && Number.isFinite(quote.price) && quote.price > 0) {
    const cur = quote.price
    const prev = cur / (1 + (quote.changePercent || 0) / 100)
    const high = quote.high24h && quote.high24h > 0 ? Math.max(quote.high24h, cur, prev) : Math.max(cur, prev) * 1.01
    const low = quote.low24h && quote.low24h > 0 ? Math.min(quote.low24h, cur, prev) : Math.min(cur, prev) * 0.99
    const mid1 = prev + (high - prev) * 0.4
    const mid2 = low + (high - low) * 0.3
    const mid3 = low + (cur - low) * 0.7
    values = [prev, (prev + mid1) / 2, mid1, high, (high + low) / 2, low, mid2, mid3, (mid3 + cur) / 2, cur]
  }

  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const paddingY = 2
  const effHeight = height - paddingY * 2

  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - paddingY - ((v - min) / range) * effHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function SymbolIcon({ item, size }: { item: { symbol: string; name?: string; asset?: Asset; kind?: string }; size: number }) {
  const [failedSrc, setFailedSrc] = useState('')
  const symbol = baseSymbol(item.symbol)
  const cryptoIconSymbol = symbol === 'XBT' ? 'btc' : symbol.toLowerCase()
  const isKnownStock = /^(MU|MSFT|SPCX|TSLA|NVDA|AAPL|AMZN|GOOG|GOOGL|META)$/i.test(symbol)
  const src = item.asset === 'equity' || isKnownStock
    ? `https://financialmodelingprep.com/image-stock/${symbol}.png`
    : `https://assets.coincap.io/assets/icons/${cryptoIconSymbol}@2x.png`
  return <span className="shrink-0 rounded-full border border-zinc-200 bg-white overflow-hidden flex items-center justify-center text-[10px] font-semibold text-zinc-600" style={{ width: size, height: size }}>
    {failedSrc !== src && src ? <img src={src} alt={`${symbol} logo`} width={size} height={size} className="h-full w-full object-contain" onError={() => setFailedSrc(src)}/> : item.asset === 'crypto' && symbol === 'BTC' ? <span className="text-[#F7931A]">₿</span> : item.asset === 'crypto' && symbol === 'ETH' ? <span className="text-[#627EEA]">Ξ</span> : symbol.slice(0, 3)}
  </span>
}

export default function MarketBoard() {
  const { showToast } = useToast()

  /* 同步从 localStorage 读取历史快照，在第 0 帧直接呈现上次数据，彻底消除白屏与空卡片抖动 */
  const [market, setMarket] = useState<Market>(() => readLocalStorage<Market>(MARKET_TAB_KEY, 'contract'))
  const [watchlist, setWatchlist] = useState<WatchItem[]>(() => readLocalStorage<WatchItem[]>(STORE_KEY, DEFAULTS))
  const [quotes, setQuotes] = useState<Quote[]>(() => readLocalStorage<Quote[]>(QUOTES_CACHE_KEY, []))
  // 未确认本机已配置凭据前不展示历史账户快照，避免把旧缓存误认为当前账户。
  const [accountData, setAccountData] = useState<GateAccountData | null>(null)
  const [input, setInput] = useState('')
  /* 初始 loading 设为 true，右上角旋转图标提示用户“正在静默同步最新数据” */
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(() => readLocalStorage<Quote[]>(QUOTES_CACHE_KEY, []).length > 0)
  const [watchlistLoaded, setWatchlistLoaded] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<number | null>(() => readLocalStorage<number | null>(LAST_UPDATED_KEY, null))
  const [selectedSymbol, setSelectedSymbol] = useState<string>(() => readLocalStorage<string>(SELECTED_SYMBOL_KEY, 'BTCUSDT'))
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above')
  const [alertPrice, setAlertPrice] = useState('')
  const [sortBy, setSortBy] = useState<'default' | 'change' | 'funding'>('default')
  const [newsLoading, setNewsLoading] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [candlesMap, setCandlesMap] = useState<Record<string, number[]>>(() => readLocalStorage<Record<string, number[]>>(CANDLES_CACHE_KEY, {}))
  const [news, setNews] = useState<News[]>(() => readLocalStorage<News[]>(NEWS_CACHE_KEY, []))
  const [newsError, setNewsError] = useState('')
  const [credentialStatus, setCredentialStatus] = useState<{ configured: boolean; encryptionAvailable: boolean } | null>(null)
  const [showCredentialForm, setShowCredentialForm] = useState(false)
  const [credentialKey, setCredentialKey] = useState('')
  const [credentialSecret, setCredentialSecret] = useState('')
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [credentialError, setCredentialError] = useState('')
  const [accountError, setAccountError] = useState('')
  // 账户首次加载中：卡片要显示“加载中”而不是 0，失败后同理显示 --
  const [accountLoading, setAccountLoading] = useState(false)

  /*
   * latest-request-only：行情/账户/新闻各自一个单调递增序号，响应回来时对不上号就整包丢弃。
   * 手动刷新、定时器、凭据变更会并发发起请求，慢的旧请求后到不能覆盖新状态。
   * account 还要额外叠加凭据代际：保存/清除凭据时旧 Key 发出的请求一律作废。
   */
  const quotesSeq = useRef(0)
  const accountSeq = useRef(0)
  const accountGen = useRef(0)
  const newsSeq = useRef(0)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    void window.electronAPI?.gateCredentialsStatus?.().then((status) => { if (alive.current) setCredentialStatus(status) }).catch(() => { if (alive.current) setCredentialError('无法读取安全存储状态') })
  }, [])

  useEffect(() => { void window.electronAPI?.storeGet(ALERT_KEY).then((saved) => { if (Array.isArray(saved)) setAlerts(saved.filter((item) => typeof item?.symbol === 'string').map((item) => ({ ...item, symbol: item.symbol.includes(':') ? item.symbol : `${/^(sh|sz|hk)/i.test(item.symbol) ? 'spot' : 'contract'}:${item.symbol}` }))) }).catch(() => {}) }, [])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const persist = useCallback((next: WatchItem[]) => {
    setWatchlist(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch {}
    void window.electronAPI?.storeSet(STORE_KEY, next).catch(() => {})
  }, [])

  const handleMarketChange = (key: Market) => {
    setMarket(key)
    setInput('')
    try { localStorage.setItem(MARKET_TAB_KEY, JSON.stringify(key)) } catch {}
  }

  const handleSelectSymbol = (symbol: string) => {
    setSelectedSymbol(symbol)
    try { localStorage.setItem(SELECTED_SYMBOL_KEY, JSON.stringify(symbol)) } catch {}
  }

  const refreshAccount = useCallback(async () => {
    const api = window.electronAPI?.marketAccount
    if (!api || credentialStatus?.configured !== true) return
    const gen = accountGen.current
    const seq = ++accountSeq.current
    const isCurrent = () => alive.current && gen === accountGen.current && seq === accountSeq.current
    if (!accountData) setAccountLoading(true)
    try {
      const data = await api()
      if (!isCurrent() || !data) return
      setAccountData(data)
      // 只把真正可用的整份快照落盘；部分失败的数据带 null，下次启动不足以离线还原
      // 部分失败只提示失败面（余额/持仓/现货各自有分区标题），不误报成整份账户不可用
      setAccountError(data.partial ? '部分账户数据加载失败，缺失的数值以 -- 显示' : '')
      try {
        if (data.partial) localStorage.removeItem(ACCOUNT_CACHE_KEY)
        else localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(data))
      } catch {}
    } catch (cause) {
      if (!isCurrent()) return
      // 失败时保留上一次成功的快照（若在），错误条会明确说明，不与零资产混淆
      setAccountError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '账户数据暂时不可用')
    } finally {
      if (isCurrent()) setAccountLoading(false)
    }
  }, [credentialStatus?.configured, accountData])

  /* 凭据变更：先作废在飞请求与新代际，再清空展示，避免旧账户残留在界面上 */
  const invalidateAccount = useCallback(() => {
    accountGen.current++
    accountSeq.current++
    setAccountLoading(false)
    setAccountData(null)
    setAccountError('')
    try { localStorage.removeItem(ACCOUNT_CACHE_KEY) } catch {}
  }, [])

  const saveCredentials = async () => {
    const api = window.electronAPI?.gateCredentialsSave
    if (!api || credentialSaving) return
    setCredentialSaving(true)
    setCredentialError('')
    try {
      const status = await api({ key: credentialKey, secret: credentialSecret })
      if (!alive.current) return
      setCredentialStatus(status)
      setCredentialKey('')
      setCredentialSecret('')
      setShowCredentialForm(false)
      invalidateAccount()
      showToast('Gate.io 只读凭据已加密保存')
    } catch (cause) {
      setCredentialError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '凭据保存失败')
    } finally {
      setCredentialSaving(false)
    }
  }

  const clearCredentials = async () => {
    const api = window.electronAPI?.gateCredentialsClear
    if (!api) return
    try {
      const status = await api()
      if (!alive.current) return
      setCredentialStatus(status)
      invalidateAccount()
      setShowCredentialForm(false)
      showToast('Gate.io 凭据已移除')
    } catch {
      setCredentialError('凭据移除失败，请重试')
    }
  }

  /* 打开持仓页且已配置凭据、却还没有账户数据时拉一次，避免只靠行情刷新带出账户 */
  useEffect(() => {
    if (market === 'position' && credentialStatus?.configured === true && !accountData && !accountLoading && !accountError) {
      void refreshAccount()
    }
  }, [market, credentialStatus?.configured, accountData, accountLoading, accountError, refreshAccount])

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.marketQuotes
    if (!api) { setError('请在桌面版中查看实时行情'); setHasLoaded(true); setLoading(false); return }
    const seq = ++quotesSeq.current
    const isCurrent = () => alive.current && seq === quotesSeq.current
    setLoading(true); setError('')
    try {
      const positionContracts = (accountData?.openPositions ?? []).map((p) => p.contract.replace('_', ''))
      const contracts = [...new Set([...watchlist.filter((x) => x.kind === 'contract').map((x) => x.symbol), ...positionContracts])]
      const [quotesResult] = await Promise.allSettled([
        api({ spot: watchlist.filter((x) => x.kind === 'spot').map((x) => x.symbol), contracts }),
        refreshAccount(),
      ])
      // 已有更新的刷新发出去了：这次结果直接丢弃，连缓存也不写
      if (!isCurrent()) return
      if (quotesResult.status === 'fulfilled') {
        const next = quotesResult.value
        if (next.length || !watchlist.length) {
          setQuotes(next)
          try { localStorage.setItem(QUOTES_CACHE_KEY, JSON.stringify(next)) } catch {}
        }
        if (next.length) {
          const updated = Math.max(...next.map((item) => item.updatedAt))
          setLastUpdated(updated)
          try { localStorage.setItem(LAST_UPDATED_KEY, JSON.stringify(updated)) } catch {}
        }
      }
      setHasLoaded(true)
      if (quotesResult.status === 'fulfilled' && quotesResult.value.length < watchlist.length) {
        setError('部分自选暂无行情，请检查代码是否受数据源支持或稍后重试')
      }
    } catch (cause) {
      if (!isCurrent()) return
      setError(cause instanceof Error ? cause.message : '行情获取失败')
      setHasLoaded(true)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [watchlist, accountData?.openPositions, refreshAccount])

  useEffect(() => {
    let active = true
    const load = window.electronAPI?.storeGet(STORE_KEY) ?? Promise.resolve(undefined)
    void load.then((saved) => {
      if (active && Array.isArray(saved) && saved.every((item) => item && typeof item.symbol === 'string')) {
        const migrated = saved.flatMap((item) => {
          if (item.kind === 'contract' || item.kind === 'spot') {
            const equity = /^(MU|TSLA|NVDA|AAPL|MSFT|AMZN|GOOG|META)USDT$/i.test(item.symbol) || /^(sh|sz|hk)/i.test(item.symbol) || !item.symbol.toUpperCase().endsWith('USDT')
            return [{ symbol: item.symbol, name: item.name || item.symbol, kind: equity ? 'spot' as const : item.kind, asset: equity ? 'equity' as const : item.asset || 'crypto' as const }]
          }
          if (item.market === 'stock') return [{ symbol: item.symbol, name: item.name || item.symbol, kind: 'spot' as const, asset: 'equity' as const }]
          if (item.market === 'equity') {
            if (/^(MU|TSLA|NVDA|AAPL|MSFT|AMZN|GOOG|META)USDT$/i.test(item.symbol)) return [{ symbol: item.symbol.replace(/USDT$/i, ''), name: item.name || item.symbol, kind: 'spot' as const, asset: 'equity' as const }]
            return [{ symbol: item.symbol, name: item.name || item.symbol, kind: 'contract' as const, asset: 'crypto' as const }]
          }
          return [{ symbol: item.symbol, name: item.name || item.symbol, kind: 'contract' as const, asset: 'crypto' as const }]
        })
        setWatchlist(migrated)
      }
    }).catch(() => {}).finally(() => { if (active) setWatchlistLoaded(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!watchlistLoaded) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [watchlistLoaded, refresh, market])

  const quoteMap = useMemo(() => new Map(quotes.map((q) => [quoteKey(q), q])), [quotes])
  const marketItems = watchlist.filter((item) => item.kind === market)
  const visible = marketItems.filter((item) => !input.trim() || `${item.symbol} ${item.name} ${quoteMap.get(quoteKey(item))?.name ?? ''}`.toLowerCase().includes(input.trim().toLowerCase()))

  const activePosition = accountData?.openPositions?.find((p) =>
    p.contract.toUpperCase() === selectedSymbol.toUpperCase() ||
    p.symbol.toUpperCase() === selectedSymbol.toUpperCase() ||
    p.contract.replace('_', '').toUpperCase() === selectedSymbol.replace('_', '').toUpperCase()
  ) ?? accountData?.openPositions?.[0]

  const active: WatchItem | undefined = market === 'position'
    ? (activePosition ? {
        symbol: activePosition.contract,
        name: SYMBOL_NAMES[activePosition.symbol] ?? activePosition.symbol,
        kind: 'contract',
        asset: /^(MU|MSFT|SPCX|TSLA|NVDA|AAPL|AMZN|GOOG|META)$/i.test(activePosition.symbol) ? 'equity' : 'crypto',
      } : marketItems[0])
    : (marketItems.find((item) => item.symbol === selectedSymbol) ?? marketItems[0])

  const activeQuote = active ? (quoteMap.get(quoteKey(active)) ?? quoteMap.get(`contract:${active.symbol.replace('_', '').toLowerCase()}`)) : undefined
  const highlights = marketItems.filter((item) => quoteMap.has(quoteKey(item))).slice(0, 3)
  const positive = (activeQuote?.changePercent ?? 0) >= 0

  /* 账户指标的派生态：null 一律表示“没拿到”，与真实的 0 严格区分 */
  const pnlValue = accountData?.unrealisedPnl ?? null
  const principal = accountData?.total != null && accountData.unrealisedPnl != null ? accountData.total - accountData.unrealisedPnl : null
  const pnlPercent = pnlValue != null && accountData?.total != null
    ? `${(pnlValue / (accountData.total - pnlValue || 1) * 100).toFixed(2)}%`
    : '--'

  const heldPositionForActive = useMemo(() => {
    if (!active || !accountData?.openPositions) return undefined
    return accountData.openPositions.find((p) =>
      p.contract.toUpperCase() === active.symbol.toUpperCase() ||
      p.symbol.toUpperCase() === baseSymbol(active.symbol) ||
      p.contract.replace('_', '').toUpperCase() === active.symbol.replace('_', '').toUpperCase()
    )
  }, [active, accountData])

  const activeCandleKey = active ? `${active.kind}:${active.symbol.toUpperCase()}` : ''
  const activeSeries = active ? (candlesMap[activeCandleKey] ?? []) : []
  const sidebarPoints = useMemo(() => {
    if (activeSeries.length < 2) return ''
    const min = Math.min(...activeSeries)
    const max = Math.max(...activeSeries)
    const range = max - min || 1
    return activeSeries.map((v, i) => `${(i / (activeSeries.length - 1)) * 256},${38 - ((v - min) / range) * 34}`).join(' ')
  }, [activeSeries])

  /* 当前请求序号：lastUpdated 每 30s 变一次会重跑本 effect，旧响应不能再写回同一个 key */
  const activeCandleSeq = useRef(0)
  useEffect(() => {
    if (!active) return
    const candleKey = `${active.kind}:${active.symbol.toUpperCase()}`
    const seq = ++activeCandleSeq.current
    let cancelled = false
    void (async () => {
      try {
        const result = await window.electronAPI?.marketCandles?.({ symbol: active.symbol, kind: active.kind })
        if (!cancelled && seq === activeCandleSeq.current && Array.isArray(result) && result.length > 0) {
          setCandlesMap((prev) => {
            const next = { ...prev, [candleKey]: result }
            try { localStorage.setItem(CANDLES_CACHE_KEY, JSON.stringify(next)) } catch {}
            return next
          })
        }
      } catch {
        /* 失败时保留历史缓存走势，不强行清空 */
      }
    })()
    return () => { cancelled = true }
  }, [active?.symbol, active?.kind, lastUpdated])

  /* 预加载自选列表标的的 24h 真实 K 线数据，支持表格与顶部卡片直接绘制 SVG Sparkline 走势图 */
  useEffect(() => {
    if (!watchlistLoaded || market === 'position') return
    const targets = marketItems.slice(0, 15)
    let cancelled = false

    const fetchAllCandles = async () => {
      for (const item of targets) {
        if (cancelled) break
        const candleKey = `${item.kind}:${item.symbol.toUpperCase()}`
        if (candlesMap[candleKey] && candlesMap[candleKey].length > 0) continue
        try {
          const res = await window.electronAPI?.marketCandles?.({ symbol: item.symbol, kind: item.kind })
          if (!cancelled && Array.isArray(res) && res.length > 0) {
            setCandlesMap((prev) => {
              const updated = { ...prev, [candleKey]: res }
              try { localStorage.setItem(CANDLES_CACHE_KEY, JSON.stringify(updated)) } catch {}
              return updated
            })
          }
        } catch {}
      }
    }

    void fetchAllCandles()
    return () => { cancelled = true }
  }, [watchlistLoaded, market, marketItems, lastUpdated])

  const loadNews = useCallback(async () => {
    if (!alive.current) return
    const seq = ++newsSeq.current
    const isCurrent = () => alive.current && seq === newsSeq.current
    setNewsLoading(true)
    const keepingCache = news.length > 0
    try {
      const result = await window.electronAPI?.marketNews?.()
      if (!isCurrent()) return
      if (result && result.length) {
        setNews(result)
        try { localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(result)) } catch {}
      }
      setNewsError(result?.length || keepingCache ? '' : '新闻暂不可用')
    } catch {
      if (!isCurrent()) return
      setNewsError(keepingCache ? '更新失败，显示缓存新闻' : '新闻暂不可用')
    } finally {
      if (isCurrent()) setNewsLoading(false)
    }
  }, [news.length])
  useEffect(() => {
    void loadNews()
    const timer = window.setInterval(() => void loadNews(), 5 * 60_000)
    return () => window.clearInterval(timer)
  }, [loadNews])
  const sortedVisible = useMemo(() => sortBy === 'default' ? visible : visible.slice().sort((a, b) => {
    const qa = quoteMap.get(quoteKey(a)), qb = quoteMap.get(quoteKey(b))
    return sortBy === 'change' ? (qb?.changePercent ?? -Infinity) - (qa?.changePercent ?? -Infinity) : (qb?.fundingRate ?? -Infinity) - (qa?.fundingRate ?? -Infinity)
  }), [sortBy, visible, quoteMap])

  useEffect(() => {
    const next = alerts.map((alert) => {
      if (alert.triggered) return alert
      const [kind, symbol] = alert.symbol.split(':')
      const found = quoteMap.get(`${kind}:${symbol?.toLowerCase() ?? ''}`)
      const price = found?.kind === kind ? found.price : undefined
      const hit = price != null && (alert.direction === 'above' ? price >= alert.price : price <= alert.price)
      if (hit && 'Notification' in window && Notification.permission === 'granted') new Notification(`${symbol} 价格预警`, { body: `最新价 ${fmt(price!)}，已${alert.direction === 'above' ? '达到' : '低于'} ${fmt(alert.price)}` })
      return hit ? { ...alert, triggered: true } : alert
    })
    if (next.some((item, index) => item.triggered !== alerts[index]?.triggered)) { setAlerts(next); void window.electronAPI?.storeSet(ALERT_KEY, next).catch(() => {}) }
  }, [quotes])

  const addAlert = () => {
    const price = Number(alertPrice)
    if (!active || !Number.isFinite(price) || price <= 0) { showToast('请输入有效预警价格', 'error'); return }
    const next = [...alerts, { id: `${Date.now()}`, symbol: `${active.kind}:${active.symbol}`, direction: alertDirection, price, triggered: false }]
    setAlerts(next); void window.electronAPI?.storeSet(ALERT_KEY, next).catch(() => {})
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    setAlertPrice('')
  }
  const removeAlert = (id: string) => { const next = alerts.filter((alert) => alert.id !== id); setAlerts(next); void window.electronAPI?.storeSet(ALERT_KEY, next).catch(() => {}) }
  const formatCompact = (value?: number, currency = 'USDT') => value == null || !Number.isFinite(value) ? '--' : `${currency === 'USDT' || currency === 'USD' ? '$' : ''}${value >= 1e9 ? `${(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : fmt(value, 0)}${currency === 'CNY' ? ' ¥' : currency === 'HKD' ? ' HKD' : ''}`
  const countdown = (timestamp?: number) => { if (!timestamp) return '--'; const seconds = Math.max(0, Math.floor((timestamp - now) / 1000)); return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }

  const addItem = (value = input) => {
    const raw = value.trim()
    if (!raw) return
    const isCnStock = /^(sh|sz|hk)?\d{4,6}$/i.test(raw)
    const isKnownEquity = /^(MU|TSLA|NVDA|AAPL|MSFT|AMZN|GOOG|META)$/i.test(raw.replace(/USDT$/i, ''))
    const base = baseSymbol(raw.replace(/[-/]/g, ''))
    const asset: Asset = isCnStock || isKnownEquity ? 'equity' : 'crypto'
    const itemKind: 'contract' | 'spot' = market === 'spot' ? 'spot' : 'contract'
    if (!/^[A-Z0-9]{1,24}$/.test(base) || (itemKind === 'contract' && isCnStock)) { showToast('请输入有效标的代码', 'error'); return }
    const symbol = itemKind === 'spot'
      ? isCnStock ? raw.toLowerCase() : asset === 'equity' ? raw.toUpperCase() : `${raw.replace(/[-/]/g, '').toUpperCase().replace(/USDT$/, '')}USDT`
      : `${raw.replace(/[-/]/g, '').toUpperCase().replace(/USDT$/, '')}USDT`
    const normalized = itemKind === 'spot' && /^(\d{5})$/.test(symbol) ? `hk${symbol}` : itemKind === 'spot' && /^\d{6}$/.test(symbol) ? `${symbol.startsWith('6') ? 'sh' : 'sz'}${symbol}` : symbol
    if (watchlist.some((x) => x.kind === itemKind && x.symbol.toLowerCase() === normalized.toLowerCase())) { showToast('已经在自选列表中', 'default'); return }
    if (itemKind === 'spot' && /^[a-z]{2}\d+$/i.test(normalized) && !/^(sh|sz|hk)\d{4,6}$/i.test(normalized)) { showToast('股票代码格式不正确', 'error'); return }
    persist([...watchlist, { symbol: normalized, name: normalized, kind: itemKind, asset }])
    setSelectedSymbol(normalized)
    setInput('')
  }

  const removeItem = (item: WatchItem) => persist(watchlist.filter((x) => !(x.kind === item.kind && x.symbol === item.symbol)))

  return <ToolShell title="合约与现货" icon={Activity} scroll={false} showHeader={false}>
    <div className="absolute inset-0 flex flex-col bg-white text-zinc-900 select-none">
      {/* 顶栏控制条：精简且做严格防遮挡/防挤压适配 */}
      <div className="h-12 px-4 border-b border-zinc-100 flex items-center justify-between gap-3 shrink-0 bg-white">
        {/* 左侧：标签组与源状态 */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="bg-zinc-100/90 p-0.5 rounded-xl flex items-center text-xs font-medium shrink-0">
            {([['contract', '永续合约'], ['spot', '现货行情'], ['position', '持仓与资产']] as const).map(([key, label]) => {
              const count = key === 'position' ? (accountData?.openPositions?.length ?? 0) : watchlist.filter((item) => item.kind === key).length
              const activeTab = market === key
              return (
                <button
                  key={key}
                  onClick={() => handleMarketChange(key)}
                  className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 text-xs ${
                    activeTab ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {key === 'position' && <Wallet className="w-3.5 h-3.5" />}
                  <span>{label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    activeTab ? 'bg-white/20 text-white' : 'bg-zinc-200 text-zinc-600'
                  }`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-zinc-400 pl-1">
            <span className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-rose-500' : loading ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            <span className="truncate max-w-[220px]">
              {market === 'position' ? 'Gate.io 官方只读同步' : market === 'contract' ? 'USDT 永续合约' : '全球现货行情'}
            </span>
          </div>
        </div>

        {/* 右侧：搜索与刷新 */}
        <div className="flex items-center gap-2 shrink-0">
          {market !== 'position' && (
            <div className="flex items-center bg-zinc-100/80 focus-within:bg-white border border-transparent focus-within:border-zinc-300 rounded-xl pl-2.5 pr-1 py-1 transition-all w-48 sm:w-60">
              <Search className="w-3.5 h-3.5 text-zinc-400 mr-1.5 shrink-0"/>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                placeholder={market === 'contract' ? '搜索/添加合约 (如 BTC, MU)...' : '搜索/添加现货...'}
                className="bg-transparent outline-none text-xs w-full text-zinc-800 placeholder:text-zinc-400"
              />
              <button
                onClick={() => addItem()}
                className="px-2 py-0.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-[10px] font-medium shrink-0"
              >
                +自选
              </button>
            </div>
          )}

          {market === 'position' && (
            <button
              onClick={() => { setShowCredentialForm((value) => !value); setCredentialError('') }}
              className="h-8 px-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 flex items-center gap-1.5 text-[11px] text-zinc-500"
              title="配置 Gate.io 只读 API 凭据"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {credentialStatus?.configured ? '凭据' : '配置账户'}
            </button>
          )}
          <button
            onClick={() => void refresh()}
            disabled={loading}
            title={loading ? '正在同步数据…' : '立即刷新'}
            className="h-8 px-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 flex items-center gap-1.5 text-[11px] text-zinc-500 transition-colors"
          >
            <span className="font-mono tabular-nums">{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '刷新'}</span>
            <RefreshCw className={`w-3.5 h-3.5 text-zinc-600 ${loading ? 'animate-spin text-amber-600' : ''}`}/>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-5 py-1.5 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-100 shrink-0 flex items-center justify-between">
          <span>{error}{quotes.length > 0 && '，当前保留上次成功获取的数据'}</span>
          <button onClick={() => void refresh()} className="font-medium hover:text-amber-950">重试</button>
        </div>
      )}

      {/* 主体布局：左侧滚动主内容 + 右侧折叠/独立盯盘侧栏 */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto thin-scrollbar p-4 lg:p-5 gap-4">
          {market === 'position' && (credentialStatus?.configured !== true || showCredentialForm) ? (
            <section className="max-w-xl mx-auto w-full mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-zinc-100"><KeyRound className="w-5 h-5 text-zinc-600" /></div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900">连接 Gate.io 只读账户</h2>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">请仅使用关闭交易与提现权限的 API Key。凭据经系统安全存储加密后保存在本机，不会上传或打包进应用。</p>
                </div>
              </div>
              {credentialStatus === null ? (
                <div className="py-8 text-center text-xs text-zinc-400">正在检查系统安全存储…</div>
              ) : !credentialStatus.encryptionAvailable ? (
                <div className="mt-5 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800">当前系统安全存储不可用，请解锁系统钥匙串后重试。</div>
              ) : (
                <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); void saveCredentials() }}>
                  <label className="block">
                    <span className="text-[11px] font-medium text-zinc-600">API Key</span>
                    <input value={credentialKey} onChange={(event) => setCredentialKey(event.target.value)} type="password" autoComplete="off" spellCheck={false} className="mt-1.5 w-full h-10 px-3 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-mono outline-none focus:border-zinc-400 focus:bg-white" placeholder="输入只读 API Key" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-zinc-600">API Secret</span>
                    <input value={credentialSecret} onChange={(event) => setCredentialSecret(event.target.value)} type="password" autoComplete="new-password" spellCheck={false} className="mt-1.5 w-full h-10 px-3 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-mono outline-none focus:border-zinc-400 focus:bg-white" placeholder="输入 API Secret" />
                  </label>
                  {credentialError && <p className="text-xs text-rose-600">{credentialError}</p>}
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      {credentialStatus.configured && <button type="button" onClick={() => void clearCredentials()} className="text-xs text-rose-600 hover:text-rose-700">移除本机凭据</button>}
                    </div>
                    <div className="flex gap-2">
                      {credentialStatus.configured && <button type="button" onClick={() => { setShowCredentialForm(false); setCredentialKey(''); setCredentialSecret(''); setCredentialError('') }} className="h-9 px-4 rounded-xl border border-zinc-200 text-xs text-zinc-600">取消</button>}
                      <button type="submit" disabled={credentialSaving || !credentialKey.trim() || !credentialSecret.trim()} className="h-9 px-4 rounded-xl bg-zinc-900 text-white text-xs disabled:opacity-40">{credentialSaving ? '加密保存中…' : '加密保存并连接'}</button>
                    </div>
                  </div>
                </form>
              )}
            </section>
          ) : market === 'position' ? (
            <>
              {accountError && <div className="px-4 py-2.5 rounded-xl border border-amber-100 bg-amber-50 text-xs text-amber-800 flex items-center justify-between"><span>{accountError}</span><button onClick={() => void refreshAccount()} className="font-medium">重试</button></div>}
              {/* 资产权益与盈亏 4 栏精简概览卡片 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-3.5 rounded-2xl border border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white shadow-xs">
                  <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                    <span className="text-[11px] font-medium text-zinc-500">合约总资产权益</span>
                    <Wallet className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 tracking-tight">
                    {accountData?.total == null ? (accountLoading ? '加载中…' : '--') : `$${fmt(accountData.total, 2)}`}
                    <span className="text-[11px] font-normal text-zinc-400 ml-1">USDT</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
                    <span>保证金 + 浮动盈亏</span>
                    <span className="font-mono text-zinc-500">100% 净值</span>
                  </div>
                </div>

                <div className={`p-3.5 rounded-2xl border shadow-xs ${
                  pnlValue == null
                    ? 'border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white'
                    : pnlValue >= 0
                      ? 'border-emerald-200/80 bg-gradient-to-b from-emerald-50/40 to-white'
                      : 'border-rose-200/80 bg-gradient-to-b from-rose-50/40 to-white'
                }`}>
                  <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                    <span className="text-[11px] font-medium text-zinc-600">持仓未实现盈亏 (收益)</span>
                    {pnlValue == null ? <Activity className="w-4 h-4 text-zinc-300" /> : pnlValue >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-600" /> : <TrendingDown className="w-4 h-4 text-rose-600" />}
                  </div>
                  <div className={`text-xl font-bold font-mono tabular-nums tracking-tight ${pnlValue == null ? 'text-zinc-400' : pnlValue >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {pnlValue == null ? '--' : money(pnlValue, 'USDT', true)}
                  </div>
                  <div className="text-[10px] mt-1 flex items-center justify-between font-mono">
                    <span className={pnlValue == null ? 'text-zinc-400' : pnlValue >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                      收益率 {pnlPercent}
                    </span>
                    <span className="text-zinc-400">浮动净收益</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl border border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white shadow-xs">
                  <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                    <span className="text-[11px] font-medium text-zinc-500">可用保证金余额</span>
                    <ShieldCheck className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 tracking-tight">
                    {accountData?.available == null ? '--' : `$${fmt(accountData.available, 2)}`}
                    <span className="text-[11px] font-normal text-zinc-400 ml-1">USDT</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
                    <span>可开新仓 / 抗波动</span>
                    <span className="font-mono text-zinc-500">
                      占比 {accountData?.total && accountData.available != null ? ((accountData.available / accountData.total) * 100).toFixed(0) : '--'}%
                    </span>
                  </div>
                </div>

                {/* 第 4 张卡片：账户静态本金 (扣除盈亏前) 替换原名义价值 */}
                <div className="p-3.5 rounded-2xl border border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white shadow-xs">
                  <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                    <span className="text-[11px] font-medium text-zinc-500">账户本金 (未计浮盈)</span>
                    <Banknote className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 tracking-tight">
                    {principal == null ? '--' : `$${fmt(principal, 2)}`}
                    <span className="text-[11px] font-normal text-zinc-400 ml-1">USDT</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
                    <span className="truncate">
                      本金 {principal == null ? '--' : fmt(principal, 2)} + 浮盈 ({pnlValue == null ? '--' : money(pnlValue, 'USDT', true)})
                    </span>
                    <span className="font-mono text-zinc-500 shrink-0 ml-1">
                      净值 {accountData?.total == null ? '--' : `$${fmt(accountData.total, 2)}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* 持仓明细表格 */}
              <div className="rounded-2xl border border-zinc-200/80 overflow-hidden bg-white shrink-0 shadow-xs">
                <div className="px-4 py-3 bg-zinc-50/70 border-b border-zinc-200/60 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-zinc-800">已购股票 / 美股合成资产与合约持仓</span>
                    <span className="text-[11px] text-zinc-400 hidden sm:inline">点击任意行可在右侧面板查看实时 24h K 线走势与深度</span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-500">
                    占用保证金: {accountData?.openPositions ? `$${fmt(accountData.openPositions.reduce((s, p) => s + p.margin, 0), 2)}` : '--'} USDT
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100 text-[11px] font-medium text-zinc-400 bg-zinc-50/30">
                        <th className="py-2.5 pl-4 font-medium">标的资产</th>
                        <th className="py-2.5 text-center font-medium">方向 / 杠杆</th>
                        <th className="py-2.5 text-right font-medium">持仓数量 / 价值</th>
                        <th className="py-2.5 text-right font-medium">开仓成本 → 现价</th>
                        <th className="py-2.5 text-right font-medium">未结盈亏 (收益率)</th>
                        <th className="py-2.5 text-right font-medium">强平参考价</th>
                        <th className="py-2.5 text-right pr-4 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 text-xs">
                      {!accountData?.openPositions ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-xs text-zinc-400">
                            <Star className="w-5 h-5 mx-auto mb-2 opacity-50" />
                            {accountLoading ? '持仓加载中…' : `持仓数据不可用：${accountData?.positionError || accountError || '请重试'}`}
                          </td>
                        </tr>
                      ) : accountData.openPositions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-xs text-zinc-400">
                            <Star className="w-5 h-5 mx-auto mb-2 opacity-50" />
                            当前账户暂无活跃持仓
                          </td>
                        </tr>
                      ) : (
                        accountData.openPositions.map((pos) => {
                          const isShort = pos.side === 'short'
                          const isPnlPositive = pos.unrealisedPnl >= 0
                          const stockName = SYMBOL_NAMES[pos.symbol] ?? pos.symbol
                          const isSelected = selectedSymbol === pos.contract || selectedSymbol === pos.symbol || selectedSymbol === pos.contract.replace('_', '')
                          return (
                            <tr
                              key={pos.contract}
                              onClick={() => handleSelectSymbol(pos.contract)}
                              className={`group transition-colors cursor-pointer ${
                                isSelected ? 'bg-zinc-100/70 hover:bg-zinc-100/90' : 'hover:bg-zinc-50/80'
                              }`}
                            >
                              <td className="py-3 pl-4 relative">
                                {isSelected && <span className="absolute left-0 top-2 bottom-2 w-1 bg-zinc-900 rounded-r" />}
                                <div className="flex items-center gap-2.5">
                                  <SymbolIcon item={{ symbol: pos.symbol, asset: 'equity' }} size={30} />
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-zinc-900 text-xs">{stockName}</span>
                                      <span className="text-[10px] px-1 py-0.2 rounded bg-zinc-100 text-zinc-600 font-medium">
                                        {/^(MU|MSFT|SPCX|TSLA|NVDA|AAPL|AMZN|GOOG|META)$/i.test(pos.symbol) ? '美股合成' : '合约'}
                                      </span>
                                    </div>
                                    <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{pos.contract}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 text-center">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold text-[11px] border ${
                                  isShort ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${isShort ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                                  {isShort ? '做空' : '做多'} {pos.leverage}x
                                </span>
                              </td>
                              <td className="py-3 text-right font-mono tabular-nums">
                                <div className="font-bold text-zinc-900 text-xs">{pos.size} 张</div>
                                <div className="text-[11px] text-zinc-400 mt-0.5">{money(pos.value, 'USDT')}</div>
                              </td>
                              <td className="py-3 text-right font-mono tabular-nums">
                                <div className="text-zinc-700 text-xs">成本 {money(pos.entryPrice, 'USDT')}</div>
                                <div className="text-[11px] text-zinc-400 mt-0.5">现价 {money(pos.markPrice, 'USDT')}</div>
                              </td>
                              <td className="py-3 text-right font-mono tabular-nums">
                                <div className={`font-bold text-xs ${isPnlPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  {money(pos.unrealisedPnl, 'USDT', true)}
                                </div>
                                <div className={`text-[11px] font-semibold mt-0.5 ${isPnlPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  {isPnlPositive ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                                </div>
                              </td>
                              <td className="py-3 text-right font-mono tabular-nums">
                                <div className="text-zinc-700 text-xs">{pos.liqPrice > 0 ? money(pos.liqPrice, 'USDT') : '无强平风险'}</div>
                                <div className="text-[10px] text-zinc-400 mt-0.5">保证金 {money(pos.margin, 'USDT')}</div>
                              </td>
                              <td className="py-3 pr-4 text-right">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSelectSymbol(pos.contract) }}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all inline-flex items-center gap-1 ${
                                    isSelected
                                      ? 'bg-zinc-900 text-white shadow-xs'
                                      : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-900 hover:text-white hover:border-zinc-900'
                                  }`}
                                >
                                  <Eye className="w-3 h-3" />
                                  {isSelected ? '盯盘中' : '盯盘'}
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 现货钱包余额：接口失败时明确提示，不当作“没有资产” */}
              {accountData && accountData.spotBalances === null && (
                <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-xs text-amber-800">
                  现货钱包数据不可用{accountData.spotError ? `：${accountData.spotError}` : ''}，请稍后重试
                </div>
              )}
              {accountData && accountData.spotBalances !== null && accountData.spotBalances.length === 0 && (
                <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 text-xs text-zinc-400">
                  现货钱包暂无可展示的资产
                </div>
              )}
              {accountData && accountData.spotBalances && accountData.spotBalances.length > 0 && (
                <div className="rounded-2xl border border-zinc-200/80 overflow-hidden bg-white shrink-0 p-4 shadow-xs">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-zinc-500" />
                      <span className="text-xs font-bold text-zinc-800">现货钱包资产 (Spot Wallet)</span>
                    </div>
                    <span className="text-[11px] text-zinc-400">非合约保证金资产</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {accountData.spotBalances.map((b) => (
                      <div key={b.currency} className="p-3 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-zinc-800">{b.currency}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-200/70 text-zinc-500 font-medium">现货</span>
                          </div>
                          <div className="text-sm font-bold font-mono tabular-nums text-zinc-900 mt-1">
                            {formatToken(b.available)}
                          </div>
                          {b.locked > 0 && (
                            <div className="text-[10px] text-amber-600 font-mono mt-0.5">冻结: {formatToken(b.locked)}</div>
                          )}
                        </div>
                        <span className="text-lg text-zinc-300 font-mono font-bold">
                          {b.currency === 'BTC' ? '₿' : b.currency === 'USDT' ? '$' : b.currency.slice(0, 1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* 原合约/现货 3 卡片走势 Highlights */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {highlights.map((item) => {
                  const quote = quoteMap.get(quoteKey(item))!
                  const up = quote.changePercent >= 0
                  const candleKey = `${item.kind}:${item.symbol.toUpperCase()}`
                  const series = candlesMap[candleKey] ?? []
                  const points = getSparklinePoints(series, quote, 80, 24)
                  return <button key={item.symbol} onClick={() => handleSelectSymbol(item.symbol)} className={`text-left p-3.5 rounded-2xl border transition-all ${selectedSymbol === item.symbol ? 'border-zinc-900 bg-white shadow-xs ring-2 ring-zinc-900/5' : 'border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white shadow-xs hover:border-zinc-300'}`}>
                      <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><SymbolIcon item={item} size={28}/><div><div className="flex items-center gap-1.5"><span className="text-xs font-bold">{baseSymbol(item.symbol)}</span><span className="text-[10px] px-1 py-0.5 rounded bg-zinc-200/70 text-zinc-600 font-medium">{market === 'contract' ? '永续' : '现货'}</span></div></div></div><span className={`px-2 py-0.5 rounded-md font-mono tabular-nums text-[11px] font-semibold ${up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{up ? '+' : ''}{fmt(quote.changePercent)}%</span></div>
                      <div className="flex items-end justify-between mt-2">
                        <div><div className="text-base font-bold font-mono tabular-nums">{money(quote.price, quote.currency)}</div><div className="text-[10px] text-zinc-400 mt-0.5 font-mono tabular-nums">{market === 'contract' ? `持仓 ${formatCompact(quote.openInterest)} · 费率 ${quote.fundingRate?.toFixed(4) ?? '--'}%` : `成交额 ${formatCompact(quote.turnover24h, quote.currency)}`}</div></div>
                        <svg className="w-20 h-8 overflow-visible" viewBox="0 0 80 32" aria-label={`${item.symbol} 24小时走势`}>{points && <polyline points={points} fill="none" stroke={up ? '#10b981' : '#e11d48'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}</svg>
                      </div>
                  </button>
                })}
                {highlights.length < 3 && Array.from({ length: 3 - highlights.length }, (_, i) => <div key={`placeholder-${i}`} className="min-h-[100px] p-3.5 rounded-2xl border border-dashed border-zinc-200 bg-white/60 flex items-center justify-center text-[11px] text-zinc-400">{loading && !quotes.length ? '行情同步中…' : '添加自选以显示行情'}</div>)}
              </div>

              {/* 自选行情列表 */}
              <div className="rounded-2xl border border-zinc-200/80 overflow-hidden bg-white shrink-0 shadow-xs">
                <div className="px-4 py-3 bg-zinc-50/70 border-b border-zinc-200/60 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-zinc-800">自选{market === 'contract' ? '合约' : '现货'}列表</span>
                    <span className="text-[11px] text-zinc-400">点击行在右侧查看 K 线与盘口</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                    <button onClick={() => setSortBy('default')} className={sortBy === 'default' ? 'text-zinc-900 font-medium' : ''}>默认</button>
                    <button onClick={() => setSortBy('change')} className={sortBy === 'change' ? 'text-zinc-900 font-medium' : ''}>涨跌幅 ↕</button>
                    {market === 'contract' && <button onClick={() => setSortBy('funding')} className={sortBy === 'funding' ? 'text-zinc-900 font-medium' : ''}>资金费率 ↕</button>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-100 text-[11px] font-medium text-zinc-400 bg-zinc-50/30">
                        <th className="py-2.5 pl-4 font-medium">标的 / 市场</th>
                        <th className="py-2.5 text-right font-medium">最新价</th>
                        <th className="py-2.5 text-right font-medium">24h 涨跌</th>
                        <th className="py-2.5 text-right font-medium pr-3">24h 走势</th>
                        {market === 'contract' && <th className="py-2.5 text-right font-medium">资金费率 / 倒计时</th>}
                        <th className="py-2.5 text-right pr-4 font-medium">{market === 'contract' ? '持仓价值 (OI)' : '成交额'}</th>
                        <th className="py-2.5 w-12"/>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 text-xs">
                      {!hasLoaded && loading ? (
                        <tr><td colSpan={market === 'spot' ? 6 : 7} className="py-12 text-center text-xs text-zinc-400"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin"/>正在连接行情源…</td></tr>
                      ) : sortedVisible.map((item) => {
                        const quote = quoteMap.get(quoteKey(item))
                        const up = (quote?.changePercent ?? 0) >= 0
                        const selected = selectedSymbol === item.symbol
                        const candleKey = `${item.kind}:${item.symbol.toUpperCase()}`
                        const series = candlesMap[candleKey]
                        const points = getSparklinePoints(series, quote, 96, 26)
                        return (
                          <tr key={quoteKey(item)} onClick={() => handleSelectSymbol(item.symbol)} className={`group transition-colors cursor-pointer ${selected ? 'bg-zinc-100/70 hover:bg-zinc-100/90' : 'hover:bg-zinc-50/80'}`}>
                            <td className="py-3 pl-4 relative">
                              {selected && <span className="absolute left-0 top-2 bottom-2 w-1 bg-zinc-900 rounded-r"/>}
                              <div className="flex items-center gap-2.5">
                                <SymbolIcon item={item} size={30}/>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-zinc-900 text-xs">{item.asset === 'equity' && item.symbol.length < 8 ? item.name : baseSymbol(item.symbol)}</span>
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-500 font-medium">{market === 'contract' ? '合约' : item.asset === 'crypto' ? '加密' : '股票'}</span>
                                  </div>
                                  <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{item.symbol}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 text-right font-mono tabular-nums font-bold text-xs text-zinc-900">{quote ? money(quote.price, quote.currency) : loading ? '…' : '--'}</td>
                            <td className="py-3 text-right"><span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg font-mono tabular-nums font-semibold text-xs ${quote ? up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600' : 'text-zinc-400'}`}>{quote && (up ? <ArrowUp className="w-3 h-3"/> : <ArrowDown className="w-3 h-3"/>)}{quote ? `${up ? '+' : ''}${fmt(quote.changePercent)}%` : '--'}</span></td>
                            <td className="py-3 text-right pr-3">
                              <div className="inline-flex items-center justify-end w-28">
                                <svg className="w-24 h-7 overflow-visible" viewBox="0 0 96 26" aria-label="24小时价格走势">
                                  {points ? (
                                    <polyline
                                      points={points}
                                      fill="none"
                                      stroke={up ? '#10b981' : '#f43f5e'}
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  ) : (
                                    <line x1="0" y1="13" x2="96" y2="13" stroke="#e4e4e7" strokeWidth="1" strokeDasharray="3 3" />
                                  )}
                                </svg>
                              </div>
                            </td>
                            {market === 'contract' && <td className="py-3 text-right font-mono tabular-nums"><div className={`font-medium text-xs ${(quote?.fundingRate ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{quote?.fundingRate != null ? `${quote.fundingRate >= 0 ? '+' : ''}${quote.fundingRate.toFixed(4)}%` : '--'}</div><div className="text-[10px] text-zinc-400">{quote?.nextFundingTime ? `${countdown(quote.nextFundingTime)} 后结算` : '--'}</div></td>}
                            <td className="py-3 text-right pr-4 font-mono tabular-nums"><div className="font-semibold text-zinc-800 text-xs">{market === 'contract' ? formatCompact(quote?.openInterest) : formatCompact(quote?.turnover24h, quote?.currency)}</div><div className="text-[10px] text-zinc-400">{market === 'contract' ? `24h 额 ${formatCompact(quote?.turnover24h)}` : quote?.turnover24h != null ? '真实成交额' : '行情源暂无数据'}</div></td>
                            <td className="py-3 pr-3 text-right"><button onClick={(e) => { e.stopPropagation(); removeItem(item) }} className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-all" title="移出自选"><Trash2 className="w-3.5 h-3.5"/></button></td>
                          </tr>
                        )
                      })}
                      {!visible.length && <tr><td colSpan={market === 'contract' ? 7 : 6} className="py-12 text-center text-xs text-zinc-400"><Star className="w-5 h-5 mx-auto mb-2 opacity-50"/>{input ? '没有匹配的自选' : '还没有自选标的'}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 右侧独立盯盘侧栏 */}
        <aside className="hidden xl:flex w-[300px] border-l border-zinc-100 bg-zinc-50/50 p-3.5 flex-col justify-between shrink-0 overflow-y-auto">
          <div className="space-y-3.5">
            {/* 标的概览与 24h K 线微图 */}
            <section className="p-3.5 rounded-2xl bg-white border border-zinc-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {active && <SymbolIcon item={active} size={26}/>}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-zinc-900 truncate">
                      {active?.name ? active.name : (active?.symbol ?? '未选择标的')}
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      {active?.kind === 'contract' || active?.symbol.includes('_') ? 'Gate.io 永续合约' : '现货行情'}
                    </div>
                  </div>
                </div>
                {activeQuote && (
                  <div className="text-right">
                    <div className={`text-xs font-mono tabular-nums font-bold ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {money(activeQuote.price, activeQuote.currency)}
                    </div>
                    <div className={`text-[10px] font-mono ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {positive ? '+' : ''}{fmt(activeQuote.changePercent)}%
                    </div>
                  </div>
                )}
              </div>

              {/* 24h 走势微图 */}
              {sidebarPoints && (
                <div className="mt-3 pt-2.5 border-t border-zinc-100">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                    <span>24h 价格走势</span>
                    <span className="font-mono">{positive ? '↗ 上涨' : '↘ 下跌'}</span>
                  </div>
                  <svg className="w-full h-10 overflow-visible" viewBox="0 0 256 40" preserveAspectRatio="none">
                    <polyline points={sidebarPoints} fill="none" stroke={positive ? '#10b981' : '#e11d48'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              )}

              <div className="mt-3 pt-2.5 border-t border-zinc-100 grid grid-cols-2 gap-2 text-[10px]">
                <div><div className="text-zinc-400">标记价格</div><div className="mt-0.5 font-mono font-semibold">{activeQuote?.markPrice ? money(activeQuote.markPrice, 'USDT') : '--'}</div></div>
                <div><div className="text-zinc-400">持仓总量 (OI)</div><div className="mt-0.5 font-mono font-semibold">{formatCompact(activeQuote?.openInterest)}</div></div>
                <div><div className="text-zinc-400">24h 最高</div><div className="mt-0.5 font-mono font-semibold">{activeQuote?.high24h ? money(activeQuote.high24h, activeQuote.currency) : '--'}</div></div>
                <div><div className="text-zinc-400">24h 最低</div><div className="mt-0.5 font-mono font-semibold">{activeQuote?.low24h ? money(activeQuote.low24h, activeQuote.currency) : '--'}</div></div>
              </div>

              {/* 若用户持有该标的，嵌入显示该标的当前持仓简报 */}
              {heldPositionForActive && (
                <div className="mt-3 pt-2.5 border-t border-zinc-100 bg-zinc-50/70 -mx-3.5 -mb-3.5 p-3 rounded-b-2xl text-[11px]">
                  <div className="flex items-center justify-between font-medium text-zinc-700 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${heldPositionForActive.side === 'short' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                      <span>我的仓位 ({heldPositionForActive.side === 'short' ? '做空' : '做多'} {heldPositionForActive.leverage}x)</span>
                    </span>
                    <span className={`font-mono font-bold ${heldPositionForActive.unrealisedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {money(heldPositionForActive.unrealisedPnl, 'USDT', true)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-zinc-500 font-mono">
                    <div>数量: {heldPositionForActive.size} 张</div>
                    <div>成本: {money(heldPositionForActive.entryPrice, 'USDT')}</div>
                    <div>名义价值: {money(heldPositionForActive.value, 'USDT')}</div>
                    <div>回报: {heldPositionForActive.pnlPercent >= 0 ? '+' : ''}{heldPositionForActive.pnlPercent.toFixed(2)}%</div>
                  </div>
                </div>
              )}
            </section>

            {/* 多空账户比 */}
            {(active?.kind === 'contract' || active?.symbol.includes('_')) && activeQuote?.longRatio != null && (
              <section className="p-3 rounded-2xl bg-white border border-zinc-200/80 shadow-xs">
                <div className="flex justify-between text-[10px] font-mono mb-1">
                  <span className="text-emerald-600 font-semibold">多头 {(activeQuote.longRatio * 100).toFixed(1)}%</span>
                  <span className="text-zinc-400">多空持仓比</span>
                  <span className="text-rose-600 font-semibold">空头 {((1 - activeQuote.longRatio) * 100).toFixed(1)}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-rose-500 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${activeQuote.longRatio * 100}%` }}/>
                </div>
              </section>
            )}

            {/* 价格预警 */}
            <section className="p-3.5 rounded-2xl bg-white border border-zinc-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5"/>价格预警
                </span>
                <span className="text-[10px] text-zinc-400">系统提醒</span>
              </div>
              <div className="flex items-center gap-1.5">
                <select value={alertDirection} onChange={(e) => setAlertDirection(e.target.value as 'above' | 'below')} className="bg-zinc-100 rounded-lg px-2 py-1.5 text-xs text-zinc-700 outline-none">
                  <option value="above">高于 ≥</option>
                  <option value="below">低于 ≤</option>
                </select>
                <input value={alertPrice} onChange={(e) => setAlertPrice(e.target.value)} type="number" min="0" placeholder={activeQuote ? fmt(activeQuote.price) : '目标价格'} className="w-full min-w-0 bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-900 outline-none"/>
                <button onClick={addAlert} className="px-2.5 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-medium shrink-0">添加</button>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {alerts.filter((alert) => alert.symbol.startsWith(`${market}:`)).map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between text-[11px] bg-zinc-50 px-2 py-1 rounded-lg">
                    <span className="text-zinc-600">{alert.symbol.split(':')[1]?.replace('USDT', '')} {alert.direction === 'above' ? '≥' : '≤'} <strong className="font-mono text-zinc-900">{fmt(alert.price)}</strong></span>
                    <button onClick={() => removeAlert(alert.id)} className={alert.triggered ? 'text-amber-600' : 'text-emerald-600'}>{alert.triggered ? '已触发' : '监控中'}</button>
                  </div>
                ))}
              </div>
            </section>

            {/* 市场新闻：HTML 实体转义修复 */}
            <section className="p-3.5 rounded-2xl bg-white border border-zinc-200/80 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                  <Newspaper className="w-3.5 h-3.5"/>市场资讯
                </span>
                <button onClick={() => void loadNews()} disabled={newsLoading} className="text-[10px] text-zinc-400 hover:text-zinc-800 disabled:opacity-50">刷新</button>
              </div>
              {newsError && !news.length && <div className="py-2 text-[10px] text-amber-700">{newsError}</div>}
              <div className="space-y-2 max-h-56 overflow-y-auto thin-scrollbar">
                {news.slice(0, 5).map((item) => (
                  <a key={`${item.source}:${item.url}`} href={item.url} target="_blank" rel="noreferrer" className="block border-t border-zinc-100 pt-2 first:border-0 first:pt-0 group">
                    <span className="text-[11px] leading-4 text-zinc-700 group-hover:text-zinc-950 line-clamp-2">
                      {decodeHtmlEntities(item.title)}
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2 text-[9px] text-zinc-400">
                      <span>{item.source}</span>
                      <span className="inline-flex items-center gap-1">
                        {Number.isFinite(Date.parse(item.publishedAt)) ? new Date(item.publishedAt).toLocaleDateString() : ''}
                        <ExternalLink className="w-2.5 h-2.5"/>
                      </span>
                    </span>
                  </a>
                ))}
                {!news.length && !newsError && <div className="py-3 text-center text-[10px] text-zinc-400"><RefreshCw className="w-3 h-3 mx-auto mb-1 animate-spin"/>加载中...</div>}
              </div>
            </section>
          </div>

          <div className="mt-3 text-[10px] text-zinc-400 border-t border-zinc-200/60 pt-2 flex items-center justify-between">
            <span>Gate.io Public & Auth API</span>
            <span>行情仅供参考</span>
          </div>
        </aside>
      </div>
    </div>
  </ToolShell>
}
