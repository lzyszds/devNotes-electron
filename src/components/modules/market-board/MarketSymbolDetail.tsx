import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Newspaper,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  useMarketBoardStore,
  type MarketNewsSnap,
  type MarketQuoteSnap,
  type MarketWatchItem,
} from "../../../store/marketBoardStore";

type CandleInterval = "1h" | "4h" | "1d";

type Props = {
  item: MarketWatchItem;
  quote?: MarketQuoteSnap;
  onBack: () => void;
};

const INTERVALS: { value: CandleInterval; label: string }[] = [
  { value: "1h", label: "1 小时" },
  { value: "4h", label: "4 小时" },
  { value: "1d", label: "日线" },
];

const SYMBOL_NAMES: Record<string, string> = {
  MU: "美光",
  MSFT: "微软",
  SPCX: "SpaceX",
  SNDK: "闪迪",
  TSLA: "特斯拉",
  NVDA: "英伟达",
  AAPL: "苹果",
  AMZN: "亚马逊",
  GOOG: "谷歌",
  GOOGL: "谷歌",
  META: "Meta",
  BTC: "比特币",
  ETH: "以太坊",
  SOL: "Solana",
};

const baseSymbol = (symbol: string) =>
  symbol.replace(/USDT$/i, "").toUpperCase();

const fmt = (n: number, digits = 2) => {
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

function money(n: number | undefined, currency = "USDT"): string {
  if (n == null || !Number.isFinite(n)) return "--";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
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

function formatCompact(value?: number, currency = "USDT") {
  if (value == null || !Number.isFinite(value)) return "--";
  const prefix =
    currency === "USDT" || currency === "USD"
      ? "$"
      : currency === "CNY"
      ? "¥"
      : "";
  const suffix = currency === "HKD" ? " HKD" : "";
  if (value >= 1e9) return `${prefix}${(value / 1e9).toFixed(1)}B${suffix}`;
  if (value >= 1e6) return `${prefix}${(value / 1e6).toFixed(1)}M${suffix}`;
  return `${prefix}${fmt(value, 0)}${suffix}`;
}

/** 市值字段腾讯按「亿元」给，统一成可读文案 */
function formatYiCap(value?: number, currency = "CNY") {
  if (value == null || !Number.isFinite(value) || value <= 0) return "--";
  if (currency === "USD") return `$${fmt(value, 2)} 亿`;
  if (currency === "HKD") return `HK$${fmt(value, 2)} 亿`;
  return `¥${fmt(value, 2)} 亿`;
}

function gateIconUrl(symbol: string): string {
  const lower = (symbol === "XBT" ? "btc" : symbol).toLowerCase();
  return `https://icon.staticimgs.com/images/coin_icon/64/${lower}.png`;
}

function SymbolIcon({
  item,
  size,
}: {
  item: { symbol: string };
  size: number;
}) {
  const symbol = baseSymbol(item.symbol) || item.symbol.toUpperCase();
  const src = gateIconUrl(symbol);
  const [failed, setFailed] = useState(false);
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

function buildChartPath(
  series: number[],
  width: number,
  height: number,
): { line: string; area: string; positive: boolean } {
  if (series.length < 2) return { line: "", area: "", positive: true };
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const padY = 8;
  const eff = height - padY * 2;
  const points = series.map((v, i) => {
    const x = (i / (series.length - 1)) * width;
    const y = height - padY - ((v - min) / range) * eff;
    return { x, y };
  });
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const area = `M ${first.x.toFixed(1)} ${height} L ${points
    .map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" L ")} L ${last.x.toFixed(1)} ${height} Z`;
  const positive = series[series.length - 1]! >= series[0]!;
  return { line, area, positive };
}

function newsKeywords(item: MarketWatchItem): string[] {
  const base = baseSymbol(item.symbol);
  const keys = new Set<string>();
  if (base) keys.add(base.toLowerCase());
  if (item.name) {
    keys.add(item.name.toLowerCase());
    /* 「微软 (Microsoft)」→ 拆出中英文短名，提高标题命中率 */
    for (const part of item.name.split(/[\s(/)、，,]+/)) {
      const t = part.trim().toLowerCase();
      if (t.length >= 2) keys.add(t);
    }
  }
  const mapped = SYMBOL_NAMES[base];
  if (mapped) {
    keys.add(mapped.toLowerCase());
    for (const part of mapped.split(/[\s(/)]+/)) {
      const t = part.trim().toLowerCase();
      if (t.length >= 2) keys.add(t);
    }
  }
  return [...keys];
}

function filterRelatedNews(
  items: MarketNewsSnap[],
  item: MarketWatchItem,
): MarketNewsSnap[] {
  const keys = newsKeywords(item);
  if (!keys.length) return [];
  return items
    .filter((news) => {
      const title = news.title.toLowerCase();
      return keys.some((k) => title.includes(k));
    })
    .slice(0, 8);
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-zinc-50/80 border border-zinc-100 px-3 py-2.5">
      <div className="text-[10px] text-zinc-400">{label}</div>
      <div className="mt-0.5 text-xs font-mono font-semibold tabular-nums text-zinc-900 truncate">
        {value}
      </div>
    </div>
  );
}

/**
 * 看板内全屏详情：大走势图 + 盘口/基本面 + 相关资讯。
 * 状态不持久化；返回由父组件关 detailOpen。
 */
export default function MarketSymbolDetail({ item, quote, onBack }: Props) {
  const [candleInterval, setCandleInterval] = useState<CandleInterval>("1h");
  const [series, setSeries] = useState<number[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const seqRef = useRef(0);
  const newsCache = useMarketBoardStore((s) => s.newsCache);

  const positive = (quote?.changePercent ?? 0) >= 0;
  const currency = quote?.currency ?? "USDT";
  const isContract = item.kind === "contract";
  const isEquity = item.asset === "equity";

  useEffect(() => {
    const seq = ++seqRef.current;
    let cancelled = false;
    setChartLoading(true);
    void (async () => {
      try {
        const result = await window.electronAPI?.marketCandles?.({
          symbol: item.symbol,
          kind: item.kind,
          interval: candleInterval,
        });
        if (cancelled || seq !== seqRef.current) return;
        setSeries(Array.isArray(result) ? result : []);
      } catch {
        if (!cancelled && seq === seqRef.current) setSeries([]);
      } finally {
        if (!cancelled && seq === seqRef.current) setChartLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.symbol, item.kind, candleInterval]);

  const chart = useMemo(
    () => buildChartPath(series, 640, 200),
    [series],
  );

  const relatedNews = useMemo(
    () => filterRelatedNews(newsCache?.items ?? [], item),
    [newsCache?.items, item],
  );

  const openNews = (url: string) => {
    // 旧缓存可能是 /zh/post/news/…（已 404），打开前改到 /zh/news/detail/…
    const href = String(url || "")
      .trim()
      .replace(
        /^https?:\/\/(?:www\.)?gate\.(?:com|io)\/(?:zh\/)?post\/news\//i,
        "https://www.gate.com/zh/news/detail/",
      )
      .replace(
        /^https?:\/\/(?:www\.)?gate\.(?:com|io)\/news\/detail\//i,
        "https://www.gate.com/zh/news/detail/",
      );
    if (!href) return;
    if (window.electronAPI?.openExternal) {
      void window.electronAPI.openExternal(href);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto thin-scrollbar">
      {/* 顶栏：返回 + 标的头 */}
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl border border-zinc-200 bg-white text-xs text-zinc-700 hover:bg-zinc-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回
          </button>
          <SymbolIcon item={item} size={36} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-zinc-900 truncate">
                {item.name || baseSymbol(item.symbol)}
              </h2>
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 font-medium">
                {isContract
                  ? "永续合约"
                  : isEquity
                  ? "股票"
                  : "现货"}
              </span>
            </div>
            <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
              {item.symbol}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`text-xl font-bold font-mono tabular-nums ${
              positive ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {money(quote?.price, currency)}
          </div>
          <div
            className={`mt-0.5 inline-flex items-center gap-1 text-xs font-mono ${
              positive ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {positive ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            {quote
              ? `${positive ? "+" : ""}${fmt(quote.changePercent)}% · ${money(
                  quote.change,
                  currency,
                )}`
              : "--"}
          </div>
        </div>
      </div>

      {/* 大走势图 */}
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-xs font-bold text-zinc-800">价格走势</div>
          <div className="flex items-center gap-1 bg-zinc-100/90 p-0.5 rounded-lg">
            {INTERVALS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCandleInterval(opt.value)}
                className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${
                  candleInterval === opt.value
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative h-[200px] rounded-xl bg-gradient-to-b from-zinc-50/80 to-white border border-zinc-100 overflow-hidden">
          {chart.line ? (
            <svg
              className="w-full h-full"
              viewBox="0 0 640 200"
              preserveAspectRatio="none"
              aria-label={`${item.symbol} ${candleInterval} 走势`}
            >
              <defs>
                <linearGradient id="detail-area" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={chart.positive ? "#10b981" : "#e11d48"}
                    stopOpacity="0.22"
                  />
                  <stop
                    offset="100%"
                    stopColor={chart.positive ? "#10b981" : "#e11d48"}
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              <path d={chart.area} fill="url(#detail-area)" />
              <polyline
                points={chart.line}
                fill="none"
                stroke={chart.positive ? "#10b981" : "#e11d48"}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-400">
              {chartLoading ? "走势加载中…" : "暂无该周期走势数据"}
            </div>
          )}
        </div>
        {series.length >= 2 && (
          <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-zinc-400">
            <span>低 {money(Math.min(...series), currency)}</span>
            <span>
              {series.length} 点 ·{" "}
              {INTERVALS.find((i) => i.value === candleInterval)?.label}
            </span>
            <span>高 {money(Math.max(...series), currency)}</span>
          </div>
        )}
      </section>

      {/* 盘口 */}
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs space-y-3">
        <div className="text-xs font-bold text-zinc-800">盘口摘要</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {isEquity || !isContract ? (
            <>
              <Metric label="今开" value={money(quote?.open, currency)} />
              <Metric label="昨收" value={money(quote?.prevClose, currency)} />
              <Metric label="最高" value={money(quote?.high24h, currency)} />
              <Metric label="最低" value={money(quote?.low24h, currency)} />
              <Metric
                label="成交额"
                value={formatCompact(quote?.turnover24h, currency)}
              />
              <Metric
                label="成交量"
                value={
                  quote?.volume != null && Number.isFinite(quote.volume)
                    ? fmt(quote.volume, 0)
                    : "--"
                }
              />
              <Metric
                label="振幅"
                value={
                  quote?.amplitude != null
                    ? `${fmt(quote.amplitude)}%`
                    : "--"
                }
              />
              <Metric
                label="换手率"
                value={
                  quote?.turnoverRate != null
                    ? `${fmt(quote.turnoverRate)}%`
                    : "--"
                }
              />
            </>
          ) : (
            <>
              <Metric
                label="标记价格"
                value={money(quote?.markPrice, "USDT")}
              />
              <Metric
                label="持仓总量 OI"
                value={formatCompact(quote?.openInterest)}
              />
              <Metric label="最高" value={money(quote?.high24h, currency)} />
              <Metric label="最低" value={money(quote?.low24h, currency)} />
              <Metric
                label="24h 成交额"
                value={formatCompact(quote?.turnover24h)}
              />
              <Metric
                label="资金费率"
                value={
                  quote?.fundingRate != null
                    ? `${quote.fundingRate >= 0 ? "+" : ""}${quote.fundingRate.toFixed(4)}%`
                    : "--"
                }
              />
              <Metric
                label="多头占比"
                value={
                  quote?.longRatio != null
                    ? `${(quote.longRatio * 100).toFixed(1)}%`
                    : "--"
                }
              />
              <Metric
                label="费率周期"
                value={
                  quote?.fundingIntervalHours != null
                    ? `${fmt(quote.fundingIntervalHours, 0)}h`
                    : "--"
                }
              />
            </>
          )}
        </div>
      </section>

      {/* 基本面：仅股票 */}
      {isEquity && (
        <section className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs space-y-3">
          <div className="text-xs font-bold text-zinc-800">基本面</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric
              label="市盈率 PE"
              value={quote?.pe != null ? fmt(quote.pe) : "--"}
            />
            <Metric
              label="市净率 PB"
              value={quote?.pb != null ? fmt(quote.pb) : "--"}
            />
            <Metric
              label="总市值"
              value={formatYiCap(quote?.marketCap, currency)}
            />
            <Metric
              label="流通市值"
              value={formatYiCap(quote?.floatMarketCap, currency)}
            />
          </div>
          <p className="text-[10px] text-zinc-400">
            基本面取自腾讯行情字段，仅供参考；部分美股/港股可能暂无数据。
          </p>
        </section>
      )}

      {/* 相关资讯 */}
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
            <Newspaper className="w-3.5 h-3.5 text-zinc-500" />
            相关资讯
          </div>
          <span className="text-[10px] text-zinc-400">
            按标题关键词从已缓存快讯中匹配
          </span>
        </div>
        {relatedNews.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-8 text-center text-[11px] text-zinc-400">
            暂无与「{item.name || baseSymbol(item.symbol)}」相关的资讯
          </div>
        ) : (
          <ul className="space-y-1.5">
            {relatedNews.map((news) => (
              <li key={news.url}>
                <button
                  type="button"
                  onClick={() => openNews(news.url)}
                  className="w-full text-left group flex items-start gap-2 rounded-xl px-2.5 py-2 hover:bg-zinc-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-zinc-800 group-hover:text-zinc-950 line-clamp-2">
                      {news.title}
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-400 flex items-center gap-2">
                      <span>{news.source}</span>
                      <span className="font-mono">
                        {news.publishedAt
                          ? new Date(news.publishedAt).toLocaleString()
                          : ""}
                      </span>
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-300 group-hover:text-zinc-500 shrink-0 mt-0.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[10px] text-zinc-400 pb-2">
        行情与资讯仅供参考，不构成投资建议。价格预警请在右侧栏设置。
      </p>
    </div>
  );
}
