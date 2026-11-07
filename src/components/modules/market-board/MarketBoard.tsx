import { usePageVisible } from "../../../hooks/usePageVisible";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Banknote,
  Bell,
  ChevronRight,
  Coins,
  Compass,
  KeyRound,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import ToolShell from "../../ui/ToolShell";
import { useToast } from "../../ui/Toast";
import Select from "../../ui/Select";
import {
  catalogDisplayName,
  searchSymbolCatalog,
  type CatalogEntry,
} from "../../../utils/marketSymbolCatalog";
import {
  HotQuotesDataTable,
  PositionsDataTable,
  SpotBalancesDataTable,
  WatchlistDataTable,
  type WatchRow,
} from "./MarketBoardTables";
import MarketNewsPanel from "./MarketNewsPanel";
import MarketSymbolDetail from "./MarketSymbolDetail";
import {
  hydrateMarketBoardFromLegacyStore,
  useMarketBoardStore,
  type MarketAlert,
  type MarketTab,
  type MarketWatchItem,
  type RefreshIntervalSec,
} from "../../../store/marketBoardStore";

/* 调试：Gate 聚合结果限频打到 DevTools，避免跟轮询一起刷屏 */
const GATE_RENDER_LOG_MS = 60_000;
const gateRenderLogAt: Record<string, number> = {};
function logGateRender(tag: string, payload: unknown) {
  const now = Date.now();
  if (now - (gateRenderLogAt[tag] ?? 0) < GATE_RENDER_LOG_MS) return;
  gateRenderLogAt[tag] = now;
  console.log(`[Gate] ${tag}`, payload);
}

type Market = MarketTab;
type Asset = "crypto" | "equity";
type Quote = {
  symbol: string;
  name: string;
  kind: "contract" | "spot";
  asset: Asset;
  price: number;
  changePercent: number;
  change: number;
  currency: string;
  fundingRate?: number;
  openInterest?: number;
  turnover24h?: number;
  high24h?: number;
  low24h?: number;
  markPrice?: number;
  nextFundingTime?: number;
  fundingIntervalHours?: number;
  longRatio?: number;
  open?: number;
  prevClose?: number;
  volume?: number;
  turnoverRate?: number;
  pe?: number;
  pb?: number;
  amplitude?: number;
  floatMarketCap?: number;
  marketCap?: number;
  updatedAt: number;
};
type WatchItem = MarketWatchItem;

export interface GatePosition {
  contract: string;
  symbol: string;
  mode: string;
  side: "long" | "short";
  size: number;
  value: number;
  entryPrice: number;
  markPrice: number;
  unrealisedPnl: number;
  pnlPercent: number;
  leverage: number;
  liqPrice: number;
  margin: number;
}

export interface GateSpotBalance {
  currency: string;
  available: number;
  locked: number;
}

/* 失败的接口回 null（不是 0），渲染层据此显示 --；只有成功响应里的 0 / 空数组才是真实空仓 */
export interface GateAccountData {
  total: number | null;
  available: number | null;
  unrealisedPnl: number | null;
  /** 合约 total + 现货 USDT；总资产估值 = totalAsset + unrealisedPnl */
  totalAsset: number | null;
  totalAssetSpot: number | null;
  openPositions: GatePosition[] | null;
  spotBalances: GateSpotBalance[] | null;
  balanceError?: string;
  positionError?: string;
  spotError?: string;
  partial?: boolean;
  updatedAt: number;
}

/* 0 = 仅手动刷新；前台用这个间隔，后台有提醒时用 2 倍（至少 60s） */
const REFRESH_INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "每 1 秒" },
  { value: "3", label: "每 3 秒" },
  { value: "5", label: "每 5 秒" },
  { value: "10", label: "每 10 秒" },
  { value: "15", label: "每 15 秒" },
  { value: "30", label: "每 30 秒" },
  { value: "60", label: "每 1 分钟" },
  { value: "0", label: "仅手动" },
];
function clampRefreshInterval(raw: unknown): RefreshIntervalSec {
  const n = typeof raw === "number" ? raw : Number(raw);
  return ([0, 1, 3, 5, 10, 15, 30, 60] as const).includes(
    n as RefreshIntervalSec,
  )
    ? (n as RefreshIntervalSec)
    : 30;
}

const SYMBOL_NAMES: Record<string, string> = {
  MU: "美光科技 (Micron)",
  MSFT: "微软 (Microsoft)",
  SPCX: "SpaceX 合成",
  SNDK: "闪迪 (SanDisk)",
  TSLA: "特斯拉 (Tesla)",
  NVDA: "英伟达 (NVIDIA)",
  AAPL: "苹果 (Apple)",
  AMZN: "亚马逊 (Amazon)",
  GOOG: "谷歌 (Google)",
  GOOGL: "谷歌 (Google)",
  META: "Meta (脸书)",
  BTC: "比特币 (Bitcoin)",
  ETH: "以太坊 (Ethereum)",
  SOL: "Solana",
};

/** Gate 上挂的美股 / 合成合约 ticker（不是加密货币） */
const EQUITY_TICKERS =
  /^(MU|MSFT|SPCX|SNDK|TSLA|NVDA|AAPL|AMZN|GOOG|GOOGL|META|INTU|AMD|NFLX|COIN|BABA|PDD|HOOD|PLTR|UBER|ABNB)$/i;

function isEquitySymbol(symbol: string): boolean {
  const base = symbol.replace(/USDT$/i, "").toUpperCase();
  return EQUITY_TICKERS.test(base) || /^(sh|sz|hk)/i.test(symbol);
}

/** 旧自选可能只有 market 字段，统一成 kind/asset */
function migrateWatchlist(saved: unknown[]): WatchItem[] {
  return saved.flatMap((raw) => {
    const item = raw as WatchItem & { market?: string };
    if (!item || typeof item.symbol !== "string") return [];
    if (item.kind === "contract" || item.kind === "spot") {
      const equity = isEquitySymbol(item.symbol);
      return [
        {
          symbol: item.symbol,
          name: item.name || item.symbol,
          kind: item.kind,
          asset: equity
            ? ("equity" as const)
            : item.asset || ("crypto" as const),
        },
      ];
    }
    if (item.market === "stock")
      return [
        {
          symbol: item.symbol,
          name: item.name || item.symbol,
          kind: "spot" as const,
          asset: "equity" as const,
        },
      ];
    if (item.market === "equity") {
      if (isEquitySymbol(item.symbol))
        return [
          {
            symbol: item.symbol.replace(/USDT$/i, ""),
            name: item.name || item.symbol,
            kind: "spot" as const,
            asset: "equity" as const,
          },
        ];
      return [
        {
          symbol: item.symbol,
          name: item.name || item.symbol,
          kind: "contract" as const,
          asset: "crypto" as const,
        },
      ];
    }
    return [
      {
        symbol: item.symbol,
        name: item.name || item.symbol,
        kind: "contract" as const,
        asset: "crypto" as const,
      },
    ];
  });
}

/** 旧提醒用 price，store 统一为 target */
function normalizeAlerts(saved: unknown[]): MarketAlert[] {
  return saved
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .filter((item) => typeof item.symbol === "string")
    .map((item) => {
      const symbolRaw = String(item.symbol);
      const symbol = symbolRaw.includes(":")
        ? symbolRaw
        : `${/^(sh|sz|hk)/i.test(symbolRaw) ? "spot" : "contract"}:${symbolRaw}`;
      const target =
        typeof item.target === "number"
          ? item.target
          : typeof item.price === "number"
            ? item.price
            : Number.NaN;
      return {
        id: String(item.id ?? `${symbol}-${target}`),
        symbol,
        target,
        direction: item.direction === "below" ? ("below" as const) : ("above" as const),
        triggered: Boolean(item.triggered),
      };
    })
    .filter((item) => Number.isFinite(item.target));
}

const fmt = (n: number, digits = 2) => {
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

function money(n: number, currency = "USDT", showPlus = false): string {
  if (!Number.isFinite(n)) return "--";
  const isNeg = n < 0;
  const abs = Math.abs(n);
  const sign = isNeg ? "-" : showPlus && n > 0 ? "+" : "";
  const digits = abs >= 100 ? 2 : abs >= 1 ? 2 : 4;
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (currency === "USDT" || currency === "USD") return `${sign}$${formatted}`;
  if (currency === "CNY") return `${sign}¥${formatted}`;
  if (currency === "HKD") return `${sign}HK$${formatted}`;
  return `${sign}${formatted} ${currency}`;
}

const baseSymbol = (symbol: string) =>
  symbol.replace(/USDT$/i, "").toUpperCase();
const quoteKey = (item: { kind?: string; symbol: string }) =>
  `${item.kind || "contract"}:${item.symbol.toLowerCase()}`;

function getSparklinePoints(
  series: number[] | undefined,
  quote: Quote | undefined,
  width = 96,
  height = 26,
): string {
  let values: number[] = [];
  if (Array.isArray(series) && series.length >= 2) {
    values = series;
  } else if (quote && Number.isFinite(quote.price) && quote.price > 0) {
    const cur = quote.price;
    const prev = cur / (1 + (quote.changePercent || 0) / 100);
    const high =
      quote.high24h && quote.high24h > 0
        ? Math.max(quote.high24h, cur, prev)
        : Math.max(cur, prev) * 1.01;
    const low =
      quote.low24h && quote.low24h > 0
        ? Math.min(quote.low24h, cur, prev)
        : Math.min(cur, prev) * 0.99;
    const mid1 = prev + (high - prev) * 0.4;
    const mid2 = low + (high - low) * 0.3;
    const mid3 = low + (cur - low) * 0.7;
    values = [
      prev,
      (prev + mid1) / 2,
      mid1,
      high,
      (high + low) / 2,
      low,
      mid2,
      mid3,
      (mid3 + cur) / 2,
      cur,
    ];
  }

  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const paddingY = 2;
  const effHeight = height - paddingY * 2;

  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - paddingY - ((v - min) / range) * effHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Gate 官网图标：https://icon.staticimgs.com/images/coin_icon/64/{小写}.png
 * 加密和美股合成都走同一套；ticker 必须小写（MSFT.png 会 403）。
 */
function gateIconUrl(symbol: string): string {
  const lower = (symbol === "XBT" ? "btc" : symbol).toLowerCase();
  return `https://icon.staticimgs.com/images/coin_icon/64/${lower}.png`;
}

function iconSymbol(raw: string): string {
  const trimmed = raw.trim();
  /* 现货 USDT：baseSymbol 会剥成空串，图标就 404 */
  if (/^USDT$/i.test(trimmed)) return "USDT";
  const base = baseSymbol(trimmed);
  return base || trimmed.toUpperCase();
}

function SymbolIcon({
  item,
  size,
}: {
  item: { symbol: string; name?: string; asset?: Asset; kind?: string };
  size: number;
}) {
  const symbol = iconSymbol(item.symbol);
  const src = gateIconUrl(symbol);
  const [failed, setFailed] = useState(false);
  /* 换标的时清掉失败态，避免沿用上一个币的「已失败」 */
  useEffect(() => {
    setFailed(false);
  }, [symbol]);

  return (
    <span
      className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 overflow-hidden inline-flex items-center justify-center text-[10px] font-semibold text-zinc-600 leading-none"
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      aria-hidden
    >
      {!failed ? (
        <img
          key={src}
          src={src}
          alt=""
          width={size}
          height={size}
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="select-none">{symbol.slice(0, 2)}</span>
      )}
    </span>
  );
}

export default function MarketBoard({
  isActive = true,
}: {
  isActive?: boolean;
}) {
  const { showToast } = useToast();
  const pageVisible = usePageVisible();
  const watching = isActive && pageVisible;

  /* zustand persist：第 0 帧用内存默认/已水合快照，消除白屏与空卡片抖动 */
  const market = useMarketBoardStore((s) => s.marketTab);
  const setMarket = useMarketBoardStore((s) => s.setMarketTab);
  const watchlist = useMarketBoardStore((s) => s.watchlist);
  const setWatchlist = useMarketBoardStore((s) => s.setWatchlist);
  const quotes = useMarketBoardStore((s) => s.quotesCache) as Quote[];
  const setQuotesCache = useMarketBoardStore((s) => s.setQuotesCache);
  const lastUpdated = useMarketBoardStore((s) => s.lastUpdated);
  const setLastUpdated = useMarketBoardStore((s) => s.setLastUpdated);
  const selectedSymbol = useMarketBoardStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketBoardStore((s) => s.setSelectedSymbol);
  const refreshIntervalSec = useMarketBoardStore((s) => s.refreshIntervalSec);
  const setRefreshIntervalSec = useMarketBoardStore(
    (s) => s.setRefreshIntervalSec,
  );
  const alerts = useMarketBoardStore((s) => s.alerts);
  const setAlerts = useMarketBoardStore((s) => s.setAlerts);
  const candlesMap = useMarketBoardStore((s) => s.candlesCache);
  const setCandlesCache = useMarketBoardStore((s) => s.setCandlesCache);
  const accountCache = useMarketBoardStore((s) => s.accountCache);
  const setAccountCache = useMarketBoardStore((s) => s.setAccountCache);
  const hasHydrated = useMarketBoardStore((s) => s._hasHydrated);

  // 未确认本机已配置凭据前不展示历史账户快照，避免把旧缓存误认为当前账户。
  const [accountData, setAccountData] = useState<GateAccountData | null>(null);
  const [input, setInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(0);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const [hotQuotes, setHotQuotes] = useState<Quote[]>([]);
  const [hotFilter, setHotFilter] = useState<"all" | "crypto" | "equity">(
    "all",
  );
  const [hotLoading, setHotLoading] = useState(false);
  const [hotLoadingMore, setHotLoadingMore] = useState(false);
  const [hotHasMore, setHotHasMore] = useState(true);
  const [hotTotal, setHotTotal] = useState(0);
  const [hotError, setHotError] = useState("");
  const hotLoadingMoreRef = useRef(false);
  const hotHasMoreRef = useRef(true);
  const hotLenRef = useRef(0);
  hotHasMoreRef.current = hotHasMore;
  hotLenRef.current = hotQuotes.length;
  /* 初始 loading 设为 true，右上角旋转图标提示用户“正在静默同步最新数据” */
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(() => quotes.length > 0);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [error, setError] = useState("");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">(
    "above",
  );
  const [alertPrice, setAlertPrice] = useState("");
  const [sortBy, setSortBy] = useState<"default" | "change" | "funding">(
    "default",
  );
  const [now, setNow] = useState(Date.now());
  const [credentialStatus, setCredentialStatus] = useState<{
    configured: boolean;
    encryptionAvailable: boolean;
  } | null>(null);
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [credentialKey, setCredentialKey] = useState("");
  const [credentialSecret, setCredentialSecret] = useState("");
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [credentialError, setCredentialError] = useState("");
  const [accountError, setAccountError] = useState("");
  // 账户首次加载中：卡片要显示“加载中”而不是 0，失败后同理显示 --
  const [accountLoading, setAccountLoading] = useState(false);

  /*
   * latest-request-only：行情/账户各自一个单调递增序号，响应回来时对不上号就整包丢弃。
   * 手动刷新、定时器、凭据变更会并发发起请求，慢的旧请求后到不能覆盖新状态。
   * account 还要额外叠加凭据代际：保存/清除凭据时旧 Key 发出的请求一律作废。
   */
  const quotesSeq = useRef(0);
  const accountSeq = useRef(0);
  const accountGen = useRef(0);
  const alive = useRef(true);
  /*
   * 必须在挂载时显式置 true：开发模式的 StrictMode 会「挂载 → 卸载 → 再挂载」一遍，
   * 只写卸载置 false 的话，第二次挂载后它永远是 false，所有 `if (alive.current)`
   * 保护下的 setState 都被吞掉 —— 表现就是凭据状态一直停在「正在检查系统安全存储…」。
   */
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void window.electronAPI
      ?.gateCredentialsStatus?.()
      .then((status) => {
        if (alive.current) setCredentialStatus(status);
      })
      .catch(() => {
        if (alive.current) setCredentialError("无法读取安全存储状态");
      });
  }, []);

  /* persist 水合完成后再吞旧 electron-store 单 key，并迁移旧自选/提醒形状 */
  useEffect(() => {
    if (!hasHydrated) return;
    let active = true;
    void hydrateMarketBoardFromLegacyStore()
      .then(() => {
        if (!active) return;
        const state = useMarketBoardStore.getState();
        const migrated = migrateWatchlist(state.watchlist as unknown[]);
        const same =
          migrated.length === state.watchlist.length &&
          migrated.every(
            (item, i) =>
              item.symbol === state.watchlist[i]?.symbol &&
              item.kind === state.watchlist[i]?.kind &&
              item.asset === state.watchlist[i]?.asset &&
              item.name === state.watchlist[i]?.name,
          );
        if (!same) setWatchlist(migrated);
        const normalized = normalizeAlerts(state.alerts as unknown[]);
        const alertsSame =
          normalized.length === state.alerts.length &&
          normalized.every(
            (item, i) =>
              item.id === state.alerts[i]?.id &&
              item.symbol === state.alerts[i]?.symbol &&
              item.target === state.alerts[i]?.target &&
              item.direction === state.alerts[i]?.direction &&
              item.triggered === state.alerts[i]?.triggered,
          );
        if (!alertsSame) setAlerts(normalized);
      })
      .finally(() => {
        if (active) setWatchlistLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [hasHydrated, setWatchlist, setAlerts]);

  // 1 秒一跳只服务于资金费率倒计时：看不见时不跳，否则整块看板每秒白白重渲染
  useEffect(() => {
    if (!watching) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [watching]);
  const persist = useCallback(
    (next: WatchItem[]) => {
      setWatchlist(next);
    },
    [setWatchlist],
  );

  /* 看板内全屏详情；不持久化，切 Tab 时关掉避免叠在资讯/持仓上 */
  const [detailOpen, setDetailOpen] = useState(false);

  const handleMarketChange = (key: Market) => {
    setMarket(key);
    setInput("");
    setSearchOpen(false);
    setDetailOpen(false);
  };

  const searchSuggestions = useMemo(
    () =>
      searchSymbolCatalog(input, {
        limit: 8,
        asset: market === "spot" ? "all" : "all",
      }),
    [input],
  );

  const handleSelectSymbol = (symbol: string) => {
    setSelectedSymbol(symbol);
  };

  const handleOpenDetail = (symbol?: string) => {
    if (symbol) setSelectedSymbol(symbol);
    setDetailOpen(true);
  };

  /* 切到资讯 / 自选被删光时关掉详情，避免主区空白 */
  useEffect(() => {
    if (market === "news") setDetailOpen(false);
  }, [market]);

  const refreshAccount = useCallback(async () => {
    const api = window.electronAPI?.marketAccount;
    if (!api || credentialStatus?.configured !== true) return;
    const gen = accountGen.current;
    const seq = ++accountSeq.current;
    const isCurrent = () =>
      alive.current && gen === accountGen.current && seq === accountSeq.current;
    if (!accountData) setAccountLoading(true);
    try {
      const data = await api();
      if (!isCurrent() || !data) return;
      logGateRender("marketAccount", data);
      setAccountData(data);
      // 部分失败只提示失败面（余额/持仓/现货各自有分区标题），不误报成整份账户不可用
      setAccountError(
        data.partial ? "部分账户数据加载失败，缺失的数值以 -- 显示" : "",
      );
      // 只把真正可用的整份快照写入 store；部分失败带 null，不足以离线还原
      if (data.partial) setAccountCache(null);
      else setAccountCache(data);
    } catch (cause) {
      if (!isCurrent()) return;
      // 失败时保留上一次成功的快照（若在），错误条会明确说明，不与零资产混淆
      setAccountError(
        cause instanceof Error
          ? cause.message.replace(
              /^Error invoking remote method '[^']+': (Error: )?/,
              "",
            )
          : "账户数据暂时不可用",
      );
    } finally {
      if (isCurrent()) setAccountLoading(false);
    }
  }, [credentialStatus?.configured, accountData, setAccountCache]);

  /* 凭据变更：先作废在飞请求与新代际，再清空展示，避免旧账户残留在界面上 */
  const invalidateAccount = useCallback(() => {
    accountGen.current++;
    accountSeq.current++;
    setAccountLoading(false);
    setAccountData(null);
    setAccountError("");
    setAccountCache(null);
  }, [setAccountCache]);

  /* 凭据确认已配置后，用 store 离线快照顶一下，避免等网络时整块空白 */
  useEffect(() => {
    if (credentialStatus?.configured !== true) return;
    if (accountData) return;
    if (!accountCache || typeof accountCache !== "object") return;
    setAccountData(accountCache as GateAccountData);
  }, [credentialStatus?.configured, accountCache, accountData]);

  const saveCredentials = async () => {
    const api = window.electronAPI?.gateCredentialsSave;
    if (!api || credentialSaving) return;
    setCredentialSaving(true);
    setCredentialError("");
    try {
      const status = await api({
        key: credentialKey,
        secret: credentialSecret,
      });
      if (!alive.current) return;
      setCredentialStatus(status);
      setCredentialKey("");
      setCredentialSecret("");
      setShowCredentialForm(false);
      invalidateAccount();
      showToast("Gate.io 只读凭据已加密保存");
    } catch (cause) {
      setCredentialError(
        cause instanceof Error
          ? cause.message.replace(
              /^Error invoking remote method '[^']+': (Error: )?/,
              "",
            )
          : "凭据保存失败",
      );
    } finally {
      setCredentialSaving(false);
    }
  };

  const clearCredentials = async () => {
    const api = window.electronAPI?.gateCredentialsClear;
    if (!api) return;
    try {
      const status = await api();
      if (!alive.current) return;
      setCredentialStatus(status);
      invalidateAccount();
      setShowCredentialForm(false);
      showToast("Gate.io 凭据已移除");
    } catch {
      setCredentialError("凭据移除失败，请重试");
    }
  };

  /* 打开持仓页且已配置凭据、却还没有账户数据时拉一次，避免只靠行情刷新带出账户 */
  useEffect(() => {
    if (
      market === "position" &&
      credentialStatus?.configured === true &&
      !accountData &&
      !accountLoading &&
      !accountError
    ) {
      void refreshAccount();
    }
  }, [
    market,
    credentialStatus?.configured,
    accountData,
    accountLoading,
    accountError,
    refreshAccount,
  ]);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.marketQuotes;
    if (!api) {
      setError("请在桌面版中查看实时行情");
      setHasLoaded(true);
      setLoading(false);
      return;
    }
    const seq = ++quotesSeq.current;
    const isCurrent = () => alive.current && seq === quotesSeq.current;
    setLoading(true);
    setError("");
    try {
      const positionContracts = (accountData?.openPositions ?? []).map((p) =>
        p.contract.replace("_", ""),
      );
      const contracts = [
        ...new Set([
          ...watchlist
            .filter((x) => x.kind === "contract")
            .map((x) => x.symbol),
          ...positionContracts,
        ]),
      ];
      const [quotesResult] = await Promise.allSettled([
        api({
          spot: watchlist.filter((x) => x.kind === "spot").map((x) => x.symbol),
          contracts,
        }),
        refreshAccount(),
      ]);
      // 已有更新的刷新发出去了：这次结果直接丢弃，连缓存也不写
      if (!isCurrent()) return;
      if (quotesResult.status === "fulfilled") {
        const next = quotesResult.value;
        logGateRender("marketQuotes", next);
        if (next.length || !watchlist.length) {
          /*
           * 按 quoteKey 就地补丁：行顺序跟自选一致，只换数值。
           * 整表 setQuotes(next) 会换掉对象引用，虚拟行虽同 id 仍会大面积 reconciliation。
           */
          const prev = useMarketBoardStore.getState().quotesCache as Quote[];
          const map = new Map(
            next.map((item) => [quoteKey(item), item] as const),
          );
          const patched = prev.map((old) => {
            const fresh = map.get(quoteKey(old));
            if (!fresh) return old;
            map.delete(quoteKey(old));
            return fresh;
          });
          for (const leftover of map.values()) patched.push(leftover);
          const keep = new Set(
            watchlist.map((w) => quoteKey(w)).concat(
              (accountData?.openPositions ?? []).map(
                (p) =>
                  `contract:${p.contract.replace("_", "").toLowerCase()}`,
              ),
            ),
          );
          const cleaned = patched.filter((q) => keep.has(quoteKey(q)));
          setQuotesCache(cleaned);
        }
        if (next.length) {
          const updated = Math.max(...next.map((item) => item.updatedAt));
          setLastUpdated(updated);
        }
      }
      setHasLoaded(true);
      if (
        quotesResult.status === "fulfilled" &&
        quotesResult.value.length < watchlist.length
      ) {
        setError("部分自选暂无行情，请检查代码是否受数据源支持或稍后重试");
      }
    } catch (cause) {
      if (!isCurrent()) return;
      setError(cause instanceof Error ? cause.message : "行情获取失败");
      setHasLoaded(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [
    watchlist,
    accountData?.openPositions,
    refreshAccount,
    setQuotesCache,
    setLastUpdated,
  ]);

  useEffect(() => {
    if (!watchlistLoaded) return;
    /*
     * 看不见时只在「设了价格提醒」才继续拉：提醒是在这里对着最新报价判定的，
     * 停掉轮询提醒就哑了。没有提醒就彻底休眠，切回来时 effect 重跑会立刻补拉一次。
     */
    if (!watching && alerts.length === 0) return;
    void refresh();
    /* 仅手动：前台不轮询；后台有提醒时仍用 60s 兜底，避免提醒哑火 */
    if (refreshIntervalSec === 0) {
      if (watching || alerts.length === 0) return;
      const timer = window.setInterval(() => void refresh(), 60_000);
      return () => window.clearInterval(timer);
    }
    const ms = watching
      ? refreshIntervalSec * 1000
      : Math.max(refreshIntervalSec * 2, 60) * 1000;
    const timer = window.setInterval(() => void refresh(), ms);
    return () => window.clearInterval(timer);
  }, [
    watchlistLoaded,
    refresh,
    market,
    watching,
    alerts.length,
    refreshIntervalSec,
  ]);

  const quoteMap = useMemo(
    () => new Map(quotes.map((q) => [quoteKey(q), q])),
    [quotes],
  );
  /* 搜索框专用于「按中文名/代码加自选」，不再拿来过滤自选表（否则搜微软会把列表清空） */
  const marketItems = watchlist.filter((item) =>
    item.kind === "contract" || item.kind === "spot"
      ? item.kind === market
      : false,
  );
  const visible = market === "contract" || market === "spot" ? marketItems : [];

  const activePosition =
    accountData?.openPositions?.find(
      (p) =>
        p.contract.toUpperCase() === selectedSymbol.toUpperCase() ||
        p.symbol.toUpperCase() === selectedSymbol.toUpperCase() ||
        p.contract.replace("_", "").toUpperCase() ===
          selectedSymbol.replace("_", "").toUpperCase(),
    ) ?? accountData?.openPositions?.[0];

  const active: WatchItem | undefined =
    market === "position"
      ? activePosition
        ? {
            symbol: activePosition.contract,
            name: SYMBOL_NAMES[activePosition.symbol] ?? activePosition.symbol,
            kind: "contract",
            asset: isEquitySymbol(activePosition.symbol) ? "equity" : "crypto",
          }
        : marketItems[0]
      : marketItems.find((item) => item.symbol === selectedSymbol) ??
        marketItems[0];

  const activeQuote = active
    ? quoteMap.get(quoteKey(active)) ??
      quoteMap.get(`contract:${active.symbol.replace("_", "").toLowerCase()}`)
    : undefined;
  const highlights = marketItems
    .filter((item) => quoteMap.has(quoteKey(item)))
    .slice(0, 3);
  const positive = (activeQuote?.changePercent ?? 0) >= 0;

  /* 账户指标的派生态：null 一律表示“没拿到”，与真实的 0 严格区分 */
  const pnlValue = accountData?.unrealisedPnl ?? null;
  const pnlPercent =
    pnlValue != null && accountData?.total != null
      ? `${((pnlValue / (accountData.total - pnlValue || 1)) * 100).toFixed(
          2,
        )}%`
      : "--";
  /* 总资产估值 = totalAsset + unrealisedPnl，两边缺一不可 */
  const totalAssetValue =
    accountData?.totalAsset != null && pnlValue != null
      ? accountData.totalAsset + pnlValue
      : null;

  const heldPositionForActive = useMemo(() => {
    if (!active || !accountData?.openPositions) return undefined;
    return accountData.openPositions.find(
      (p) =>
        p.contract.toUpperCase() === active.symbol.toUpperCase() ||
        p.symbol.toUpperCase() === baseSymbol(active.symbol) ||
        p.contract.replace("_", "").toUpperCase() ===
          active.symbol.replace("_", "").toUpperCase(),
    );
  }, [active, accountData]);

  const activeCandleKey = active
    ? `${active.kind}:${active.symbol.toUpperCase()}`
    : "";
  const activeSeries = active ? candlesMap[activeCandleKey] ?? [] : [];
  const sidebarPoints = useMemo(() => {
    if (activeSeries.length < 2) return "";
    const min = Math.min(...activeSeries);
    const max = Math.max(...activeSeries);
    const range = max - min || 1;
    return activeSeries
      .map(
        (v, i) =>
          `${(i / (activeSeries.length - 1)) * 256},${
            38 - ((v - min) / range) * 34
          }`,
      )
      .join(" ");
  }, [activeSeries]);

  /* 当前请求序号：lastUpdated 每 30s 变一次会重跑本 effect，旧响应不能再写回同一个 key */
  const activeCandleSeq = useRef(0);
  useEffect(() => {
    if (!active) return;
    const candleKey = `${active.kind}:${active.symbol.toUpperCase()}`;
    const seq = ++activeCandleSeq.current;
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.electronAPI?.marketCandles?.({
          symbol: active.symbol,
          kind: active.kind,
        });
        if (
          !cancelled &&
          seq === activeCandleSeq.current &&
          Array.isArray(result) &&
          result.length > 0
        ) {
          const prev = useMarketBoardStore.getState().candlesCache;
          setCandlesCache({ ...prev, [candleKey]: result });
        }
      } catch {
        /* 失败时保留历史缓存走势，不强行清空 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.symbol, active?.kind, lastUpdated, setCandlesCache]);

  /* 预加载自选列表标的的 24h 真实 K 线数据，支持表格与顶部卡片直接绘制 SVG Sparkline 走势图 */
  useEffect(() => {
    if (!watchlistLoaded || market === "position" || market === "explore")
      return;
    const targets = marketItems.slice(0, 15);
    let cancelled = false;

    const fetchAllCandles = async () => {
      for (const item of targets) {
        if (cancelled) break;
        const candleKey = `${item.kind}:${item.symbol.toUpperCase()}`;
        if (candlesMap[candleKey] && candlesMap[candleKey].length > 0) continue;
        try {
          const res = await window.electronAPI?.marketCandles?.({
            symbol: item.symbol,
            kind: item.kind,
          });
          if (!cancelled && Array.isArray(res) && res.length > 0) {
            const prev = useMarketBoardStore.getState().candlesCache;
            setCandlesCache({ ...prev, [candleKey]: res });
          }
        } catch {}
      }
    };

    void fetchAllCandles();
    return () => {
      cancelled = true;
    };
  }, [watchlistLoaded, market, marketItems, lastUpdated, setCandlesCache]);

  const sortedVisible = useMemo(
    () =>
      sortBy === "default"
        ? visible
        : visible.slice().sort((a, b) => {
            const qa = quoteMap.get(quoteKey(a)),
              qb = quoteMap.get(quoteKey(b));
            return sortBy === "change"
              ? (qb?.changePercent ?? -Infinity) -
                  (qa?.changePercent ?? -Infinity)
              : (qb?.fundingRate ?? -Infinity) - (qa?.fundingRate ?? -Infinity);
          }),
    [sortBy, visible, quoteMap],
  );

  /* 自选表行先算好 sparkline，虚拟列表只挂视口内的行 */
  const watchRows = useMemo<WatchRow[]>(
    () =>
      sortedVisible.map((item) => {
        const quote = quoteMap.get(quoteKey(item));
        const candleKey = `${item.kind}:${item.symbol.toUpperCase()}`;
        return {
          item,
          quote,
          points: getSparklinePoints(candlesMap[candleKey], quote, 96, 26),
          selected: selectedSymbol === item.symbol,
        };
      }),
    [sortedVisible, quoteMap, candlesMap, selectedSymbol],
  );

  useEffect(() => {
    const next = alerts.map((alert) => {
      if (alert.triggered) return alert;
      const [kind, symbol] = alert.symbol.split(":");
      const found = quoteMap.get(`${kind}:${symbol?.toLowerCase() ?? ""}`);
      const price = found?.kind === kind ? found.price : undefined;
      const hit =
        price != null &&
        (alert.direction === "above"
          ? price >= alert.target
          : price <= alert.target);
      if (
        hit &&
        "Notification" in window &&
        Notification.permission === "granted"
      )
        new Notification(`${symbol} 价格预警`, {
          body: `最新价 ${fmt(price!)}，已${
            alert.direction === "above" ? "达到" : "低于"
          } ${fmt(alert.target)}`,
        });
      return hit ? { ...alert, triggered: true } : alert;
    });
    if (
      next.some((item, index) => item.triggered !== alerts[index]?.triggered)
    ) {
      setAlerts(next);
    }
    /* 只跟行情走：alerts 变了不重跑，避免 setAlerts 自触发死循环 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes]);

  const addAlert = () => {
    const price = Number(alertPrice);
    if (!active || !Number.isFinite(price) || price <= 0) {
      showToast("请输入有效预警价格", "error");
      return;
    }
    const next: MarketAlert[] = [
      ...alerts,
      {
        id: `${Date.now()}`,
        symbol: `${active.kind}:${active.symbol}`,
        direction: alertDirection,
        target: price,
        triggered: false,
      },
    ];
    setAlerts(next);
    if ("Notification" in window && Notification.permission === "default")
      void Notification.requestPermission();
    setAlertPrice("");
  };
  const removeAlert = (id: string) => {
    setAlerts(alerts.filter((alert) => alert.id !== id));
  };
  const formatCompact = (value?: number, currency = "USDT") =>
    value == null || !Number.isFinite(value)
      ? "--"
      : `${currency === "USDT" || currency === "USD" ? "$" : ""}${
          value >= 1e9
            ? `${(value / 1e9).toFixed(1)}B`
            : value >= 1e6
            ? `${(value / 1e6).toFixed(1)}M`
            : fmt(value, 0)
        }${currency === "CNY" ? " ¥" : currency === "HKD" ? " HKD" : ""}`;
  const countdown = (timestamp?: number) => {
    if (!timestamp) return "--";
    const seconds = Math.max(0, Math.floor((timestamp - now) / 1000));
    return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(
      Math.floor((seconds % 3600) / 60),
    ).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };

  const resolveSearchToBase = (value: string): CatalogEntry | null => {
    const raw = value.trim();
    if (!raw) return null;
    const hits = searchSymbolCatalog(raw, { limit: 1 });
    if (hits[0] && hits[0].score >= 60) return hits[0];
    return null;
  };

  const addItem = (
    value = input,
    preset?: { base?: string; name?: string; asset?: Asset },
  ) => {
    const raw = (preset?.base || value).trim();
    if (!raw) return;
    const matched = preset?.base ? null : resolveSearchToBase(raw);
    const isCnStock = /^(sh|sz|hk)?\d{4,6}$/i.test(raw);
    const base = baseSymbol(
      (matched?.base || preset?.base || raw).replace(/[-/]/g, ""),
    );
    const asset: Asset =
      preset?.asset ||
      matched?.asset ||
      (isCnStock || isEquitySymbol(base) ? "equity" : "crypto");
    /* 行情发现页 / 永续页默认加合约；现货页加现货 */
    const itemKind: "contract" | "spot" =
      market === "spot" ? "spot" : "contract";
    if (
      !/^[A-Z0-9]{1,24}$/.test(base) ||
      (itemKind === "contract" && isCnStock)
    ) {
      showToast(
        "没找到这个标的。试试搜中文名，例如「微软」「比特币」",
        "error",
      );
      setSearchOpen(true);
      return;
    }
    const symbol =
      itemKind === "spot"
        ? isCnStock
          ? raw.toLowerCase()
          : asset === "equity"
          ? base
          : `${base}USDT`
        : `${base}USDT`;
    const normalized =
      itemKind === "spot" && /^(\d{5})$/.test(symbol)
        ? `hk${symbol}`
        : itemKind === "spot" && /^\d{6}$/.test(symbol)
        ? `${symbol.startsWith("6") ? "sh" : "sz"}${symbol}`
        : symbol;
    if (
      watchlist.some(
        (x) =>
          x.kind === itemKind &&
          x.symbol.toLowerCase() === normalized.toLowerCase(),
      )
    ) {
      showToast("已经在自选列表中", "default");
      setInput("");
      setSearchOpen(false);
      return;
    }
    if (
      itemKind === "spot" &&
      /^[a-z]{2}\d+$/i.test(normalized) &&
      !/^(sh|sz|hk)\d{4,6}$/i.test(normalized)
    ) {
      showToast("股票代码格式不正确", "error");
      return;
    }
    const displayName =
      preset?.name ||
      matched?.name ||
      catalogDisplayName(base) ||
      SYMBOL_NAMES[base] ||
      normalized;
    persist([
      ...watchlist,
      { symbol: normalized, name: displayName, kind: itemKind, asset },
    ]);
    setSelectedSymbol(normalized);
    setInput("");
    setSearchOpen(false);
    if (market === "explore") {
      handleMarketChange("contract");
      showToast(`已加入自选：${displayName} (${base})`);
    } else {
      showToast(`已加入自选：${displayName}`);
    }
  };

  const HOT_PAGE = 40;

  /**
   * 热门行情首屏 / 定时刷新：拉「已加载窗口」同等长度的最新榜，整窗替换。
   * DataTable 用 symbol 做 getRowId + memo 行，同 id 只换单元格数据，不卸挂 DOM。
   */
  const loadHotQuotes = useCallback(
    async (opts?: { force?: boolean; silent?: boolean }) => {
      const api = window.electronAPI?.marketHot;
      if (!api) {
        setHotError("请在桌面版查看行情发现");
        return;
      }
      if (!opts?.silent) setHotLoading(true);
      setHotError("");
      try {
        const windowSize = Math.max(HOT_PAGE, hotLenRef.current || HOT_PAGE);
        const page = await api({
          offset: 0,
          limit: windowSize,
          assetFilter: hotFilter,
          force: opts?.force,
        });
        const rows = (page.items ?? []) as Quote[];
        logGateRender("marketHot", { assetFilter: hotFilter, page });
        setHotTotal(page.total ?? rows.length);
        setHotHasMore(Boolean(page.hasMore));
        setHotQuotes((prev) => {
          /* 强制刷新 / 首屏：按成交额榜顺序整窗换上 */
          if (opts?.force || !prev.length) return rows;
          /*
           * 定时软刷新：按 symbol 就地换引用，行顺序不动，虚拟行 key 不变 → DOM 不卸挂。
           * 已滚出榜的丢掉；榜上新增的接到末尾。
           */
          const map = new Map(rows.map((q) => [q.symbol, q]));
          const next: Quote[] = [];
          const seen = new Set<string>();
          for (const old of prev) {
            const fresh = map.get(old.symbol);
            if (!fresh) continue;
            next.push(fresh);
            seen.add(old.symbol);
          }
          for (const row of rows) {
            if (seen.has(row.symbol)) continue;
            next.push(row);
          }
          return next;
        });
      } catch (cause) {
        setHotError(
          cause instanceof Error ? cause.message : "热门行情加载失败",
        );
      } finally {
        setHotLoading(false);
      }
    },
    [hotFilter],
  );

  const loadMoreHotQuotes = useCallback(async () => {
    const api = window.electronAPI?.marketHot;
    if (!api || hotLoadingMoreRef.current || !hotHasMoreRef.current) return;
    hotLoadingMoreRef.current = true;
    setHotLoadingMore(true);
    try {
      const offset = hotLenRef.current;
      const page = await api({
        offset,
        limit: HOT_PAGE,
        assetFilter: hotFilter,
      });
      const rows = (page.items ?? []) as Quote[];
      setHotTotal(page.total ?? offset + rows.length);
      setHotQuotes((prev) => {
        const seen = new Set(prev.map((q) => q.symbol));
        const merged = [...prev];
        for (const row of rows) {
          if (seen.has(row.symbol)) continue;
          seen.add(row.symbol);
          merged.push(row);
        }
        return merged;
      });
      setHotHasMore(Boolean(page.hasMore));
    } catch (cause) {
      setHotError(
        cause instanceof Error ? cause.message : "加载更多行情失败",
      );
    } finally {
      hotLoadingMoreRef.current = false;
      setHotLoadingMore(false);
    }
  }, [hotFilter]);

  useEffect(() => {
    /* 筛选项变了：清空窗口，重新从 0 拉，避免旧列表和筛选错位 */
    setHotQuotes([]);
    setHotHasMore(true);
    setHotTotal(0);
    hotLenRef.current = 0;
  }, [hotFilter]);

  useEffect(() => {
    if (market !== "explore" || !watching) return;
    void loadHotQuotes({ silent: hotLenRef.current > 0 });
    if (refreshIntervalSec === 0) return;
    const timer = window.setInterval(
      () => void loadHotQuotes({ silent: true }),
      refreshIntervalSec * 1000,
    );
    return () => window.clearInterval(timer);
  }, [market, watching, loadHotQuotes, refreshIntervalSec]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!searchBoxRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  const removeItem = (item: WatchItem) =>
    persist(
      watchlist.filter(
        (x) => !(x.kind === item.kind && x.symbol === item.symbol),
      ),
    );

  return (
    <ToolShell
      title="合约与现货"
      icon={Activity}
      scroll={false}
      showHeader={false}
    >
      <div className="absolute inset-0 flex flex-col bg-white text-zinc-900 select-none">
        {/* 顶栏控制条：精简且做严格防遮挡/防挤压适配 */}
        <div className="h-12 px-4 border-b border-zinc-100 flex items-center justify-between gap-3 shrink-0 bg-white">
          {/* 左侧：标签组与源状态 */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="bg-zinc-100/90 p-0.5 rounded-xl flex items-center text-xs font-medium shrink-0">
              {(
                [
                  ["explore", "行情发现"],
                  ["contract", "永续自选"],
                  ["spot", "现货自选"],
                  ["position", "持仓与资产"],
                  ["news", "资讯"],
                ] as const
              ).map(([key, label]) => {
                const count =
                  key === "position"
                    ? accountData?.openPositions?.length ?? 0
                    : key === "explore" || key === "news"
                    ? 0
                    : watchlist.filter((item) => item.kind === key).length;
                const activeTab = market === key;
                const showCount = key !== "explore" && key !== "news";
                return (
                  <button
                    key={key}
                    onClick={() => handleMarketChange(key)}
                    className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 text-xs ${
                      activeTab
                        ? "bg-zinc-900 text-white shadow-xs"
                        : "text-zinc-500 hover:text-zinc-900"
                    }`}
                  >
                    {key === "position" && <Wallet className="w-3.5 h-3.5" />}
                    {key === "explore" && <Compass className="w-3.5 h-3.5" />}
                    {key === "news" && <Newspaper className="w-3.5 h-3.5" />}
                    <span>{label}</span>
                    {showCount && (
                      <span
                        className={`min-w-[1.25rem] text-center text-[10px] px-1.5 py-0.5 rounded-full font-mono tabular-nums leading-none ${
                          activeTab
                            ? "bg-white/20 text-white"
                            : "bg-zinc-200 text-zinc-600"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-zinc-400 pl-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  error || hotError
                    ? "bg-rose-500"
                    : loading || hotLoading
                    ? "bg-amber-500 animate-pulse"
                    : "bg-emerald-500"
                }`}
              />
              <span className="truncate max-w-[220px]">
                {market === "position"
                  ? "Gate.io 官方只读同步"
                  : market === "explore"
                  ? "Gate 永续成交额排行"
                  : market === "news"
                  ? "Gate Moments 快讯"
                  : market === "contract"
                  ? "USDT 永续合约自选"
                  : "全球现货自选"}
              </span>
            </div>
          </div>

          {/* 右侧：搜索与刷新。切 tab 时用同宽占位，避免工具栏左右抽动 */}
          <div className="flex items-center gap-2 shrink-0 h-8">
            <div className="relative w-auto h-8" ref={searchBoxRef}>
              {market !== "position" && market !== "news" ? (
                <>
                  <div className="h-8 flex items-center bg-zinc-100/80 focus-within:bg-white border border-transparent focus-within:border-zinc-300 rounded-xl pl-2.5 pr-1">
                    <Search className="w-3.5 h-3.5 text-zinc-400 mr-1.5 shrink-0" />
                    <input
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setSearchOpen(true);
                        setSearchHighlight(0);
                      }}
                      onFocus={() => setSearchOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setSearchOpen(true);
                          setSearchHighlight((i) =>
                            Math.min(
                              i + 1,
                              Math.max(0, searchSuggestions.length - 1),
                            ),
                          );
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setSearchHighlight((i) => Math.max(0, i - 1));
                        } else if (e.key === "Enter") {
                          e.preventDefault();
                          const hit = searchSuggestions[searchHighlight];
                          if (hit && searchOpen) {
                            addItem(hit.base, {
                              base: hit.base,
                              name: hit.name,
                              asset: hit.asset,
                            });
                          } else {
                            addItem();
                          }
                        } else if (e.key === "Escape") {
                          setSearchOpen(false);
                        }
                      }}
                      placeholder="搜中文或代码…"
                      className="bg-transparent outline-none text-xs w-full text-zinc-800 placeholder:text-zinc-400"
                    />
                    <button
                      onClick={() => {
                        const hit = searchSuggestions[searchHighlight];
                        if (hit && searchOpen && input.trim()) {
                          addItem(hit.base, {
                            base: hit.base,
                            name: hit.name,
                            asset: hit.asset,
                          });
                        } else {
                          addItem();
                        }
                      }}
                      className="px-2 py-0.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-[10px] font-medium shrink-0"
                    >
                      +自选
                    </button>
                  </div>
                  {searchOpen && (
                    <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 rounded-xl border border-zinc-200 bg-white shadow-lg overflow-hidden">
                      <div className="px-3 py-2 border-b border-zinc-100 bg-zinc-50/80">
                        <p className="text-[10px] text-zinc-500 leading-relaxed">
                          热门搜索：
                        </p>
                      </div>
                      <ul className="max-h-64 overflow-y-auto thin-scrollbar py-1">
                        {searchSuggestions.map((item, index) => {
                          const active = index === searchHighlight;
                          return (
                            <li key={`${item.asset}:${item.base}`}>
                              <button
                                type="button"
                                onMouseEnter={() => setSearchHighlight(index)}
                                onClick={() =>
                                  addItem(item.base, {
                                    base: item.base,
                                    name: item.name,
                                    asset: item.asset,
                                  })
                                }
                                className={`w-full px-3 py-2 flex items-center gap-2.5 text-left ${
                                  active ? "bg-zinc-100" : "hover:bg-zinc-50"
                                }`}
                              >
                                <SymbolIcon
                                  item={{
                                    symbol: item.base,
                                    asset: item.asset,
                                  }}
                                  size={22}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold text-zinc-900 truncate">
                                      {item.name}
                                    </span>
                                    <span className="text-[10px] font-mono text-zinc-500">
                                      {item.base}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-zinc-400">
                                    {item.asset === "equity"
                                      ? "美股 / 合成合约"
                                      : "加密货币"}
                                    {item.aliases?.length
                                      ? ` · 也可搜 ${item.aliases[0]}`
                                      : ""}
                                  </div>
                                </div>
                                <Plus className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                              </button>
                            </li>
                          );
                        })}
                        {!searchSuggestions.length && (
                          <li className="px-3 py-4 text-center text-[11px] text-zinc-400">
                            没有匹配项。可试「微软」「比特币」「NVDA」
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => {
                    setShowCredentialForm((value) => !value);
                    setCredentialError("");
                  }}
                  className="h-8 w-full px-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 flex items-center justify-center gap-1.5 text-[11px] text-zinc-500"
                  title="配置 Gate.io 只读 API 凭据"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {credentialStatus?.configured ? "凭据" : "配置账户"}
                </button>
              )}
            </div>
            <Select
              size="sm"
              value={String(refreshIntervalSec)}
              options={REFRESH_INTERVAL_OPTIONS}
              title="自动刷新频率"
              className="w-[5.25rem] shrink-0"
              onChange={(value) => {
                setRefreshIntervalSec(clampRefreshInterval(value));
              }}
            />
            {market !== "news" && (
              <button
                onClick={() =>
                  void (market === "explore"
                    ? loadHotQuotes({ force: true })
                    : refresh())
                }
                disabled={market === "explore" ? hotLoading : loading}
                title={
                  market === "explore"
                    ? hotLoading
                      ? "正在同步行情…"
                      : "刷新行情发现"
                    : loading
                    ? "正在同步数据…"
                    : "立即刷新"
                }
                className="h-8 min-w-[6.5rem] px-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 flex items-center justify-center gap-1.5 text-[11px] text-zinc-500"
              >
                <span className="font-mono tabular-nums w-auto text-right">
                  {lastUpdated
                    ? new Date(lastUpdated).toLocaleTimeString()
                    : "--:--:--"}
                </span>
                <RefreshCw
                  className={`w-3.5 h-3.5 shrink-0 text-zinc-600 ${
                    (market === "explore" ? hotLoading : loading)
                      ? "animate-spin text-amber-600"
                      : ""
                  }`}
                />
              </button>
            )}
          </div>
        </div>

        {/* 错误条占固定高度，避免「有/无错误」时整页上下跳 */}
        <div
          className={`shrink-0 overflow-hidden transition-[height] duration-150 ${
            error ? "h-8" : "h-0"
          }`}
        >
          <div className="h-8 px-5 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
            <span className="truncate">
              {error}
              {quotes.length > 0 && "，当前保留上次成功获取的数据"}
            </span>
            <button
              onClick={() => void refresh()}
              className="font-medium hover:text-amber-950 shrink-0 ml-2"
            >
              重试
            </button>
          </div>
        </div>

        {/* 主体布局：左侧滚动主内容 + 右侧折叠/独立盯盘侧栏 */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div
            className={`flex-1 min-w-0 min-h-0 flex flex-col p-4 lg:p-5 gap-4 ${
              market === "news" || (detailOpen && active)
                ? "overflow-hidden"
                : "overflow-y-auto thin-scrollbar"
            }`}
          >
            {/* 资讯面板保活：切走 Tab 不卸挂，本地缓存与滚动位置还在 */}
            <div
              className={
                market === "news"
                  ? "flex-1 min-h-0 flex flex-col"
                  : "hidden"
              }
              aria-hidden={market !== "news"}
            >
              <MarketNewsPanel active={watching && market === "news"} />
            </div>
            {market !== "news" && detailOpen && active ? (
              <MarketSymbolDetail
                item={active}
                quote={activeQuote}
                onBack={() => setDetailOpen(false)}
              />
            ) : null}
            {market !== "news" &&
              !(detailOpen && active) &&
            (market === "position" &&
              (credentialStatus?.configured !== true || showCredentialForm) ? (
              <section className="max-w-xl mx-auto w-full mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-zinc-100">
                    <KeyRound className="w-5 h-5 text-zinc-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-900">
                      连接 Gate.io 只读账户
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      请仅使用关闭交易与提现权限的 API
                      Key。凭据经系统安全存储加密后保存在本机，不会上传或打包进应用。
                    </p>
                  </div>
                </div>
                {credentialStatus === null ? (
                  <div className="py-8 text-center text-xs text-zinc-400">
                    {credentialError || "正在检查系统安全存储…"}
                  </div>
                ) : !credentialStatus.encryptionAvailable ? (
                  <div className="mt-5 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800">
                    当前系统安全存储不可用，请解锁系统钥匙串后重试。
                  </div>
                ) : (
                  <form
                    className="mt-5 space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveCredentials();
                    }}
                  >
                    <label className="block">
                      <span className="text-[11px] font-medium text-zinc-600">
                        API Key
                      </span>
                      <input
                        value={credentialKey}
                        onChange={(event) =>
                          setCredentialKey(event.target.value)
                        }
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        className="mt-1.5 w-full h-10 px-3 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-mono outline-none focus:border-zinc-400 focus:bg-white"
                        placeholder="输入只读 API Key"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-medium text-zinc-600">
                        API Secret
                      </span>
                      <input
                        value={credentialSecret}
                        onChange={(event) =>
                          setCredentialSecret(event.target.value)
                        }
                        type="password"
                        autoComplete="new-password"
                        spellCheck={false}
                        className="mt-1.5 w-full h-10 px-3 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-mono outline-none focus:border-zinc-400 focus:bg-white"
                        placeholder="输入 API Secret"
                      />
                    </label>
                    {credentialError && (
                      <p className="text-xs text-rose-600">{credentialError}</p>
                    )}
                    <div className="flex items-center justify-between pt-2">
                      <div>
                        {credentialStatus.configured && (
                          <button
                            type="button"
                            onClick={() => void clearCredentials()}
                            className="text-xs text-rose-600 hover:text-rose-700"
                          >
                            移除本机凭据
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {credentialStatus.configured && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowCredentialForm(false);
                              setCredentialKey("");
                              setCredentialSecret("");
                              setCredentialError("");
                            }}
                            className="h-9 px-4 rounded-xl border border-zinc-200 text-xs text-zinc-600"
                          >
                            取消
                          </button>
                        )}
                        <button
                          type="submit"
                          disabled={
                            credentialSaving ||
                            !credentialKey.trim() ||
                            !credentialSecret.trim()
                          }
                          className="h-9 px-4 rounded-xl bg-zinc-900 text-white text-xs disabled:opacity-40"
                        >
                          {credentialSaving ? "加密保存中…" : "加密保存并连接"}
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </section>
            ) : market === "explore" ? (
              <>
                <section className="bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5">
                        <Compass className="w-4 h-4" />
                        行情发现
                      </h2>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        Gate USDT 永续按 24h
                        成交额排序。不会搜代码？顶部搜索框输入「微软」「比特币」即可加入自选。
                      </p>
                    </div>
                    <div className="flex items-center gap-1 bg-zinc-100 p-0.5 rounded-xl text-[11px]">
                      {(
                        [
                          ["all", "全部"],
                          ["crypto", "加密"],
                          ["equity", "美股合成"],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setHotFilter(key)}
                          className={`px-2.5 py-1 rounded-lg ${
                            hotFilter === key
                              ? "bg-white text-zinc-900 shadow-xs"
                              : "text-zinc-500 hover:text-zinc-800"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                {hotError && (
                  <div className="px-4 py-2.5 rounded-xl border border-amber-100 bg-amber-50 text-xs text-amber-800 flex items-center justify-between">
                    <span>{hotError}</span>
                    <button
                      onClick={() => void loadHotQuotes({ force: true })}
                      className="font-medium"
                    >
                      重试
                    </button>
                  </div>
                )}

                <div className="overflow-hidden bg-white">
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-800">
                      热门永续合约
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      {hotLoading && !hotQuotes.length
                        ? "同步中…"
                        : hotTotal
                        ? `已加载 ${hotQuotes.length} / ${hotTotal}`
                        : `共 ${hotQuotes.length} 个`}
                    </span>
                  </div>
                  <HotQuotesDataTable
                    data={hotQuotes}
                    loading={hotLoading && !hotQuotes.length}
                    loadingMore={hotLoadingMore}
                    hasMore={hotHasMore}
                    total={hotTotal}
                    watchlist={watchlist}
                    onAdd={addItem}
                    onNearEnd={loadMoreHotQuotes}
                  />
                </div>
              </>
            ) : market === "position" ? (
              <>
                {accountError && (
                  <div className="px-4 py-2.5 rounded-xl border border-amber-100 bg-amber-50 text-xs text-amber-800 flex items-center justify-between">
                    <span>{accountError}</span>
                    <button
                      onClick={() => void refreshAccount()}
                      className="font-medium"
                    >
                      重试
                    </button>
                  </div>
                )}
                {/* 资产权益与盈亏 4 栏精简概览卡片 */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div className="p-3.5 rounded-2xl border border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white shadow-xs">
                    <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                      <span className="text-[11px] font-medium text-zinc-500">
                        合约总资产权益
                      </span>
                      <Wallet className="w-4 h-4 text-zinc-400" />
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 tracking-tight">
                      {accountData?.total == null
                        ? accountLoading
                          ? "加载中…"
                          : "--"
                        : `$${fmt(accountData.total, 2)}`}
                      <span className="text-[11px] font-normal text-zinc-400 ml-1">
                        USDT
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
                      <span>保证金 + 浮动盈亏</span>
                      <span className="font-mono text-zinc-500">100% 净值</span>
                    </div>
                  </div>

                  <div
                    className={`p-3.5 rounded-2xl border shadow-xs ${
                      pnlValue == null
                        ? "border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white"
                        : pnlValue >= 0
                        ? "border-emerald-200/80 bg-gradient-to-b from-emerald-50/40 to-white"
                        : "border-rose-200/80 bg-gradient-to-b from-rose-50/40 to-white"
                    }`}
                  >
                    <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                      <span className="text-[11px] font-medium text-zinc-600">
                        持仓未实现盈亏 (收益)
                      </span>
                      {pnlValue == null ? (
                        <Activity className="w-4 h-4 text-zinc-300" />
                      ) : pnlValue >= 0 ? (
                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-rose-600" />
                      )}
                    </div>
                    <div
                      className={`text-xl font-bold font-mono tabular-nums tracking-tight ${
                        pnlValue == null
                          ? "text-zinc-400"
                          : pnlValue >= 0
                          ? "text-emerald-600"
                          : "text-rose-600"
                      }`}
                    >
                      {pnlValue == null ? "--" : money(pnlValue, "USDT", true)}
                    </div>
                    <div className="text-[10px] mt-1 flex items-center justify-between font-mono">
                      <span
                        className={
                          pnlValue == null
                            ? "text-zinc-400"
                            : pnlValue >= 0
                            ? "text-emerald-600 font-semibold"
                            : "text-rose-600 font-semibold"
                        }
                      >
                        收益率 {pnlPercent}
                      </span>
                      <span className="text-zinc-400">浮动净收益</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl border border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white shadow-xs">
                    <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                      <span className="text-[11px] font-medium text-zinc-500">
                        可用保证金余额
                      </span>
                      <ShieldCheck className="w-4 h-4 text-zinc-400" />
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 tracking-tight">
                      {accountData?.available == null
                        ? "--"
                        : `$${fmt(accountData.available, 2)}`}
                      <span className="text-[11px] font-normal text-zinc-400 ml-1">
                        USDT
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
                      <span>可开新仓 / 抗波动</span>
                      <span className="font-mono text-zinc-500">
                        占比{" "}
                        {accountData?.total && accountData.available != null
                          ? (
                              (accountData.available / accountData.total) *
                              100
                            ).toFixed(0)
                          : "--"}
                        %
                      </span>
                    </div>
                  </div>

                  {/* 第 4 张：totalAsset + unrealisedPnl */}
                  <div className="p-3.5 rounded-2xl border border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white shadow-xs">
                    <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                      <span className="text-[11px] font-medium text-zinc-500">
                        总资产估值
                      </span>
                      <Banknote className="w-4 h-4 text-zinc-400" />
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 tracking-tight">
                      {totalAssetValue == null
                        ? accountLoading
                          ? "加载中…"
                          : "--"
                        : `$${fmt(totalAssetValue, 2)}`}
                      <span className="text-[11px] font-normal text-zinc-400 ml-1">
                        USDT
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between gap-2">
                      <span className="truncate">
                        资产{" "}
                        {accountData?.totalAsset == null
                          ? "--"
                          : fmt(accountData.totalAsset, 2)}{" "}
                        · 浮盈{" "}
                        {pnlValue == null
                          ? "--"
                          : money(pnlValue, "USDT", true)}
                      </span>
                      <span className="font-mono text-zinc-500 shrink-0">
                        资产+浮盈
                      </span>
                    </div>
                  </div>
                </div>

                {/* 持仓明细表格 */}
                <div className="overflow-hidden bg-white shrink-0">
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-800">
                        已购股票 / 美股合成资产与合约持仓
                      </span>
                      <span className="text-[11px] text-zinc-400 hidden sm:inline">
                        点击任意行可在右侧面板查看实时 24h K 线走势与深度
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-zinc-500">
                      占用保证金:{" "}
                      {accountData?.openPositions
                        ? `$${fmt(
                            accountData.openPositions.reduce(
                              (s, p) => s + p.margin,
                              0,
                            ),
                            2,
                          )}`
                        : "--"}{" "}
                      USDT
                    </span>
                  </div>
                  <PositionsDataTable
                    data={accountData?.openPositions ?? null}
                    loading={accountLoading}
                    errorText={
                      accountData?.positionError || accountError || undefined
                    }
                    selectedSymbol={selectedSymbol}
                    onSelect={handleSelectSymbol}
                  />
                </div>

                {/* 现货钱包余额：接口失败时明确提示，不当作“没有资产” */}
                {accountData && accountData.spotBalances === null && (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-xs text-amber-800">
                    现货钱包数据不可用
                    {accountData.spotError ? `：${accountData.spotError}` : ""}
                    ，请稍后重试
                  </div>
                )}
                {accountData && accountData.spotBalances !== null && (
                  <div className="rounded-2xl border border-zinc-200/80 overflow-hidden bg-white shrink-0 shadow-xs">
                    <div className="px-4 py-3 bg-zinc-50/70 border-b border-zinc-200/60 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Coins className="w-4 h-4 text-zinc-500" />
                        <span className="text-xs font-bold text-zinc-800">
                          现货钱包资产 (Spot Wallet)
                        </span>
                      </div>
                      <span className="text-[11px] text-zinc-400">
                        非合约保证金资产
                      </span>
                    </div>
                    <SpotBalancesDataTable data={accountData.spotBalances} />
                  </div>
                )}
              </>
            ) : (
              <>
                {/* 原合约/现货 3 卡片走势 Highlights */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  {highlights.map((item) => {
                    const quote = quoteMap.get(quoteKey(item))!;
                    const up = quote.changePercent >= 0;
                    const candleKey = `${
                      item.kind
                    }:${item.symbol.toUpperCase()}`;
                    const series = candlesMap[candleKey] ?? [];
                    const points = getSparklinePoints(series, quote, 80, 24);
                    return (
                      <button
                        key={item.symbol}
                        onClick={() => handleSelectSymbol(item.symbol)}
                        className={`text-left p-3.5 rounded-2xl border transition-all ${
                          selectedSymbol === item.symbol
                            ? "border-zinc-900 bg-white shadow-xs ring-2 ring-zinc-900/5"
                            : "border-zinc-200/80 bg-gradient-to-b from-zinc-50/70 to-white shadow-xs hover:border-zinc-300"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <SymbolIcon item={item} size={28} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold">
                                  {baseSymbol(item.symbol)}
                                </span>
                                <span className="text-[10px] px-1 py-0.5 rounded bg-zinc-200/70 text-zinc-600 font-medium">
                                  {market === "contract" ? "永续" : "现货"}
                                </span>
                              </div>
                            </div>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-md font-mono tabular-nums text-[11px] font-semibold ${
                              up
                                ? "bg-emerald-50 text-emerald-600"
                                : "bg-rose-50 text-rose-600"
                            }`}
                          >
                            {up ? "+" : ""}
                            {fmt(quote.changePercent)}%
                          </span>
                        </div>
                        <div className="flex items-end justify-between mt-2">
                          <div>
                            <div className="text-base font-bold font-mono tabular-nums">
                              {money(quote.price, quote.currency)}
                            </div>
                            <div className="text-[10px] text-zinc-400 mt-0.5 font-mono tabular-nums">
                              {market === "contract"
                                ? `持仓 ${formatCompact(
                                    quote.openInterest,
                                  )} · 费率 ${
                                    quote.fundingRate?.toFixed(4) ?? "--"
                                  }%`
                                : `成交额 ${formatCompact(
                                    quote.turnover24h,
                                    quote.currency,
                                  )}`}
                            </div>
                          </div>
                          <svg
                            className="w-20 h-8 overflow-visible"
                            viewBox="0 0 80 32"
                            aria-label={`${item.symbol} 24小时走势`}
                          >
                            {points && (
                              <polyline
                                points={points}
                                fill="none"
                                stroke={up ? "#10b981" : "#e11d48"}
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            )}
                          </svg>
                        </div>
                      </button>
                    );
                  })}
                  {highlights.length < 3 &&
                    Array.from({ length: 3 - highlights.length }, (_, i) => (
                      <div
                        key={`placeholder-${i}`}
                        className="min-h-[100px] p-3.5 rounded-2xl border border-dashed border-zinc-200 bg-white/60 flex items-center justify-center text-[11px] text-zinc-400"
                      >
                        {loading && !quotes.length
                          ? "行情同步中…"
                          : "添加自选以显示行情"}
                      </div>
                    ))}
                </div>

                {/* 自选行情列表 */}
                <div className="overflow-hidden bg-white shrink-0 h-full flex-1 flex flex-col">
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-800">
                        自选{market === "contract" ? "合约" : "现货"}列表
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        单击看侧栏，双击打开详情
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                      <button
                        onClick={() => setSortBy("default")}
                        className={
                          sortBy === "default"
                            ? "text-zinc-900 font-medium"
                            : ""
                        }
                      >
                        默认
                      </button>
                      <button
                        onClick={() => setSortBy("change")}
                        className={
                          sortBy === "change" ? "text-zinc-900 font-medium" : ""
                        }
                      >
                        涨跌幅 ↕
                      </button>
                      {market === "contract" && (
                        <button
                          onClick={() => setSortBy("funding")}
                          className={
                            sortBy === "funding"
                              ? "text-zinc-900 font-medium"
                              : ""
                          }
                        >
                          资金费率 ↕
                        </button>
                      )}
                    </div>
                  </div>
                  <WatchlistDataTable
                    rows={watchRows}
                    market={market === "spot" ? "spot" : "contract"}
                    loading={loading}
                    hasLoaded={hasLoaded}
                    emptyHint={input ? "没有匹配的自选" : "还没有自选标的"}
                    countdown={countdown}
                    onSelect={handleSelectSymbol}
                    onOpenDetail={handleOpenDetail}
                    onRemove={removeItem}
                  />
                </div>
              </>
            ))}
          </div>

          {/* 右侧独立盯盘侧栏；资讯 Tab 全宽，不占侧栏 */}
          {market !== "news" && (
            <aside className="hidden xl:flex w-[300px] border-l border-zinc-100 bg-zinc-50/50 p-3.5 flex-col justify-between shrink-0 overflow-y-auto">
              <div className="space-y-3.5">
                {/* 标的概览与 24h K 线微图 */}
                <section className="p-3.5 rounded-2xl bg-white border border-zinc-200/80 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {active && <SymbolIcon item={active} size={26} />}
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-zinc-900 truncate">
                          {active?.name
                            ? active.name
                            : active?.symbol ?? "未选择标的"}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {active?.kind === "contract" ||
                          active?.symbol.includes("_")
                            ? "Gate.io 永续合约"
                            : "现货行情"}
                        </div>
                      </div>
                    </div>
                    {activeQuote && (
                      <div className="text-right">
                        <div
                          className={`text-xs font-mono tabular-nums font-bold ${
                            positive ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {money(activeQuote.price, activeQuote.currency)}
                        </div>
                        <div
                          className={`text-[10px] font-mono ${
                            positive ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {positive ? "+" : ""}
                          {fmt(activeQuote.changePercent)}%
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 24h 走势微图 */}
                  {sidebarPoints && (
                    <div className="mt-3 pt-2.5 border-t border-zinc-100">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                        <span>24h 价格走势</span>
                        <span className="font-mono">
                          {positive ? "↗ 上涨" : "↘ 下跌"}
                        </span>
                      </div>
                      <svg
                        className="w-full h-10 overflow-visible"
                        viewBox="0 0 256 40"
                        preserveAspectRatio="none"
                      >
                        <polyline
                          points={sidebarPoints}
                          fill="none"
                          stroke={positive ? "#10b981" : "#e11d48"}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  )}

                  <div className="mt-3 pt-2.5 border-t border-zinc-100 grid grid-cols-2 gap-2 text-[10px]">
                    {active?.asset === "equity" ? (
                      <>
                        <div>
                          <div className="text-zinc-400">今开</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {activeQuote?.open
                              ? money(activeQuote.open, activeQuote.currency)
                              : "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-zinc-400">昨收</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {activeQuote?.prevClose
                              ? money(
                                  activeQuote.prevClose,
                                  activeQuote.currency,
                                )
                              : "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-zinc-400">最高</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {activeQuote?.high24h
                              ? money(
                                  activeQuote.high24h,
                                  activeQuote.currency,
                                )
                              : "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-zinc-400">最低</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {activeQuote?.low24h
                              ? money(activeQuote.low24h, activeQuote.currency)
                              : "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-zinc-400">换手率</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {activeQuote?.turnoverRate != null
                              ? `${fmt(activeQuote.turnoverRate)}%`
                              : "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-zinc-400">市盈率 PE</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {activeQuote?.pe != null
                              ? fmt(activeQuote.pe)
                              : "--"}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <div className="text-zinc-400">标记价格</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {activeQuote?.markPrice
                              ? money(activeQuote.markPrice, "USDT")
                              : "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-zinc-400">持仓总量 (OI)</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {formatCompact(activeQuote?.openInterest)}
                          </div>
                        </div>
                        <div>
                          <div className="text-zinc-400">24h 最高</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {activeQuote?.high24h
                              ? money(
                                  activeQuote.high24h,
                                  activeQuote.currency,
                                )
                              : "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-zinc-400">24h 最低</div>
                          <div className="mt-0.5 font-mono font-semibold">
                            {activeQuote?.low24h
                              ? money(activeQuote.low24h, activeQuote.currency)
                              : "--"}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {active && (
                    <button
                      type="button"
                      onClick={() => handleOpenDetail(active.symbol)}
                      className="mt-3 w-full h-8 rounded-xl bg-zinc-900 text-white text-[11px] font-medium inline-flex items-center justify-center gap-1 hover:bg-zinc-800 transition-colors"
                    >
                      {detailOpen ? "已在详情页" : "打开详情"}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* 若用户持有该标的，嵌入显示该标的当前持仓简报 */}
                  {heldPositionForActive && (
                    <div className="mt-3 pt-2.5 border-t border-zinc-100 bg-zinc-50/70 -mx-3.5 -mb-3.5 p-3 rounded-b-2xl text-[11px]">
                      <div className="flex items-center justify-between font-medium text-zinc-700 mb-1.5">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              heldPositionForActive.side === "short"
                                ? "bg-rose-500"
                                : "bg-emerald-500"
                            }`}
                          />
                          <span>
                            我的仓位 (
                            {heldPositionForActive.side === "short"
                              ? "做空"
                              : "做多"}{" "}
                            {heldPositionForActive.leverage}x)
                          </span>
                        </span>
                        <span
                          className={`font-mono font-bold ${
                            heldPositionForActive.unrealisedPnl >= 0
                              ? "text-emerald-600"
                              : "text-rose-600"
                          }`}
                        >
                          {money(
                            heldPositionForActive.unrealisedPnl,
                            "USDT",
                            true,
                          )}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[10px] text-zinc-500 font-mono">
                        <div>数量: {heldPositionForActive.size} 张</div>
                        <div>
                          成本:{" "}
                          {money(heldPositionForActive.entryPrice, "USDT")}
                        </div>
                        <div>
                          名义价值: {money(heldPositionForActive.value, "USDT")}
                        </div>
                        <div>
                          回报:{" "}
                          {heldPositionForActive.pnlPercent >= 0 ? "+" : ""}
                          {heldPositionForActive.pnlPercent.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {/* 多空账户比 */}
                {(active?.kind === "contract" ||
                  active?.symbol.includes("_")) &&
                  activeQuote?.longRatio != null && (
                    <section className="p-3 rounded-2xl bg-white border border-zinc-200/80 shadow-xs">
                      <div className="flex justify-between text-[10px] font-mono mb-1">
                        <span className="text-emerald-600 font-semibold">
                          多头 {(activeQuote.longRatio * 100).toFixed(1)}%
                        </span>
                        <span className="text-zinc-400">多空持仓比</span>
                        <span className="text-rose-600 font-semibold">
                          空头 {((1 - activeQuote.longRatio) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-rose-500 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${activeQuote.longRatio * 100}%` }}
                        />
                      </div>
                    </section>
                  )}

                {/* 价格预警 */}
                <section className="p-3.5 rounded-2xl bg-white border border-zinc-200/80 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5" />
                      价格预警
                    </span>
                    <span className="text-[10px] text-zinc-400">系统提醒</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={alertDirection}
                      onChange={(e) =>
                        setAlertDirection(e.target.value as "above" | "below")
                      }
                      className="bg-zinc-100 rounded-lg px-2 py-1.5 text-xs text-zinc-700 outline-none"
                    >
                      <option value="above">高于 ≥</option>
                      <option value="below">低于 ≤</option>
                    </select>
                    <input
                      value={alertPrice}
                      onChange={(e) => setAlertPrice(e.target.value)}
                      type="number"
                      min="0"
                      placeholder={
                        activeQuote ? fmt(activeQuote.price) : "目标价格"
                      }
                      className="w-full min-w-0 bg-zinc-100 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-900 outline-none"
                    />
                    <button
                      onClick={addAlert}
                      className="px-2.5 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-medium shrink-0"
                    >
                      添加
                    </button>
                  </div>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {alerts
                      .filter((alert) => alert.symbol.startsWith(`${market}:`))
                      .map((alert) => (
                        <div
                          key={alert.id}
                          className="flex items-center justify-between text-[11px] bg-zinc-50 px-2 py-1 rounded-lg"
                        >
                          <span className="text-zinc-600">
                            {alert.symbol.split(":")[1]?.replace("USDT", "")}{" "}
                            {alert.direction === "above" ? "≥" : "≤"}{" "}
                            <strong className="font-mono text-zinc-900">
                              {fmt(alert.target)}
                            </strong>
                          </span>
                          <button
                            onClick={() => removeAlert(alert.id)}
                            className={
                              alert.triggered
                                ? "text-amber-600"
                                : "text-emerald-600"
                            }
                          >
                            {alert.triggered ? "已触发" : "监控中"}
                          </button>
                        </div>
                      ))}
                  </div>
                </section>
              </div>

              <div className="mt-3 text-[10px] text-zinc-400 border-t border-zinc-200/60 pt-2 flex items-center justify-between">
                <span>Gate.io Public & Auth API</span>
                <span>行情仅供参考</span>
              </div>
            </aside>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
