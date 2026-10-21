import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Eraser, FileWarning, Play, Square } from "lucide-react";
import {
  CopyButton,
  META,
  Segmented,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolEmpty,
  ToolNotice,
  ToolShell,
  ToolTag,
  type SegmentOption,
} from "../ui";

type Mode = "icmp" | "tcp" | "http";

interface Sample {
  id: number;
  ok: boolean;
  /** ICMP / TCP 为往返或连接耗时；HTTP 为首字节时间 */
  ms: number | null;
  ttl?: number | null;
  dnsMs?: number | null;
  status?: number | null;
  error?: string;
  at: number;
}

const MODE_OPTIONS: SegmentOption<Mode>[] = [
  { value: "icmp", label: "ICMP Ping" },
  { value: "tcp", label: "TCP 端口" },
  { value: "http", label: "HTTP(S)" },
];

const PRESETS: Record<Mode, string[]> = {
  icmp: ["223.5.5.5", "114.114.114.114", "8.8.8.8", "github.com"],
  tcp: ["github.com:443", "www.baidu.com:443", "localhost:3000"],
  http: [
    "https://www.baidu.com",
    "https://github.com",
    "https://www.google.com",
  ],
};

/** 窗口里最多保留的样本数，超出后丢最旧的 */
const MAX_SAMPLES = 300;
/** 曲线上画最近多少个点 */
const CURVE_POINTS = 60;

function fmtMs(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return value < 10 ? `${value.toFixed(2)} ms` : `${value.toFixed(1)} ms`;
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

type Target =
  | { kind: "icmp"; host: string }
  | { kind: "tcp"; host: string; port: number }
  | { kind: "http"; url: string };

/** 解析输入；HTTP 模式下没写协议的补 https://，TCP 的 host:port 在 port 框里取端口 */
function parseTarget(
  mode: Mode,
  raw: string,
  port: string,
): Target | { error: string } {
  const value = raw.trim();
  if (!value) return { error: "请输入目标地址" };
  if (mode === "http") {
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return { kind: "http", url };
  }
  if (mode === "tcp") {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535)
      return { error: "端口需在 1–65535 之间" };
    return { kind: "tcp", host: value.replace(/:\d+$/, ""), port: n };
  }
  return { kind: "icmp", host: value };
}

/** 根据统计给一句人话诊断 */
function diagnose(
  mode: Mode,
  samples: Sample[],
): { tone: "emerald" | "amber" | "rose"; text: string } | null {
  if (samples.length === 0) return null;
  const sent = samples.length;
  const ok = samples.filter((s) => s.ok);
  if (ok.length === 0) {
    return {
      tone: "rose",
      text:
        mode === "icmp"
          ? "所有包都没有回应：目标不在线、禁了 ping，或网络不通。可以试试 TCP 端口模式。"
          : "全部失败：目标端口没开放、服务挂了，或被防火墙拦住了。",
    };
  }
  const loss = ((sent - ok.length) / sent) * 100;
  const values = ok.map((s) => s.ms ?? 0);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (loss >= 10)
    return {
      tone: "rose",
      text: `丢包 ${loss.toFixed(1)}%，链路不稳定，明显影响使用。`,
    };
  if (avg >= 200)
    return {
      tone: "amber",
      text: `平均延迟 ${avg.toFixed(0)} ms 偏高，网络距离远或线路拥堵。`,
    };
  if (loss > 0)
    return {
      tone: "amber",
      text: `有少量丢包（${loss.toFixed(1)}%），整体可用。`,
    };
  return { tone: "emerald", text: `全部响应正常，平均 ${avg.toFixed(1)} ms。` };
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "emerald" | "rose" | "amber";
}) {
  const color = {
    neutral: "text-slate-800 dark:text-white",
    emerald: "text-emerald-600 dark:text-emerald-400",
    rose: "text-rose-600 dark:text-rose-400",
    amber: "text-amber-600 dark:text-amber-400",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3.5 py-2.5 dark:border-dark-border dark:bg-dark-panel">
      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={`mt-0.5 font-mono text-[17px] font-bold tabular-nums leading-tight ${color}`}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500">
          {sub}
        </p>
      )}
    </div>
  );
}

/** 延迟曲线：超时画成底部的红点，正常值按最大值等比缩放 */
function Curve({ samples }: { samples: Sample[] }) {
  const points = samples.slice(-CURVE_POINTS);
  const W = 600;
  const H = 120;
  const max = Math.max(10, ...points.map((s) => s.ms ?? 0));
  const step = points.length > 1 ? W / (CURVE_POINTS - 1) : 0;
  const xOf = (i: number) => (CURVE_POINTS - points.length + i) * step;
  const yOf = (ms: number) => H - 6 - (ms / max) * (H - 14);

  const okPoints = points
    .map((s, i) => (s.ok && s.ms !== null ? `${xOf(i)},${yOf(s.ms)}` : null))
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 dark:border-dark-border dark:bg-dark-bg/40">
      <div className="mb-1 flex items-center justify-between text-[10.5px] text-slate-400 dark:text-slate-500">
        <span>延迟曲线（最近 {CURVE_POINTS} 次）</span>
        <span className="font-mono tabular-nums">峰值 {fmtMs(max)}</span>
      </div>
      {points.length === 0 ? (
        <div className="flex h-[90px] items-center justify-center text-[11px] text-slate-300 dark:text-slate-600">
          开始探测后这里会画出延迟变化
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[90px] w-full"
          preserveAspectRatio="none"
        >
          <line
            x1="0"
            x2={W}
            y1={H - 6}
            y2={H - 6}
            className="stroke-slate-200 dark:stroke-dark-border"
            strokeWidth="1"
          />
          {okPoints && (
            <polyline
              points={okPoints}
              fill="none"
              strokeWidth="2"
              strokeLinejoin="round"
              className="stroke-brand-500"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.map((s, i) =>
            s.ok && s.ms !== null ? (
              <circle
                key={s.id}
                cx={xOf(i)}
                cy={yOf(s.ms)}
                r="2.5"
                className="fill-brand-500"
              />
            ) : (
              <circle
                key={s.id}
                cx={xOf(i)}
                cy={H - 6}
                r="3"
                className="fill-rose-500"
              />
            ),
          )}
        </svg>
      )}
    </div>
  );
}

export default function NetProbeTool() {
  const api = window.electronAPI;
  const available = !!api?.netPingStart;

  const [mode, setMode] = useState<Mode>("icmp");
  const [target, setTarget] = useState("8.8.8.8");
  const [port, setPort] = useState("443");
  const [count, setCount] = useState("20");
  const [intervalSec, setIntervalSec] = useState("1");
  const [timeoutSec, setTimeoutSec] = useState("2");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const nextIdRef = useRef(0);
  /** 当前这一轮探测的 ICMP 进程 id（TCP / HTTP 不用） */
  const pingIdRef = useRef<number | null>(null);
  /** 当前这一轮是否还要继续（TCP / HTTP 循环用） */
  const runningRef = useRef(false);
  const pauseRef = useRef<{ timer: number; resolve: () => void } | null>(null);

  const addSample = (sample: Omit<Sample, "id" | "at">) => {
    nextIdRef.current += 1;
    const full: Sample = { ...sample, id: nextIdRef.current, at: Date.now() };
    setSamples((prev) => {
      const next = [...prev, full];
      return next.length > MAX_SAMPLES
        ? next.slice(next.length - MAX_SAMPLES)
        : next;
    });
  };

  /** 可被打断的等待：点停止时立刻返回，不用等完整个间隔 */
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        pauseRef.current = null;
        resolve();
      }, ms);
      pauseRef.current = { timer, resolve };
    });

  // ICMP 的逐包结果由主进程推送过来
  useEffect(() => {
    if (!available || !api?.onNetPingEvent) return;
    return api.onNetPingEvent((event) => {
      if (event.id !== pingIdRef.current) return;
      if (event.kind === "reply")
        addSample({ ok: true, ms: event.ms, ttl: event.ttl });
      else if (event.kind === "timeout")
        addSample({ ok: false, ms: null, error: "超时" });
      else if (event.kind === "error") setError(event.message);
      else if (event.kind === "done") {
        pingIdRef.current = null;
        setRunning(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  // 离开工具时停掉还在跑的探测
  useEffect(
    () => () => {
      runningRef.current = false;
      if (pauseRef.current) {
        window.clearTimeout(pauseRef.current.timer);
        pauseRef.current.resolve();
      }
      if (pingIdRef.current !== null)
        void api?.netPingStop?.(pingIdRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const stop = () => {
    runningRef.current = false;
    if (pauseRef.current) {
      window.clearTimeout(pauseRef.current.timer);
      pauseRef.current.resolve();
      pauseRef.current = null;
    }
    if (pingIdRef.current !== null) {
      void api?.netPingStop?.(pingIdRef.current);
      pingIdRef.current = null;
    }
    setRunning(false);
  };

  const start = async () => {
    if (!api) return;
    setError("");
    const parsed = parseTarget(mode, target, port);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const total = Math.min(200, Math.max(1, Math.round(Number(count) || 1)));
    const gap = Math.min(10, Math.max(0.2, Number(intervalSec) || 1));
    const timeout = Math.min(10, Math.max(0.5, Number(timeoutSec) || 2));

    setSamples([]);
    setRunning(true);

    if (parsed.kind === "icmp") {
      try {
        const host = parsed.host;
        const started = await api.netPingStart!({
          host,
          count: total,
          intervalSec: gap,
          timeoutSec: timeout,
          size: 56,
        });
        pingIdRef.current = started.id;
      } catch (err) {
        setRunning(false);
        setError(err instanceof Error ? err.message : "启动失败");
      }
      return;
    }

    // TCP / HTTP：逐次探测，每次之间按间隔等待
    runningRef.current = true;
    for (let i = 0; i < total && runningRef.current; i += 1) {
      if (parsed.kind === "tcp") {
        const result = await api.netTcpProbe!({
          host: parsed.host,
          port: parsed.port,
          timeoutMs: timeout * 1000,
        });
        addSample({ ok: result.ok, ms: result.ms, error: result.error });
      } else if (parsed.kind === "http") {
        const result = await api.netHttpProbe!({
          url: parsed.url,
          timeoutMs: timeout * 1000,
        });
        addSample({
          ok: result.ok,
          ms: result.ttfbMs,
          dnsMs: result.dnsMs,
          status: result.status,
          error:
            result.error ??
            (result.status !== null && result.status >= 500
              ? `HTTP ${result.status}`
              : undefined),
        });
      }
      if (i < total - 1 && runningRef.current) await pause(gap * 1000);
    }
    runningRef.current = false;
    setRunning(false);
  };

  /* ---------------- 统计 ---------------- */

  const stats = useMemo(() => {
    const sent = samples.length;
    const okSamples = samples.filter((s) => s.ok);
    const received = okSamples.length;
    const loss = sent ? ((sent - received) / sent) * 100 : 0;
    const values = okSamples.map((s) => s.ms ?? 0);
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    const avg = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
    // 抖动：相邻成功样本延迟差的平均值
    let jitter: number | null = null;
    if (values.length > 1) {
      let sum = 0;
      for (let i = 1; i < values.length; i += 1)
        sum += Math.abs(values[i] - values[i - 1]);
      jitter = sum / (values.length - 1);
    }
    const dnsValues = samples
      .map((s) => s.dnsMs)
      .filter((v): v is number => typeof v === "number");
    const dnsAvg = dnsValues.length
      ? dnsValues.reduce((a, b) => a + b, 0) / dnsValues.length
      : null;
    return { sent, received, loss, min, max, avg, jitter, dnsAvg };
  }, [samples]);

  const verdict = useMemo(() => diagnose(mode, samples), [mode, samples]);

  const report = useMemo(() => {
    if (samples.length === 0) return "";
    const head =
      mode === "icmp"
        ? `ICMP Ping ${target.trim()}`
        : mode === "tcp"
        ? `TCP ${target.trim()}:${port}`
        : `HTTP ${target.trim()}`;
    const lines = [
      head,
      `发送 ${stats.sent}，成功 ${stats.received}，丢包 ${stats.loss.toFixed(
        1,
      )}%`,
      stats.avg !== null
        ? `延迟 最小 ${fmtMs(stats.min)} / 平均 ${fmtMs(
            stats.avg,
          )} / 最大 ${fmtMs(stats.max)} / 抖动 ${fmtMs(stats.jitter)}`
        : "延迟：无成功样本",
    ];
    if (mode === "http" && stats.dnsAvg !== null)
      lines.push(`DNS 平均 ${fmtMs(stats.dnsAvg)}`);
    if (verdict) lines.push(`结论：${verdict.text}`);
    return lines.join("\n");
  }, [samples, stats, mode, target, port, verdict]);

  const recent = useMemo(() => [...samples].reverse().slice(0, 200), [samples]);

  if (!available) {
    return (
      <ToolShell icon={Activity} title="网络探测" subtitle="仅桌面版可用">
        <ToolNotice tone="info" icon={FileWarning}>
          网络探测需要运行在 devNotes 桌面版中，网页版无法发起 ping 和端口探测。
        </ToolNotice>
      </ToolShell>
    );
  }

  const isHttp = mode === "http";

  return (
    <ToolShell
      icon={Activity}
      title="网络探测"
      subtitle="Ping、TCP 端口、HTTP(S) 三种方式，看清延迟、丢包，并判断卡在哪一层"
      badge={running ? <ToolBadge tone="emerald">探测中</ToolBadge> : undefined}
    >
      <div className="tool-cascade grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] h-full">
        {/* 左：目标与参数 */}
        <ToolCard fill={false}>
          <ToolCardHeader title="探测目标" icon={Activity} />
          <div className="flex flex-col gap-4 p-4">
            <Segmented
              value={mode}
              options={MODE_OPTIONS}
              onChange={(next) => {
                setMode(next);
                setTarget(PRESETS[next][0].replace(/:\d+$/, ""));
                setSamples([]);
              }}
            />

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {isHttp ? "网址" : "域名或 IP"}
              </span>
              <div className="flex items-center gap-2">
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={running}
                  spellCheck={false}
                  placeholder={
                    isHttp ? "https://example.com" : "8.8.8.8 或 example.com"
                  }
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[12.5px] text-slate-800 outline-none focus:border-brand-500 disabled:opacity-60 dark:border-dark-border dark:bg-dark-panel dark:text-slate-100"
                />
                {mode === "tcp" && (
                  <input
                    value={port}
                    onChange={(e) =>
                      setPort(e.target.value.replace(/\D/g, "").slice(0, 5))
                    }
                    disabled={running}
                    placeholder="端口"
                    className="w-20 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[12.5px] text-slate-800 outline-none focus:border-brand-500 disabled:opacity-60 dark:border-dark-border dark:bg-dark-panel dark:text-slate-100"
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {PRESETS[mode].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={running}
                    onClick={() => {
                      const [host, p] = preset.split(":");
                      setTarget(host);
                      if (mode === "tcp" && p) setPort(p);
                    }}
                    className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10.5px] text-slate-600 hover:bg-brand-50 hover:text-brand-600 disabled:opacity-40 dark:bg-dark-hover dark:text-slate-300 dark:hover:bg-brand-500/10 dark:hover:text-brand-400"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">
                  次数
                </span>
                <input
                  value={count}
                  onChange={(e) =>
                    setCount(e.target.value.replace(/\D/g, "").slice(0, 3))
                  }
                  disabled={running}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[12.5px] tabular-nums outline-none focus:border-brand-500 disabled:opacity-60 dark:border-dark-border dark:bg-dark-panel dark:text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">
                  间隔 s
                </span>
                <input
                  value={intervalSec}
                  onChange={(e) =>
                    setIntervalSec(
                      e.target.value.replace(/[^\d.]/g, "").slice(0, 4),
                    )
                  }
                  disabled={running}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[12.5px] tabular-nums outline-none focus:border-brand-500 disabled:opacity-60 dark:border-dark-border dark:bg-dark-panel dark:text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">
                  超时 s
                </span>
                <input
                  value={timeoutSec}
                  onChange={(e) =>
                    setTimeoutSec(
                      e.target.value.replace(/[^\d.]/g, "").slice(0, 4),
                    )
                  }
                  disabled={running}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[12.5px] tabular-nums outline-none focus:border-brand-500 disabled:opacity-60 dark:border-dark-border dark:bg-dark-panel dark:text-slate-100"
                />
              </label>
            </div>

            {error && (
              <ToolNotice tone="error" icon={FileWarning}>
                {error}
              </ToolNotice>
            )}

            {running ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-rose-600 text-[13px] font-semibold text-white shadow-sm hover:bg-rose-700"
              >
                <Square size={14} />
                停止探测
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void start()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-[13px] font-semibold text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700"
              >
                <Play size={14} />
                开始探测
              </button>
            )}

            <p className={`${META} leading-relaxed`}>
              ICMP 需要目标允许 ping；很多服务器和防火墙会禁用它，这时请改用 TCP
              端口或 HTTP(S) 模式。
            </p>
          </div>
        </ToolCard>

        {/* 右：结果 */}
        <div className="flex min-w-0 flex-col gap-4 h-[405px] flex-1">
          {samples.length === 0 ? (
            <ToolCard fill={false} className="flex-1 h-full">
              <ToolEmpty
                icon={Activity}
                title="还没有探测结果"
                hint="在左侧选择方式、填写目标后开始探测"
                className="min-h-[360px]"
              />
            </ToolCard>
          ) : (
            <>
              {verdict && (
                <ToolNotice
                  tone={
                    verdict.tone === "emerald"
                      ? "info"
                      : verdict.tone === "amber"
                      ? "warn"
                      : "error"
                  }
                  icon={Activity}
                >
                  {verdict.text}
                </ToolNotice>
              )}

              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                <Stat
                  label="发送 / 成功"
                  value={`${stats.sent} / ${stats.received}`}
                />
                <Stat
                  label="丢包率"
                  value={`${stats.loss.toFixed(1)}%`}
                  tone={
                    stats.loss === 0
                      ? "emerald"
                      : stats.loss < 10
                      ? "amber"
                      : "rose"
                  }
                />
                <Stat
                  label="平均"
                  value={fmtMs(stats.avg)}
                  sub={`最小 ${fmtMs(stats.min)} · 最大 ${fmtMs(stats.max)}`}
                />
                <Stat
                  label="抖动"
                  value={fmtMs(stats.jitter)}
                  sub="相邻延迟的平均波动"
                />
              </div>
              {isHttp && stats.dnsAvg !== null && (
                <div className="grid grid-cols-2 gap-2.5">
                  <Stat label="DNS 解析（平均）" value={fmtMs(stats.dnsAvg)} />
                  <Stat
                    label="首字节（平均）"
                    value={fmtMs(stats.avg)}
                    sub="从发出请求到收到响应头"
                  />
                </div>
              )}

              <Curve samples={samples} />
            </>
          )}
        </div>

        <ToolCard fill={false} className="col-span-full h-full flex-1">
          <ToolCardHeader
            title="逐次记录"
            meta={`${samples.length} 条`}
            actions={
              <>
                <CopyButton value={report} label="复制报告" />
                <button
                  type="button"
                  onClick={() => setSamples([])}
                  disabled={running}
                  className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-dark-hover"
                >
                  <Eraser size={12} />
                  清空
                </button>
              </>
            }
          />
          <div className="h-full overflow-y-auto">
            <table className="w-full text-left font-mono text-[11.5px] tabular-nums">
              <thead className="sticky top-0 bg-slate-50 text-[10.5px] text-slate-400 dark:bg-dark-hover dark:text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">#</th>
                  <th className="px-3 py-1.5 font-semibold">时间</th>
                  <th className="px-3 py-1.5 font-semibold">结果</th>
                  <th className="px-3 py-1.5 font-semibold">
                    {isHttp ? "首字节" : "耗时"}
                  </th>
                  {isHttp && <th className="px-3 py-1.5 font-semibold">DNS</th>}
                  {mode === "icmp" && (
                    <th className="px-3 py-1.5 font-semibold">TTL</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-dark-border">
                {recent.map((s, i) => (
                  <tr key={s.id} className="text-slate-600 dark:text-slate-300">
                    <td className="px-3 py-1.5 text-slate-400">
                      {samples.length - i}
                    </td>
                    <td className="px-3 py-1.5 text-slate-400">
                      {fmtTime(s.at)}
                    </td>
                    <td className="px-3 py-1.5">
                      {s.ok ? (
                        <ToolTag tone="emerald">
                          {isHttp && s.status ? `HTTP ${s.status}` : "成功"}
                        </ToolTag>
                      ) : (
                        <ToolTag tone="amber">{s.error ?? "失败"}</ToolTag>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{s.ok ? fmtMs(s.ms) : "—"}</td>
                    {isHttp && (
                      <td className="px-3 py-1.5">{fmtMs(s.dnsMs)}</td>
                    )}
                    {mode === "icmp" && (
                      <td className="px-3 py-1.5">{s.ttl ?? "—"}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ToolCard>
      </div>
    </ToolShell>
  );
}
