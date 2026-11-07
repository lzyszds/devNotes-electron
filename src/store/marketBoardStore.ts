import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { electronPersistStorage } from "./electronPersistStorage";
import {
  peekLegacyLocalJson,
  purgeLegacyLocalKeys,
} from "./migrateLocalKey";

export type MarketTab =
  | "contract"
  | "spot"
  | "explore"
  | "position"
  | "news";

export type RefreshIntervalSec = 0 | 1 | 3 | 5 | 10 | 15 | 30 | 60;

export type MarketWatchItem = {
  symbol: string;
  name: string;
  kind: "contract" | "spot";
  asset: "crypto" | "equity";
};

export type MarketQuoteSnap = {
  symbol: string;
  name: string;
  kind: "contract" | "spot";
  asset: "crypto" | "equity";
  price: number;
  changePercent: number;
  change: number;
  currency: string;
  fundingRate?: number;
  openInterest?: number;
  high24h?: number;
  low24h?: number;
  markPrice?: number;
  nextFundingTime?: number;
  fundingIntervalHours?: number;
  turnover24h?: number;
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

export type MarketNewsSnap = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category: "equity" | "crypto" | "exchange";
  sentiment: "bull" | "bear" | "neutral";
};

export type MarketNewsCache = {
  items: MarketNewsSnap[];
  nextPage: number;
  totalCount: number;
  hasMore: boolean;
  updatedAt: number;
};

export type MarketAlert = {
  id: string;
  symbol: string;
  target: number;
  direction: "above" | "below";
  triggered: boolean;
};

const PERSIST_NAME = "market-board-persist-v1";

const LEGACY_KEYS = [
  "market-board-watchlist-v1",
  "market-board-alerts-v1",
  "market-board-quotes-cache-v1",
  "market-board-candles-cache-v1",
  "market-board-last-updated-v1",
  "market-board-market-tab-v1",
  "market-board-selected-symbol-v1",
  "market-board-account-cache-v1",
  "market-board-refresh-interval-v1",
  "market-board-news-panel-v2",
] as const;

const DEFAULT_WATCHLIST: MarketWatchItem[] = [
  { symbol: "BTCUSDT", name: "Bitcoin", kind: "contract", asset: "crypto" },
  { symbol: "ETHUSDT", name: "Ethereum", kind: "contract", asset: "crypto" },
  { symbol: "SOLUSDT", name: "Solana", kind: "contract", asset: "crypto" },
  { symbol: "BTCUSDT", name: "Bitcoin", kind: "spot", asset: "crypto" },
  { symbol: "ETHUSDT", name: "Ethereum", kind: "spot", asset: "crypto" },
  { symbol: "SOLUSDT", name: "Solana", kind: "spot", asset: "crypto" },
  { symbol: "MU", name: "Micron Technology", kind: "spot", asset: "equity" },
  { symbol: "sh600000", name: "浦发银行", kind: "spot", asset: "equity" },
  { symbol: "sz000001", name: "平安银行", kind: "spot", asset: "equity" },
  { symbol: "hk00700", name: "腾讯控股", kind: "spot", asset: "equity" },
];

function clampRefreshInterval(raw: unknown): RefreshIntervalSec {
  const n = typeof raw === "number" ? raw : Number(raw);
  return ([0, 1, 3, 5, 10, 15, 30, 60] as const).includes(
    n as RefreshIntervalSec,
  )
    ? (n as RefreshIntervalSec)
    : 30;
}

type MarketBoardState = {
  watchlist: MarketWatchItem[];
  alerts: MarketAlert[];
  quotesCache: MarketQuoteSnap[];
  candlesCache: Record<string, number[]>;
  lastUpdated: number | null;
  marketTab: MarketTab;
  selectedSymbol: string;
  accountCache: unknown | null;
  refreshIntervalSec: RefreshIntervalSec;
  newsCache: MarketNewsCache | null;
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  setWatchlist: (next: MarketWatchItem[]) => void;
  setAlerts: (next: MarketAlert[]) => void;
  setQuotesCache: (next: MarketQuoteSnap[]) => void;
  setCandlesCache: (next: Record<string, number[]>) => void;
  setLastUpdated: (ts: number | null) => void;
  setMarketTab: (tab: MarketTab) => void;
  setSelectedSymbol: (symbol: string) => void;
  setAccountCache: (data: unknown | null) => void;
  setRefreshIntervalSec: (sec: RefreshIntervalSec) => void;
  setNewsCache: (cache: MarketNewsCache | null) => void;
};

function adoptLegacyInto(
  partial: Partial<MarketBoardState>,
): Partial<MarketBoardState> {
  const next = { ...partial };

  const watch = peekLegacyLocalJson<MarketWatchItem[]>(
    "market-board-watchlist-v1",
  );
  if ((!next.watchlist || next.watchlist.length === 0) && Array.isArray(watch)) {
    next.watchlist = watch;
  }

  const alerts = peekLegacyLocalJson<MarketAlert[]>("market-board-alerts-v1");
  if ((!next.alerts || next.alerts.length === 0) && Array.isArray(alerts)) {
    next.alerts = alerts;
  }

  const quotes = peekLegacyLocalJson<MarketQuoteSnap[]>(
    "market-board-quotes-cache-v1",
  );
  if (
    (!next.quotesCache || next.quotesCache.length === 0) &&
    Array.isArray(quotes)
  ) {
    next.quotesCache = quotes;
  }

  const candles = peekLegacyLocalJson<Record<string, number[]>>(
    "market-board-candles-cache-v1",
  );
  if (
    (!next.candlesCache || Object.keys(next.candlesCache).length === 0) &&
    candles &&
    typeof candles === "object"
  ) {
    next.candlesCache = candles;
  }

  const lastUpdated = peekLegacyLocalJson<number>(
    "market-board-last-updated-v1",
  );
  if (next.lastUpdated == null && typeof lastUpdated === "number") {
    next.lastUpdated = lastUpdated;
  }

  const tab = peekLegacyLocalJson<MarketTab>("market-board-market-tab-v1");
  if (
    tab === "contract" ||
    tab === "spot" ||
    tab === "explore" ||
    tab === "position" ||
    tab === "news"
  ) {
    if (!partial.marketTab || partial.marketTab === "contract") {
      next.marketTab = tab;
    }
  }

  const selected = peekLegacyLocalJson<string>(
    "market-board-selected-symbol-v1",
  );
  if (typeof selected === "string" && selected) {
    next.selectedSymbol = selected;
  }

  const account = peekLegacyLocalJson<unknown>(
    "market-board-account-cache-v1",
  );
  if (next.accountCache == null && account != null) {
    next.accountCache = account;
  }

  const interval = peekLegacyLocalJson<number>(
    "market-board-refresh-interval-v1",
  );
  if (interval != null) {
    next.refreshIntervalSec = clampRefreshInterval(interval);
  }

  const news = peekLegacyLocalJson<MarketNewsCache>(
    "market-board-news-panel-v2",
  );
  if (!next.newsCache && news && Array.isArray(news.items) && news.items.length) {
    next.newsCache = news;
  }

  purgeLegacyLocalKeys([...LEGACY_KEYS]);
  return next;
}

export const useMarketBoardStore = create<MarketBoardState>()(
  persist(
    (set) => ({
      watchlist: DEFAULT_WATCHLIST,
      alerts: [],
      quotesCache: [],
      candlesCache: {},
      lastUpdated: null,
      marketTab: "contract",
      selectedSymbol: "BTCUSDT",
      accountCache: null,
      refreshIntervalSec: 30,
      newsCache: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      setWatchlist: (watchlist) => set({ watchlist }),
      setAlerts: (alerts) => set({ alerts }),
      setQuotesCache: (quotesCache) => set({ quotesCache }),
      setCandlesCache: (candlesCache) => set({ candlesCache }),
      setLastUpdated: (lastUpdated) => set({ lastUpdated }),
      setMarketTab: (marketTab) => set({ marketTab }),
      setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol }),
      setAccountCache: (accountCache) => set({ accountCache }),
      setRefreshIntervalSec: (refreshIntervalSec) =>
        set({ refreshIntervalSec: clampRefreshInterval(refreshIntervalSec) }),
      setNewsCache: (newsCache) => set({ newsCache }),
    }),
    {
      name: PERSIST_NAME,
      storage: createJSONStorage(() => electronPersistStorage),
      partialize: (s) => ({
        watchlist: s.watchlist,
        alerts: s.alerts,
        quotesCache: s.quotesCache,
        candlesCache: s.candlesCache,
        lastUpdated: s.lastUpdated,
        marketTab: s.marketTab,
        selectedSymbol: s.selectedSymbol,
        accountCache: s.accountCache,
        refreshIntervalSec: s.refreshIntervalSec,
        newsCache: s.newsCache,
      }),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === "object"
            ? (persisted as Partial<MarketBoardState>)
            : {};
        /* 旧版拆 key 的 localStorage / 旧 electron-store 单 key，并入统一 blob */
        const adopted = adoptLegacyInto(raw);
        return {
          ...current,
          ...adopted,
          refreshIntervalSec: clampRefreshInterval(
            adopted.refreshIntervalSec ?? current.refreshIntervalSec,
          ),
          watchlist:
            Array.isArray(adopted.watchlist) && adopted.watchlist.length
              ? adopted.watchlist
              : current.watchlist,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        /* 即便 persist 为空，也扫一遍 legacy 并清掉 */
        if (state) {
          const adopted = adoptLegacyInto({});
          state.setWatchlist(adopted.watchlist ?? state.watchlist);
          if (adopted.alerts) state.setAlerts(adopted.alerts);
          if (adopted.quotesCache) state.setQuotesCache(adopted.quotesCache);
          if (adopted.candlesCache) state.setCandlesCache(adopted.candlesCache);
          if (adopted.lastUpdated != null)
            state.setLastUpdated(adopted.lastUpdated);
          if (adopted.marketTab) state.setMarketTab(adopted.marketTab);
          if (adopted.selectedSymbol)
            state.setSelectedSymbol(adopted.selectedSymbol);
          if (adopted.accountCache !== undefined)
            state.setAccountCache(adopted.accountCache ?? null);
          if (adopted.refreshIntervalSec != null)
            state.setRefreshIntervalSec(adopted.refreshIntervalSec);
          if (adopted.newsCache) state.setNewsCache(adopted.newsCache);
        } else {
          purgeLegacyLocalKeys([...LEGACY_KEYS]);
        }
      },
    },
  ),
);

/** 内容是否仍是出厂默认自选（引用比较在 persist 重水合后会失效） */
function isDefaultWatchlist(list: MarketWatchItem[]): boolean {
  if (list.length !== DEFAULT_WATCHLIST.length) return false;
  return list.every((item, i) => {
    const d = DEFAULT_WATCHLIST[i];
    return (
      item.symbol === d.symbol &&
      item.kind === d.kind &&
      item.asset === d.asset &&
      item.name === d.name
    );
  });
}

/** 兼容旧 electron-store 里单独存的 watchlist / alerts */
export async function hydrateMarketBoardFromLegacyStore() {
  const api = window.electronAPI;
  if (!api?.storeGet) return;
  try {
    const watch = await api.storeGet("market-board-watchlist-v1");
    const state = useMarketBoardStore.getState();
    /* 空列表或仍是默认自选时才吞进 legacy，避免盖掉用户已改的 persist blob */
    if (
      Array.isArray(watch) &&
      watch.length &&
      (state.watchlist.length === 0 || isDefaultWatchlist(state.watchlist))
    ) {
      state.setWatchlist(watch as MarketWatchItem[]);
    }
  } catch {
    /* ignore */
  }
  try {
    const alerts = await api.storeGet("market-board-alerts-v1");
    const state = useMarketBoardStore.getState();
    if (Array.isArray(alerts) && alerts.length && !state.alerts.length) {
      state.setAlerts(alerts as MarketAlert[]);
    }
  } catch {
    /* ignore */
  }
}
