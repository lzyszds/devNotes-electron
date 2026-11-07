import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Newspaper,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import VirtualList from "../../ui/VirtualList";
import DevToolboxLoader from "../../ui/DevToolboxLoader";
import {
  useMarketBoardStore,
  type MarketNewsCache,
} from "../../../store/marketBoardStore";

type NewsCategory = "equity" | "crypto" | "exchange";
type NewsSentiment = "bull" | "bear" | "neutral";

type NewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category: NewsCategory;
  sentiment: NewsSentiment;
};

type CategoryFilter = "all" | NewsCategory;
type SentimentFilter = "all" | NewsSentiment;

const PAGE_SIZE = 20;
/* 本地最多攒这么多条，避免内存无限涨 */
const MAX_CACHED_ITEMS = 400;
const REFRESH_MS = 5 * 60_000;

/** 旧版拼成 /zh/post/news/… 会 404，读缓存时顺手改到 /zh/news/detail/… */
function normalizeNewsUrl(url: string): string {
  return String(url || "")
    .trim()
    .replace(
      /^https?:\/\/(?:www\.)?gate\.(?:com|io)\/(?:zh\/)?post\/news\//i,
      "https://www.gate.com/zh/news/detail/",
    )
    .replace(
      /^https?:\/\/(?:www\.)?gate\.(?:com|io)\/news\/detail\//i,
      "https://www.gate.com/zh/news/detail/",
    );
}

function isNewsItem(value: unknown): value is NewsItem {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.title === "string" &&
    row.title.trim().length > 0 &&
    typeof row.url === "string" &&
    row.url.trim().length > 0
  );
}

function coerceNewsItem(value: unknown): NewsItem | null {
  if (!isNewsItem(value)) return null;
  return { ...value, url: normalizeNewsUrl(value.url) };
}

function normalizeCache(raw: MarketNewsCache | null): MarketNewsCache | null {
  if (!raw || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .map(coerceNewsItem)
    .filter((item): item is NewsItem => Boolean(item))
    .slice(0, MAX_CACHED_ITEMS);
  if (!items.length) return null;
  return {
    items,
    nextPage: Math.max(2, Number(raw.nextPage) || 2),
    totalCount: Math.max(items.length, Number(raw.totalCount) || 0),
    hasMore: raw.hasMore !== false,
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function mergeNews(prev: NewsItem[], incoming: NewsItem[]): NewsItem[] {
  const seen = new Set(prev.map((item) => item.url));
  const next = [...prev];
  for (const item of incoming) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    next.push(item);
  }
  return next.slice(0, MAX_CACHED_ITEMS);
}

/**
 * 软刷新：首页新数据按 url 就地换内容，新头条插到前面，旧翻页数据接在后面。
 * 稳定 url 作 key，虚拟列表行 DOM 尽量不卸挂。
 */
function softReplaceNews(prev: NewsItem[], incoming: NewsItem[]): NewsItem[] {
  if (!incoming.length) return prev;
  if (!prev.length) return incoming.slice(0, MAX_CACHED_ITEMS);
  const fresh = new Map(incoming.map((item) => [item.url, item] as const));
  const next: NewsItem[] = [];
  const seen = new Set<string>();
  for (const row of incoming) {
    next.push(row);
    seen.add(row.url);
  }
  for (const old of prev) {
    if (seen.has(old.url)) continue;
    const patched = fresh.get(old.url);
    next.push(patched ?? old);
    seen.add(old.url);
  }
  return next.slice(0, MAX_CACHED_ITEMS);
}

function decodeHtmlEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(t).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CATEGORY_TABS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "crypto", label: "加密" },
  { key: "equity", label: "股票" },
  { key: "exchange", label: "交易所" },
];

const SENTIMENT_TABS: { key: SentimentFilter; label: string }[] = [
  { key: "all", label: "全部情绪" },
  { key: "bull", label: "利多" },
  { key: "bear", label: "利空" },
  { key: "neutral", label: "中性" },
];

/** 行情页「资讯」Tab：Gate Moments 快讯 + 筛选 + 虚拟列表翻页 */
export default function MarketNewsPanel({ active }: { active: boolean }) {
  /* 启动同步读 store：有旧数据先顶着，绝不等网络 */
  const boot = useMemo(
    () => normalizeCache(useMarketBoardStore.getState().newsCache),
    [],
  );
  const setNewsCache = useMarketBoardStore((s) => s.setNewsCache);
  const [news, setNews] = useState<NewsItem[]>(() => boot?.items ?? []);
  const [nextPage, setNextPage] = useState(() => boot?.nextPage ?? 2);
  const [hasMore, setHasMore] = useState(() => boot?.hasMore ?? true);
  const [totalCount, setTotalCount] = useState(() => boot?.totalCount ?? 0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<number | null>(
    () => boot?.updatedAt ?? null,
  );
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [sentiment, setSentiment] = useState<SentimentFilter>("all");

  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(hasMore);
  const nextPageRef = useRef(nextPage);
  const newsLenRef = useRef(news.length);
  hasMoreRef.current = hasMore;
  nextPageRef.current = nextPage;
  newsLenRef.current = news.length;

  const persist = useCallback(
    (patch: {
      items: NewsItem[];
      nextPage: number;
      totalCount: number;
      hasMore: boolean;
    }) => {
      /* 空列表绝不落盘，避免把已有缓存冲掉后重启只剩加载态 */
      if (!patch.items.length) return;
      const updatedAt = Date.now();
      setLastUpdated(updatedAt);
      setNewsCache({
        ...patch,
        items: patch.items.slice(0, MAX_CACHED_ITEMS),
        updatedAt,
      });
    },
    [setNewsCache],
  );

  const loadPage = useCallback(
    async (opts: {
      page: number;
      mode: "replace" | "append";
      force?: boolean;
      silent?: boolean;
    }) => {
      const api = window.electronAPI?.marketNews;
      if (!api) {
        setError("请在桌面版查看 Gate 资讯");
        return;
      }
      if (opts.mode === "append") {
        if (loadingMoreRef.current || !hasMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else if (!opts.silent) {
        setLoading(true);
      }

      try {
        const result = await api({
          page: opts.page,
          pageSize: PAGE_SIZE,
          force: opts.force,
        });
        const rows = ((result?.items ?? []) as NewsItem[])
          .map(coerceNewsItem)
          .filter((item): item is NewsItem => Boolean(item));
        setError("");
        if (result?.totalCount) setTotalCount(result.totalCount);

        if (opts.mode === "replace") {
          /* 空响应用旧列表顶着，绝不把本地缓存冲成 0 */
          if (!rows.length) {
            if (!newsLenRef.current) {
              setError("暂无资讯，请稍后重试");
            }
            return;
          }
          const following = Math.max(2, (result?.page ?? 1) + 1);
          const more = Boolean(result?.hasMore);
          setNews((prev) => {
            const next = opts.force
              ? rows.slice(0, MAX_CACHED_ITEMS)
              : softReplaceNews(prev, rows);
            setNextPage(following);
            setHasMore(more);
            persist({
              items: next,
              nextPage: following,
              totalCount: result?.totalCount ?? next.length,
              hasMore: more,
            });
            return next;
          });
        } else {
          if (!rows.length) {
            setHasMore(false);
            return;
          }
          setNews((prev) => {
            const merged = mergeNews(prev, rows);
            const following = Math.max(opts.page + 1, nextPageRef.current);
            const more =
              Boolean(result?.hasMore) && merged.length < MAX_CACHED_ITEMS;
            setNextPage(following);
            setHasMore(more);
            persist({
              items: merged,
              nextPage: following,
              totalCount: result?.totalCount ?? merged.length,
              hasMore: more,
            });
            return merged;
          });
        }
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "资讯加载失败";
        if (opts.mode === "append") {
          setError(message);
        } else if (!newsLenRef.current) {
          setError(message);
        } else {
          setError("更新失败，仍显示本地缓存");
        }
      } finally {
        if (opts.mode === "append") {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [persist],
  );

  useEffect(() => {
    if (!active) return;
    /* 有本地数据 → 静默刷新；没有才亮品牌 loading */
    void loadPage({
      page: 1,
      mode: "replace",
      silent: newsLenRef.current > 0,
    });
    /*
     * 定时只在「还没往下翻」时重置首页，避免用户滚到第 N 页时整表被首页顶掉。
     * 已经翻页过的会话靠手动刷新 / 下次进页再对齐。
     */
    const timer = window.setInterval(() => {
      if (nextPageRef.current > 2) return;
      void loadPage({ page: 1, mode: "replace", silent: true });
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, loadPage]);

  const loadMore = useCallback(() => {
    if (!active || loading || loadingMoreRef.current || !hasMoreRef.current)
      return;
    void loadPage({ page: nextPageRef.current, mode: "append" });
  }, [active, loading, loadPage]);

  const filtered = useMemo(() => {
    return news.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (sentiment !== "all" && item.sentiment !== sentiment) return false;
      return true;
    });
  }, [news, category, sentiment]);

  /*
   * 客户端筛选后列表可能很短，滚不到底就永远不翻页；
   * 筛选项一变就补拉，直到筛出足够行或没有更多。
   */
  useEffect(() => {
    if (!active || loading || loadingMore) return;
    if (!hasMore) return;
    if (filtered.length >= 12) return;
    void loadPage({ page: nextPageRef.current, mode: "append" });
  }, [
    active,
    category,
    sentiment,
    filtered.length,
    hasMore,
    loading,
    loadingMore,
    loadPage,
  ]);

  const counts = useMemo(() => {
    const base = { all: news.length, crypto: 0, equity: 0, exchange: 0 };
    for (const item of news) base[item.category] += 1;
    return base;
  }, [news]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <section className="shrink-0 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5">
              <Newspaper className="w-4 h-4" />
              Gate 快讯
            </h2>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Moments 官方接口 · 本地 {news.length}
              {totalCount ? ` / ${totalCount}` : ""} 条
              {lastUpdated
                ? ` · 缓存于 ${new Date(lastUpdated).toLocaleTimeString()}`
                : ""}
              {" · "}
              滚到底继续加载
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-zinc-100 p-0.5 rounded-xl text-[11px]">
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setCategory(tab.key)}
                  className={`px-2.5 py-1 rounded-lg ${
                    category === tab.key
                      ? "bg-white text-zinc-900 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  {tab.label}
                  <span className="ml-1 font-mono text-[10px] text-zinc-400">
                    {counts[tab.key]}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                void loadPage({
                  page: 1,
                  mode: "replace",
                  force: true,
                  silent: newsLenRef.current > 0,
                })
              }
              disabled={loading}
              className="h-8 px-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 inline-flex items-center gap-1.5 text-[11px] text-zinc-600 disabled:opacity-50"
              title="强制刷新首页"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />
              {lastUpdated
                ? new Date(lastUpdated).toLocaleTimeString()
                : "刷新"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {SENTIMENT_TABS.map((tab) => {
            const on = sentiment === tab.key;
            const tone =
              tab.key === "bull"
                ? on
                  ? "bg-emerald-600 text-white"
                  : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                : tab.key === "bear"
                ? on
                  ? "bg-rose-600 text-white"
                  : "text-rose-700 bg-rose-50 hover:bg-rose-100"
                : on
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 bg-zinc-100 hover:bg-zinc-200/80";
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSentiment(tab.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${tone}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="px-3 py-2 rounded-xl border border-amber-100 bg-amber-50 text-[11px] text-amber-800 flex items-center justify-between gap-2">
            <span className="truncate">{error}</span>
            <button
              type="button"
              onClick={() =>
                void loadPage({
                  page: 1,
                  mode: "replace",
                  force: true,
                  silent: newsLenRef.current > 0,
                })
              }
              className="font-medium shrink-0"
            >
              重试
            </button>
          </div>
        )}
      </section>

      <div className="flex-1 min-h-0">
        {!filtered.length ? (
          <div className="h-full min-h-[240px] rounded-2xl border border-dashed border-zinc-200 bg-white flex flex-col items-center justify-center text-zinc-400 text-xs gap-2 px-4">
            {loading || loadingMore ? (
              <DevToolboxLoader
                size={72}
                title="正在拉取 Gate 快讯…"
                subtitle="首次进入会写入本地缓存，下次先顶旧数据"
              />
            ) : (
              <>
                <Newspaper className="w-5 h-5 opacity-50" />
                {news.length ? "没有符合筛选的资讯" : "暂无资讯"}
              </>
            )}
          </div>
        ) : (
          <div className="h-full rounded-2xl border border-zinc-200/80 bg-white overflow-hidden shadow-xs flex flex-col">
            <VirtualList
              items={filtered}
              rowHeight={88}
              overscan={6}
              className="flex-1 min-h-0 h-full"
              getRowKey={(item) => item.url}
              renderRow={(item) => <NewsRow item={item} />}
              onNearEnd={loadMore}
            />
            <div className="shrink-0 h-8 border-t border-zinc-100 flex items-center justify-center text-[10px] text-zinc-400 bg-zinc-50/60">
              {loadingMore
                ? "加载更多…"
                : hasMore
                ? "继续上滑加载下一页"
                : "已经到底了"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function openNewsUrl(url: string) {
  const href = normalizeNewsUrl(url);
  if (!href) return;
  // Electron 里走主进程 openExternal，比 <a target=_blank> 更稳（不会被应用内导航吞掉）
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

function NewsRow({ item }: { item: NewsItem }) {
  const bull = item.sentiment === "bull";
  const bear = item.sentiment === "bear";
  const categoryLabel =
    item.category === "equity"
      ? "股票"
      : item.category === "exchange"
      ? "交易所"
      : "加密";
  const sentimentLabel = bull ? "利多" : bear ? "利空" : "中性";

  return (
    <button
      type="button"
      onClick={() => openNewsUrl(item.url)}
      className="w-full text-left h-full px-4 flex items-stretch gap-3 border-b border-zinc-100 hover:bg-zinc-50/80 transition-colors group"
    >
      <div
        className={`mt-3.5 w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
          bull
            ? "bg-emerald-50 text-emerald-600"
            : bear
            ? "bg-rose-50 text-rose-600"
            : "bg-zinc-100 text-zinc-500"
        }`}
      >
        {bull ? (
          <TrendingUp className="w-4 h-4" />
        ) : bear ? (
          <TrendingDown className="w-4 h-4" />
        ) : (
          <Newspaper className="w-3.5 h-3.5" />
        )}
      </div>

      <div className="flex-1 min-w-0 py-3">
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <span
            className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-medium ${
              bull
                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                : bear
                ? "bg-rose-50 text-rose-700 border-rose-100"
                : "bg-zinc-50 text-zinc-500 border-zinc-100"
            }`}
          >
            {sentimentLabel}
          </span>
          <span className="inline-flex px-1.5 py-0.5 rounded border border-zinc-100 bg-zinc-50 text-[10px] text-zinc-500">
            {categoryLabel}
          </span>
          <span className="text-[10px] text-zinc-400 truncate">
            {item.source}
          </span>
          <span className="text-[10px] text-zinc-400 ml-auto shrink-0">
            {formatTime(item.publishedAt)}
          </span>
        </div>
        <div className="text-[13px] leading-5 text-zinc-800 group-hover:text-zinc-950 line-clamp-2 font-medium">
          {decodeHtmlEntities(item.title)}
        </div>
      </div>

      <ExternalLink className="w-3.5 h-3.5 text-zinc-300 group-hover:text-zinc-500 shrink-0 mt-4" />
    </button>
  );
}
