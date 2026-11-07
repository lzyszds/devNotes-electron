import { useMemo, useEffect, useState, type ReactNode } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { DataTable } from "../../ui/data-table";
import DevToolboxLoader from "../../ui/DevToolboxLoader";
import { catalogDisplayName } from "../../../utils/marketSymbolCatalog";

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

type WatchItem = {
  symbol: string;
  name: string;
  kind: "contract" | "spot";
  asset: Asset;
};

export type GatePositionRow = {
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
};

export type GateSpotBalanceRow = {
  currency: string;
  available: number;
  locked: number;
};

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

const EQUITY_TICKERS =
  /^(MU|MSFT|SPCX|SNDK|TSLA|NVDA|AAPL|AMZN|GOOG|GOOGL|META|INTU|AMD|NFLX|COIN|BABA|PDD|HOOD|PLTR|UBER|ABNB)$/i;

function isEquitySymbol(symbol: string): boolean {
  const base = symbol.replace(/USDT$/i, "").toUpperCase();
  return EQUITY_TICKERS.test(base) || /^(sh|sz|hk)/i.test(symbol);
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

function formatCompact(value?: number, currency = "USDT") {
  return value == null || !Number.isFinite(value)
    ? "--"
    : `${currency === "USDT" || currency === "USD" ? "$" : ""}${
        value >= 1e9
          ? `${(value / 1e9).toFixed(1)}B`
          : value >= 1e6
          ? `${(value / 1e6).toFixed(1)}M`
          : fmt(value, 0)
      }${currency === "CNY" ? " ¥" : currency === "HKD" ? " HKD" : ""}`;
}

const baseSymbol = (symbol: string) =>
  symbol.replace(/USDT$/i, "").toUpperCase();

function gateIconUrl(symbol: string): string {
  const lower = (symbol === "XBT" ? "btc" : symbol).toLowerCase();
  return `https://icon.staticimgs.com/images/coin_icon/64/${lower}.png`;
}

function iconSymbol(raw: string): string {
  const trimmed = raw.trim();
  /* USDT 本身是币种：剥掉 USDT 后缀会变成空串，图标 URL 就废了 */
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

function ChangeBadge({
  quote,
  loading,
}: {
  quote?: Pick<Quote, "changePercent"> | null;
  loading?: boolean;
}) {
  const up = (quote?.changePercent ?? 0) >= 0;
  return (
    <span
      className={`inline-flex items-center justify-end gap-0.5 min-w-[4.75rem] px-2 py-0.5 rounded-lg font-mono tabular-nums font-semibold text-xs ${
        quote
          ? up
            ? "bg-emerald-50 text-emerald-600"
            : "bg-rose-50 text-rose-600"
          : "text-zinc-400"
      }`}
    >
      <span className="w-3 h-3 inline-flex items-center justify-center">
        {quote ? (
          up ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )
        ) : null}
      </span>
      {quote
        ? `${up ? "+" : ""}${fmt(quote.changePercent)}%`
        : loading
        ? "…"
        : "--"}
    </span>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
  children,
}: {
  icon?: "star" | "brand";
  /** 品牌 loading 主文案；有则盖过 children 当 title */
  title?: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  if (icon === "brand") {
    return (
      <div className="py-10 flex flex-col items-center justify-center">
        <DevToolboxLoader
          size={72}
          title={title || (typeof children === "string" ? children : "加载中…")}
          subtitle={subtitle || ""}
        />
      </div>
    );
  }
  return (
    <div className="py-8 text-center text-xs text-zinc-400">
      <Star className="w-5 h-5 mx-auto mb-2 opacity-50" />
      {children}
    </div>
  );
}

/* ---------- 热门永续 ---------- */

export function HotQuotesDataTable({
  data,
  loading,
  loadingMore,
  hasMore,
  total,
  watchlist,
  onAdd,
  onNearEnd,
}: {
  data: Quote[];
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  total?: number;
  watchlist: WatchItem[];
  onAdd: (
    base: string,
    preset: { base: string; name: string; asset: Asset },
  ) => void;
  onNearEnd?: () => void;
}) {
  const columns = useMemo<ColumnDef<Quote>[]>(
    () => [
      {
        id: "symbol",
        accessorKey: "symbol",
        header: () => <span className="pl-2">标的</span>,
        size: 220,
        cell: ({ row }) => {
          const quote = row.original;
          const base = baseSymbol(quote.symbol);
          return (
            <div className="flex items-center gap-2.5 min-h-[30px] pl-2">
              <SymbolIcon
                item={{ symbol: quote.symbol, asset: quote.asset }}
                size={28}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-zinc-900 truncate">
                    {quote.name || catalogDisplayName(base) || base}
                  </span>
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 leading-none">
                    {quote.asset === "equity" ? "美股合成" : "加密"}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                  {quote.symbol}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "price",
        header: () => <span className="w-full text-right">最新价</span>,
        size: 110,
        cell: ({ row }) => (
          <div className="w-full text-right font-mono tabular-nums font-semibold text-zinc-900">
            {money(row.original.price, row.original.currency)}
          </div>
        ),
      },
      {
        id: "change",
        header: () => <span className="w-full text-right">24h 涨跌</span>,
        size: 110,
        cell: ({ row }) => (
          <div className="w-full flex justify-end">
            <ChangeBadge quote={row.original} />
          </div>
        ),
      },
      {
        id: "turnover",
        header: () => <span className="w-full text-right">成交额</span>,
        size: 110,
        cell: ({ row }) => (
          <div className="w-full text-right font-mono tabular-nums text-zinc-700">
            {formatCompact(row.original.turnover24h, row.original.currency)}
          </div>
        ),
      },
      {
        id: "funding",
        header: () => <span className="w-full text-right">资金费率</span>,
        size: 100,
        cell: ({ row }) => {
          const rate = row.original.fundingRate;
          return (
            <div
              className={`w-full text-right font-mono tabular-nums ${
                (rate ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {rate != null
                ? `${rate >= 0 ? "+" : ""}${rate.toFixed(4)}%`
                : "--"}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="w-full text-right pr-2">操作</span>,
        size: 100,
        cell: ({ row }) => {
          const quote = row.original;
          const base = baseSymbol(quote.symbol);
          const inWatch = watchlist.some(
            (w) =>
              w.kind === "contract" &&
              w.symbol.toUpperCase() === quote.symbol.toUpperCase(),
          );
          return (
            <div className="w-full flex justify-end pr-2">
              <button
                type="button"
                disabled={inWatch}
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(base, {
                    base,
                    name: quote.name || catalogDisplayName(base) || base,
                    asset: quote.asset,
                  });
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium ${
                  inWatch
                    ? "bg-zinc-100 text-zinc-400 cursor-default"
                    : "bg-zinc-900 text-white hover:bg-zinc-800"
                }`}
              >
                <Plus className="w-3 h-3" />
                {inWatch ? "已自选" : "加自选"}
              </button>
            </div>
          );
        },
      },
    ],
    [onAdd, watchlist],
  );

  return (
    <div className="flex flex-col min-h-0">
      <DataTable
        columns={columns}
        data={data}
        getRowId={(row) => row.symbol}
        estimateRowHeight={56}
        minWidth={720}
        maxHeight="min(560px, 62vh)"
        onNearEnd={onNearEnd}
        empty={
          loading ? (
            <EmptyState
              icon="brand"
              title="正在拉取 Gate 行情…"
              subtitle="热门合约列表加载中"
            />
          ) : (
            <EmptyState icon="star">暂无行情，请稍后重试</EmptyState>
          )
        }
      />
      {data.length > 0 && (
        <div className="shrink-0 h-8 border-t border-zinc-100 flex items-center justify-center text-[10px] text-zinc-400 bg-zinc-50/60">
          {loadingMore
            ? "加载更多…"
            : hasMore
            ? `已显示 ${data.length}${total ? ` / ${total}` : ""} · 继续上滑`
            : `共 ${total ?? data.length} 个 · 已经到底`}
        </div>
      )}
    </div>
  );
}

/* ---------- 持仓 ---------- */

export function PositionsDataTable({
  data,
  loading,
  errorText,
  selectedSymbol,
  onSelect,
}: {
  data: GatePositionRow[] | null;
  loading: boolean;
  errorText?: string;
  selectedSymbol: string;
  onSelect: (contract: string) => void;
}) {
  const rows = data ?? [];
  const columns = useMemo<ColumnDef<GatePositionRow>[]>(
    () => [
      {
        id: "asset",
        header: () => <span className="pl-2">标的资产</span>,
        size: 220,
        cell: ({ row }) => {
          const pos = row.original;
          const stockName = SYMBOL_NAMES[pos.symbol] ?? pos.symbol;
          const isSelected =
            selectedSymbol === pos.contract ||
            selectedSymbol === pos.symbol ||
            selectedSymbol === pos.contract.replace("_", "");
          return (
            <div className="relative flex items-center gap-2.5 min-h-[30px] pl-2">
              <span
                className={`absolute left-0 top-1 bottom-1 w-1 rounded-r bg-zinc-900 transition-opacity ${
                  isSelected ? "opacity-100" : "opacity-0"
                }`}
              />
              <SymbolIcon
                item={{
                  symbol: pos.symbol,
                  asset: isEquitySymbol(pos.symbol) ? "equity" : "crypto",
                }}
                size={30}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-zinc-900 text-xs truncate">
                    {stockName}
                  </span>
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-medium leading-none">
                    {isEquitySymbol(pos.symbol) ? "美股合成" : "合约"}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                  {pos.contract}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "side",
        header: () => <span className="w-full text-center">方向/杠杆</span>,
        size: 110,
        cell: ({ row }) => {
          const isShort = row.original.side === "short";
          return (
            <div className="w-full flex justify-center">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold text-[10px] border ${
                  isShort
                    ? "bg-rose-50 text-rose-600 border-rose-100"
                    : "bg-emerald-50 text-emerald-600 border-emerald-100"
                }`}
              >
                {isShort ? "做空" : "做多"} {row.original.leverage}x
              </span>
            </div>
          );
        },
      },
      {
        id: "cost",
        header: () => <span className="w-full text-right">开仓成本/现价</span>,
        size: 130,
        cell: ({ row }) => (
          <div className="w-full text-right font-mono tabular-nums">
            <div className="text-zinc-700 text-[10px]">
              成本 {money(row.original.entryPrice, "USDT")}
            </div>
            <div className="text-[10px] text-zinc-400 mt-0.5">
              现价 {money(row.original.markPrice, "USDT")}
            </div>
          </div>
        ),
      },
      {
        id: "pnl",
        header: () => <span className="w-full text-right">收益率</span>,
        size: 110,
        cell: ({ row }) => {
          const isPnlPositive = row.original.unrealisedPnl >= 0;
          return (
            <div className="w-full text-right font-mono tabular-nums">
              <div
                className={`font-bold text-xs ${
                  isPnlPositive ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {money(row.original.unrealisedPnl, "USDT", true)}
              </div>
              <div
                className={`text-[11px] font-semibold mt-0.5 ${
                  isPnlPositive ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {isPnlPositive ? "+" : ""}
                {row.original.pnlPercent.toFixed(2)}%
              </div>
            </div>
          );
        },
      },
      {
        id: "liq",
        header: () => <span className="w-full text-right">强平参考价</span>,
        size: 120,
        cell: ({ row }) => (
          <div className="w-full text-right font-mono tabular-nums">
            <div className="text-zinc-700 text-xs">
              {row.original.liqPrice > 0
                ? money(row.original.liqPrice, "USDT")
                : "无强平风险"}
            </div>
            <div className="text-[10px] text-zinc-400 mt-0.5">
              保证金 {money(row.original.margin, "USDT")}
            </div>
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <span className="w-full text-right pr-2">操作</span>,
        size: 100,
        cell: ({ row }) => {
          const pos = row.original;
          const isSelected =
            selectedSymbol === pos.contract ||
            selectedSymbol === pos.symbol ||
            selectedSymbol === pos.contract.replace("_", "");
          return (
            <div className="w-full flex justify-end pr-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(pos.contract);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all inline-flex items-center gap-1 ${
                  isSelected
                    ? "bg-zinc-900 text-white shadow-xs"
                    : "border border-zinc-200 text-zinc-600 hover:bg-zinc-900 hover:text-white hover:border-zinc-900"
                }`}
              >
                <Eye className="w-3 h-3" />
                {isSelected ? "盯盘中" : "盯盘"}
              </button>
            </div>
          );
        },
      },
    ],
    [onSelect, selectedSymbol],
  );

  const empty =
    data == null ? (
      loading ? (
        <EmptyState
          icon="brand"
          title="持仓加载中…"
          subtitle="正在拉取 Gate 合约账户"
        />
      ) : (
        <EmptyState icon="star">
          {`持仓数据不可用：${errorText || "请重试"}`}
        </EmptyState>
      )
    ) : (
      <EmptyState icon="star">当前账户暂无活跃持仓</EmptyState>
    );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.contract}
      estimateRowHeight={56}
      minWidth={760}
      maxHeight="min(480px, 50vh)"
      empty={empty}
      onRowClick={(pos) => onSelect(pos.contract)}
      rowClassName={(pos) => {
        const isSelected =
          selectedSymbol === pos.contract ||
          selectedSymbol === pos.symbol ||
          selectedSymbol === pos.contract.replace("_", "");
        return isSelected ? "bg-zinc-100/70 hover:bg-zinc-100/90" : undefined;
      }}
    />
  );
}

/* ---------- 现货钱包 ---------- */

export function SpotBalancesDataTable({
  data,
}: {
  data: GateSpotBalanceRow[];
}) {
  const columns = useMemo<ColumnDef<GateSpotBalanceRow>[]>(
    () => [
      {
        id: "currency",
        header: () => <span className="pl-2">币种</span>,
        size: 160,
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5 pl-2 min-h-[28px]">
            <SymbolIcon
              item={{ symbol: row.original.currency, asset: "crypto" }}
              size={26}
            />
            <span className="font-bold text-zinc-900 text-xs">
              {row.original.currency}
            </span>
          </div>
        ),
      },
      {
        id: "available",
        header: () => <span className="w-full text-right">可用</span>,
        size: 140,
        cell: ({ row }) => (
          <div className="w-full text-right font-mono tabular-nums text-xs text-zinc-800">
            {row.original.available.toLocaleString(undefined, {
              maximumFractionDigits: 8,
            })}
          </div>
        ),
      },
      {
        id: "locked",
        header: () => <span className="w-full text-right pr-2">冻结</span>,
        size: 140,
        cell: ({ row }) => (
          <div className="w-full text-right font-mono tabular-nums text-xs text-zinc-500 pr-2">
            {row.original.locked.toLocaleString(undefined, {
              maximumFractionDigits: 8,
            })}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      getRowId={(row) => row.currency}
      estimateRowHeight={48}
      minWidth={440}
      maxHeight="min(280px, 36vh)"
      empty={<EmptyState>现货钱包暂无可展示的资产</EmptyState>}
    />
  );
}

/* ---------- 自选列表 ---------- */

export type WatchRow = {
  item: WatchItem;
  quote?: Quote;
  points: string;
  selected: boolean;
};

export function WatchlistDataTable({
  rows,
  market,
  loading,
  hasLoaded,
  emptyHint,
  countdown,
  onSelect,
  onOpenDetail,
  onRemove,
}: {
  rows: WatchRow[];
  market: "contract" | "spot";
  loading: boolean;
  hasLoaded: boolean;
  emptyHint: string;
  countdown: (timestamp?: number) => string;
  onSelect: (symbol: string) => void;
  /** 双击行打开看板内全屏详情 */
  onOpenDetail?: (symbol: string) => void;
  onRemove: (item: WatchItem) => void;
}) {
  const columns = useMemo<ColumnDef<WatchRow>[]>(() => {
    const cols: ColumnDef<WatchRow>[] = [
      {
        id: "symbol",
        header: () => <span className="pl-2">标的 / 市场</span>,
        size: 200,
        cell: ({ row }) => {
          const { item, selected } = row.original;
          return (
            <div className="relative flex items-center gap-2.5 min-h-[30px] pl-2">
              <span
                className={`absolute left-0 top-1 bottom-1 w-1 rounded-r bg-zinc-900 transition-opacity ${
                  selected ? "opacity-100" : "opacity-0"
                }`}
              />
              <SymbolIcon item={item} size={30} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-zinc-900 text-xs truncate">
                    {item.asset === "equity" && item.symbol.length < 8
                      ? item.name
                      : baseSymbol(item.symbol)}
                  </span>
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 font-medium leading-none">
                    {market === "contract"
                      ? "合约"
                      : item.asset === "crypto"
                      ? "加密"
                      : "股票"}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-zinc-400 mt-0.5 truncate">
                  {item.symbol}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "price",
        header: () => <span className="w-full text-right">最新价</span>,
        size: 110,
        cell: ({ row }) => {
          const { quote } = row.original;
          return (
            <div className="w-full text-right font-mono tabular-nums font-bold text-xs text-zinc-900 min-w-[5.5rem]">
              {quote
                ? money(quote.price, quote.currency)
                : loading
                ? "…"
                : "--"}
            </div>
          );
        },
      },
      {
        id: "change",
        header: () => <span className="w-full text-right">24h 涨跌</span>,
        size: 110,
        cell: ({ row }) => (
          <div className="w-full flex justify-end">
            <ChangeBadge quote={row.original.quote} loading={loading} />
          </div>
        ),
      },
      {
        id: "spark",
        header: () => <span className="w-full text-right pr-1">24h 走势</span>,
        size: 120,
        cell: ({ row }) => {
          const { points, quote } = row.original;
          const up = (quote?.changePercent ?? 0) >= 0;
          return (
            <div className="w-full flex justify-end pr-1">
              <svg
                className="w-24 h-7 overflow-visible"
                viewBox="0 0 96 26"
                aria-label="24小时价格走势"
              >
                {points ? (
                  <polyline
                    points={points}
                    fill="none"
                    stroke={up ? "#10b981" : "#f43f5e"}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <line
                    x1="0"
                    y1="13"
                    x2="96"
                    y2="13"
                    stroke="#e4e4e7"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                )}
              </svg>
            </div>
          );
        },
      },
    ];

    if (market === "contract") {
      cols.push({
        id: "funding",
        header: () => (
          <span className="w-full text-right">资金费率 / 倒计时</span>
        ),
        size: 130,
        cell: ({ row }) => {
          const quote = row.original.quote;
          return (
            <div className="w-full text-right font-mono tabular-nums">
              <div
                className={`font-medium text-xs ${
                  (quote?.fundingRate ?? 0) >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }`}
              >
                {quote?.fundingRate != null
                  ? `${
                      quote.fundingRate >= 0 ? "+" : ""
                    }${quote.fundingRate.toFixed(4)}%`
                  : "--"}
              </div>
              <div className="text-[10px] text-zinc-400">
                {quote?.nextFundingTime
                  ? `${countdown(quote.nextFundingTime)} 后结算`
                  : "--"}
              </div>
            </div>
          );
        },
      });
    }

    cols.push(
      {
        id: "volume",
        header: () => (
          <span className="w-full text-right pr-2">
            {market === "contract" ? "持仓价值 (OI)" : "成交额"}
          </span>
        ),
        size: 120,
        cell: ({ row }) => {
          const quote = row.original.quote;
          return (
            <div className="w-full text-right pr-2 font-mono tabular-nums">
              <div className="font-semibold text-zinc-800 text-xs">
                {market === "contract"
                  ? formatCompact(quote?.openInterest)
                  : formatCompact(quote?.turnover24h, quote?.currency)}
              </div>
              <div className="text-[10px] text-zinc-400">
                {market === "contract"
                  ? `24h 额 ${formatCompact(quote?.turnover24h)}`
                  : quote?.turnover24h != null
                  ? "真实成交额"
                  : "行情源暂无数据"}
              </div>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">操作</span>,
        size: 48,
        cell: ({ row }) => (
          <div className="w-full flex justify-end pr-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(row.original.item);
              }}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
              title="移出自选"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
      },
    );

    return cols;
  }, [countdown, loading, market, onRemove]);

  return (
    <DataTable
    className="flex-1"
      columns={columns}
      data={!hasLoaded && loading ? [] : rows}
      getRowId={(row) => `${row.item.kind}:${row.item.symbol}`}
      estimateRowHeight={56}
      minWidth={market === "contract" ? 840 : 720}
      maxHeight="100%"
      empty={
        !hasLoaded && loading ? (
          <EmptyState
            icon="brand"
            title="正在连接行情源…"
            subtitle="先顶缓存，再静默刷新最新报价"
          />
        ) : (
          <EmptyState icon="star">{emptyHint}</EmptyState>
        )
      }
      onRowClick={(row) => onSelect(row.item.symbol)}
      onRowDoubleClick={
        onOpenDetail
          ? (row) => {
              onSelect(row.item.symbol);
              onOpenDetail(row.item.symbol);
            }
          : undefined
      }
      rowClassName={(row) =>
        row.selected ? "group bg-zinc-100/70 hover:bg-zinc-100/90" : "group"
      }
    />
  );
}
