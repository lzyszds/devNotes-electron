import { memo, useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { OCR_STAGE_LABELS, type OcrStage } from '../../../utils/ocr'
import type { OcrRunState } from '../../../utils/ocrRunStore'

/*
 * 识别进度 —— 做成「原文卡片底栏那一行的上下滚翻」。
 *
 * 为什么不再是悬浮条 / 独立一行：
 *  - 悬浮会挡住正文，独立一行出现/消失会把下面的内容顶动（用户明确否掉）；
 *  - 底栏那一行（「合并断行 / 字数 / 朗读」）本身高度固定，把它的内容换一屏
 *    是最省地方的做法：识别时滚上去显示进度，识别完滚回来恢复原工具栏。
 *
 * 结构上是一个只有一屏高的裁剪窗口，里面竖排两屏：[进度][原工具栏]
 * （收摊后再换回 [工具栏][进度]，见下面 aboutToIdle 的注释）。
 * 窗口、轨道、每屏三者的高度都从同一个 --ocr-pane 推导，窗口尺寸永远不变，
 * 所以下方面板不会被顶动。
 *
 * ⚠️ 翻页用 CSS transition，不要改回 rAF 逐帧写 transform。
 *
 * 上一版就是这么栽的：翻页位置由 rAF 每帧插值、进度值和耗时也由 rAF 直接写
 * DOM。日志里能看到组件在「开始识别」前后被 StrictMode 重挂了一次
 * （挂载 #1 → 收到图片 → 卸载 #1 → 挂载 #2），新的动画循环拿到的起始状态
 * 是 0，而真正该翻页的那一刻（识别开始的第一次渲染）已经过去了 —— 于是
 * 实测 DOM 里是 translateY(-0.048%)：动画确实在跑，但从错误的时间点起步。
 *
 * 现在的做法：
 *  - 翻不翻页只由「当前有没有一张进度屏要显示」这一个布尔值决定，它直接来自
 *    store 的快照，不经过任何中间 ref；
 *  - 位移交给 CSS transition —— 同一个渲染帧里改 class，浏览器一定会为它补
 *    一次过渡，不依赖 React 是否把几次更新合并、也不依赖组件何时挂载；
 *  - 进度条宽度、百分比同样交给 CSS transition，耗时用 100ms 的定时器推进。
 */

const STAGE_ORDER: OcrStage[] = ['engine', 'detect', 'recognize']

/** 每阶段的兜底权重：主进程没给 weight 时用它 */
const DEFAULT_WEIGHT: Record<OcrStage, number> = { engine: 15, detect: 10, recognize: 75 }

/** 识别中允许的「显示值领先真实值」上限 */
const CRAWL_LIMIT = 0.12

/** 翻页时长（ms）。与 index.css 里 .fe-ocr-track 的 transition 时长保持一致 */
export const OCR_FLIP_MS = 260

/** 耗时数字的刷新间隔：160ms 一次已经比引擎上报还密，不必逐帧 */
const TICK_MS = 100

/** 毫秒转「123ms / 1.2s」：一秒以内给毫秒，上面给秒 */
function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms'
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

/**
 * 把「已经走过的阶段 + 当前阶段的进度」换算成整条进度（0~1）。
 *
 * 阶段权重是相对的：前面阶段的权重和构成起点，当前阶段按自己的 p 往后推。
 * 阶段顺序固定（engine → detect → recognize），不用考虑乱序到达。
 */
function toOverall(state: OcrRunState): number {
  if (state.status === 'done') return 1
  const weights = STAGE_ORDER.map((name) =>
    name === state.stage ? state.weight ?? DEFAULT_WEIGHT[name] : DEFAULT_WEIGHT[name]
  )
  const total = weights.reduce((sum, value) => sum + value, 0) || 1
  const index = Math.max(0, STAGE_ORDER.indexOf(state.stage))
  const before = weights.slice(0, index).reduce((sum, value) => sum + value, 0)
  const own = weights[index]
  return Math.max(0, Math.min(1, (before + own * state.progress) / total))
}

/**
 * 爬行下限：等得越久，允许显示的「虚拟进度」越低。
 *
 * 直白地说，就是个不装死的进度条：前 3 秒可以爬到 60%，30 秒时也只敢在
 * 92% 附近趴着。之所以随等待时间衰减，是因为真实进度不知道什么时候到，
 * 匀速爬行的条子最后一定会顶到上限然后干等，反而更假。
 */
function crawlFloor(elapsedMs: number): number {
  const seconds = elapsedMs / 1000
  const ceiling = 0.94 - 0.02 * Math.min(1, seconds / 30)
  return Math.min(ceiling, 1 - Math.exp(-seconds / 3.2))
}

/*
 * 「完成后停多久再翻回工具栏」不在这里计时：由 ocrRunStore 在 2.4s 后把
 * run 置空，本组件看到 null 就翻回去。计时器只存在一份，组件重挂也不会断。
 */

export interface OcrFooterSlotProps {
  /** store 里的本轮状态；null = 空闲（或已经收摊） */
  run: OcrRunState | null
  /** 常驻的那一屏（原来的底栏内容） */
  children: React.ReactNode
}

/**
 * 进度屏 ↔ 工具栏的上下滚翻槽位。
 *
 * memo：内部每 100ms 有一次「耗时」自更新，不能让它顺着父组件的重渲染
 * （输入框每敲一个字都会重渲染整页）再多走一遍。
 */
const OcrProgressBar = memo(function OcrProgressBar({ run, children }: OcrFooterSlotProps) {
  /*
   * 本次「显示进度屏」是否已经退场。
   *
   * 运行中（run !== null）永远是 false；run 变回 null 时置 true，等翻页动画
   * 走完（OCR_FLIP_MS）后再复位。它的唯一用途是决定两屏的上下顺序：
   *
   *   - 平时：[工具栏][进度] —— 窗口默认露出的就是工具栏，进度屏在下面等着；
   *   - 翻上去：translateY(-50%) → 露出 [进度]；
   *   - 收摊时 run 变成 null：如果仍是「[工具栏][进度]」，translateY 从 -50%
   *     回 0 的过程中，用户会先看到工具栏、再把工具栏往上推 —— 是「往下滚」。
   *     所以开场时就把两屏换成 [进度][工具栏]，translateY 归零时是工具栏从
   *     下方顶上来，观感统一为「往上滚」。
   *
   * 换顺序必须发生在 translateY 归零（动画已结束）之后，否则会闪一下。
   */
  const [atRest, setAtRest] = useState(() => run === null)

  useEffect(() => {
    if (run !== null || atRest) return
    const timer = window.setTimeout(() => setAtRest(true), OCR_FLIP_MS)
    return () => window.clearTimeout(timer)
  }, [run, atRest])

  // 新一轮开始时立刻把顺序切回 [工具栏][进度]，这一帧 translateY 还是 0、不产生动画
  const flipped = run !== null
  const showProgressTop = !flipped && !atRest

  return (
    /*
     * 结构：一个固定高度的裁剪窗口 + 一条两倍高的轨道，翻页时整体位移一屏。
     *
     * ⚠️ 高度必须用**同一个像素值**推导，不能混用 h-full / h-1/2：
     * 窗口 = var(--ocr-pane)，轨道 = 它的两倍，每屏 flex-1。
     * 变量定义在 index.css 的 :root 上，值必须和 CARD_FOOT 的 h-8 一致。
     */
    <div
      className="fe-ocr-slot relative w-full overflow-hidden"
      style={{ height: 'var(--ocr-pane, 32px)' }}
      aria-live="polite"
    >
      <div
        className="fe-ocr-track absolute inset-x-0 top-0 flex flex-col"
        style={{
          height: 'calc(var(--ocr-pane, 32px) * 2)',
          transform: flipped ? 'translateY(-50%)' : 'translateY(0)',
        }}
      >
        {showProgressTop ? (
          <>
            <ProgressPane run={run} />
            <div className="fe-ocr-pane flex w-full items-center">{children}</div>
          </>
        ) : (
          <>
            <div className="fe-ocr-pane flex w-full items-center">{children}</div>
            <ProgressPane run={run} />
          </>
        )}
      </div>
    </div>
  )
})

export default OcrProgressBar

/**
 * 进度屏。
 *
 * 显示的内容（阶段名 / 耗时 / 百分比）由 React 正常渲染，进度条宽度与数字
 * 交给 CSS transition 平滑 —— 这里不做任何逐帧写 DOM 的事。
 */
function ProgressPane({ run }: { run: OcrRunState | null }) {
  const [now, setNow] = useState(() => performance.now())
  const done = run?.status === 'done'

  /*
   * 耗时自己走：引擎上报间隔 160ms 甚至更长（分析排版整段没有回调），
   * 两次之间数字停着会让人以为卡死了。用 run.startedAt 做基准本地推进，
   * 完成态直接定格成总耗时。
   */
  useEffect(() => {
    if (!run || done) return
    setNow(performance.now())
    const timer = window.setInterval(() => setNow(performance.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [run, done])

  // 没有 run（收摊动画期间的那一屏）保持完成态的样子，不要跳回 0%
  const state: OcrRunState =
    run ?? { status: 'done', progress: 1, stage: 'recognize', elapsedMs: 0, startedAt: 0 }

  const elapsed = done
    ? state.elapsedMs ?? 0
    : Math.max(0, Math.round(now - state.startedAt))

  let shown: number
  if (done) {
    shown = 1
  } else {
    const base = toOverall(state)
    const floor = Math.min(crawlFloor(elapsed), base + CRAWL_LIMIT)
    shown = Math.min(Math.max(base, floor), 0.99)
  }
  const percent = Math.round(shown * 100)

  const label = done ? '识别完成' : OCR_STAGE_LABELS[state.stage] ?? '识别文字'

  return (
    <div className="fe-ocr-pane flex w-full items-center gap-2.5 px-3.5 text-[10px] font-medium text-[#787774]">
      <span className="flex shrink-0 items-center">
        {done ? (
          <Check size={13} className="text-emerald-600" />
        ) : (
          <Loader2 size={13} className="animate-spin text-brand-500" />
        )}
      </span>

      <span
        className={`shrink-0 text-[11px] ${done ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200'}`}
      >
        {label}
      </span>

      {/* 实测耗时：识别中一直往上走，完成时定格成总耗时 */}
      <span className="w-11 shrink-0 font-mono tabular-nums text-slate-400" title="本次识别已用时间">
        {formatMs(elapsed)}
      </span>

      <div className="h-1 min-w-10 flex-1 overflow-hidden rounded-full bg-slate-200/80">
        <div
          className={`fe-ocr-fill h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-brand-500'}`}
          style={{ width: `${shown * 100}%` }}
        />
      </div>

      <span className="w-8 shrink-0 text-right font-mono tabular-nums text-slate-500">
        {percent}%
      </span>
    </div>
  )
}
