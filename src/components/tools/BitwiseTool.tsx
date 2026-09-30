import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  Binary,
  Calculator,
  Hash,
  Sigma,
  Zap,
} from 'lucide-react'
import {
  BTN,
  CopyButton,
  Segmented,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardHeader,
  ToolEmpty,
  ToolNotice,
  ToolShell,
  ToolTag,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'

/* ==================== 数值模型 ==================== */

/**
 * 一律用 BigInt 存值。
 *
 * JS 的 number 只有 53 位精度，做位运算时又被强制截成 32 位有符号整数 ——
 * 查一个 64 位的寄存器掩码（0xFFFF_FFFF_0000_0000）会被它算成负数。
 * BigInt 没有这两个毛病，而且各大进制之间可以无损互转。
 */
type IntSize = 8 | 16 | 32 | 64

const SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: '8', label: '8 位' },
  { value: '16', label: '16 位' },
  { value: '32', label: '32 位' },
  { value: '64', label: '64 位' },
]

const BASES = [
  { key: 'bin', label: '二进制', radix: 2, hint: 'BIN' },
  { key: 'oct', label: '八进制', radix: 8, hint: 'OCT' },
  { key: 'dec', label: '十进制', radix: 10, hint: 'DEC' },
  { key: 'hex', label: '十六进制', radix: 16, hint: 'HEX' },
] as const

type BaseKey = (typeof BASES)[number]['key']

/** 各进制的数字字符（大写在输入时归一，展示时也统一大写） */
const DIGITS = '0123456789abcdef'

function digitsFor(radix: number): string {
  return DIGITS.slice(0, radix)
}

/** 按位掩码：size 位全 1 */
function maskOf(size: number): bigint {
  return (1n << BigInt(size)) - 1n
}

/**
 * 把「用户敲的绝对值 + 符号」折成 size 位的补码表示。
 *
 * 先取模再按有符号解释，所以 0xFF 在 8 位下就是 -1。这样溢出、负号、
 * 超范围输入都有了确定行为，不用在界面上到处弹「数值过大」。
 */
function toBits(magnitude: bigint, negative: boolean, size: number): bigint {
  const mask = maskOf(size)
  const value = negative ? -magnitude : magnitude
  return value & mask
}

/** 把补码位模式解释成有符号值 */
function fromBits(bits: bigint, size: number): bigint {
  const mask = maskOf(size)
  const value = bits & mask
  const signBit = 1n << BigInt(size - 1)
  return value >= signBit ? value - mask - 1n : value
}

/** 按进制渲染，位数不足时左侧补零到整数个字节 */
function formatValue(value: bigint, radix: number, size: number, group: boolean): string {
  const text = value.toString(radix).toUpperCase()
  const width = size / (radix === 2 ? 1 : radix === 8 ? 3 : radix === 16 ? 4 : 1)
  const padded = radix === 10 ? text : text.padStart(Math.ceil(width), '0')
  if (!group) return padded

  // 十六进制四位一组、二进制四位一组，长位模式靠肉眼数不清
  if (radix === 16) return padded.replace(/(.{4})(?=.)/g, '$1 ')
  if (radix === 2) return padded.replace(/(.{4})(?=.)/g, '$1 ')
  return padded
}

/* ==================== 主组件 ==================== */

export default function BitwiseTool() {
  const { showToast } = useToast()

  const [size, setSize] = useState<IntSize>(32)
  const [bits, setBits] = useState<bigint>(() => toBits(255n, false, 32))
  /*
   * 每个进制各存一份「用户正在敲的字符串」。
   *
   * 不能只存一个值再反推出四个输入框的内容 —— 那样输到一半的 "0x" 或 "-"
   * 会被立刻格式化掉，光标也跟着跳。让输入框保留原文，只在能解析时才更新值。
   */
  const [drafts, setDrafts] = useState<Record<BaseKey, string>>(() => ({
    bin: '11111111',
    oct: '377',
    dec: '255',
    hex: 'FF',
  }))

  const signed = useMemo(() => fromBits(bits, size), [bits, size])
  const isNegative = signed < 0n

  /** 位模式变了，四个输入框一起跟着刷新 */
  const syncDrafts = useCallback(
    (nextBits: bigint, nextSize: number) => {
      const unsigned = nextBits & maskOf(nextSize)
      setDrafts({
        bin: formatValue(unsigned, 2, nextSize, true),
        oct: formatValue(unsigned, 8, nextSize, false),
        dec: formatValue(unsigned, 10, nextSize, false),
        hex: formatValue(unsigned, 16, nextSize, true),
      })
    },
    [],
  )

  /** 从某个进制输入框写入新值 */
  const applyInput = (key: BaseKey, raw: string) => {
    const radix = BASES.find((base) => base.key === key)!.radix
    // 只留下这一进制认得的字符，顺手兼容用户粘进来的 0x / 0b 前缀和分隔符
    const cleaned = raw
      .replace(/^[-+]/, (m) => m)
      .replace(/^0[xXbBoO]/, '')
      .replace(/[\s_,]/g, '')
      .toUpperCase()

    if (
      !cleaned ||
      cleaned === '-' ||
      cleaned === '+' ||
      !new RegExp(`^[-+]?[${digitsFor(radix).toUpperCase()}]+$`).test(cleaned)
    ) {
      // 打到一半（只有个负号）或打进了本进制没有的字符：原文留着让用户自己改，不硬吞
      setDrafts((prev) => ({ ...prev, [key]: raw }))
      return
    }

    const negative = cleaned.startsWith('-')
    const body = cleaned.replace(/^[-+]/, '')
    const magnitude = BigInt(
      `0${radix === 16 ? 'x' : radix === 8 ? 'o' : radix === 2 ? 'b' : ''}${body}`,
    )
    const nextBits = toBits(magnitude, negative, size)
    setBits(nextBits)
    // 输入框保留用户原文，光标不跳；其余三个框重算
    setDrafts(() => {
      const unsigned = nextBits & maskOf(size)
      return {
        bin: key === 'bin' ? raw : formatValue(unsigned, 2, size, true),
        oct: key === 'oct' ? raw : formatValue(unsigned, 8, size, false),
        dec: key === 'dec' ? raw : formatValue(unsigned, 10, size, false),
        hex: key === 'hex' ? raw : formatValue(unsigned, 16, size, true),
      }
    })
  }

  /** 切换位宽：位模式按新宽度重新截取，避免 64 位值切到 8 位后还显示原样 */
  const changeSize = (next: IntSize) => {
    setSize(next)
    const narrowed = bits & maskOf(next)
    setBits(narrowed)
    syncDrafts(narrowed, next)
  }

  useEffect(() => {
    syncDrafts(bits, size)
    // 只在挂载时同步一次；后续同步都由改动方主动调用，免得把用户正在敲的原文盖掉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- 位运算 ---------------- */
  const [operand, setOperand] = useState('FF')
  const [op, setOp] = useState<'and' | 'or' | 'xor' | 'shl' | 'shr' | 'sar'>('and')

  const applyOp = () => {
    const isShift = op === 'shl' || op === 'shr' || op === 'sar'
    const mask = maskOf(size)
    // 位移与按位两个分支各解一个操作数，先各自算好再统一做运算，
    // 省得在 switch 里再判一次是移位还是位运算
    let shift = 0n
    let other = 0n

    try {
      if (isShift) {
        shift = BigInt(Math.abs(Number(operand.replace(/\D/g, '') || '0')))
        // 移超过位宽没有意义（结果必然是 0 或全是符号位），夹住免得算出天文数字
        if (shift > BigInt(size)) shift = BigInt(size)
      } else {
        other = toBits(BigInt(`0x${operand.replace(/[^0-9a-fA-F]/g, '') || '0'}`), false, size)
      }
    } catch {
      showToast('运算数格式不对', 'error')
      return
    }

    let result: bigint
    switch (op) {
      case 'and':
        result = bits & other
        break
      case 'or':
        result = bits | other
        break
      case 'xor':
        result = bits ^ other
        break
      case 'shl':
        result = (bits << shift) & mask
        break
      case 'shr':
        // 逻辑右移：空出的高位补 0，先当成无符号数再移
        result = (bits & mask) >> shift
        break
      case 'sar':
        // 算术右移：保留符号位。BigInt 的 >> 对负数天然就是算术右移
        result = fromBits(bits, size) >> shift
        break
    }

    result = result & mask
    setBits(result)
    syncDrafts(result, size)
  }

  /* ---------------- 大小端转换 ---------------- */
  const swapEndianness = () => {
    const mask = maskOf(size)
    const bytes = size / 8
    let value = bits & mask
    let swapped = 0n
    for (let i = 0; i < bytes; i++) {
      swapped = (swapped << 8n) | (value & 0xffn)
      value >>= 8n
    }
    const result = swapped & mask
    setBits(result)
    syncDrafts(result, size)
    showToast('已按字节翻转', 'default')
  }

  const setPreset = (value: bigint, label: string) => {
    const next = value & maskOf(size)
    setBits(next)
    syncDrafts(next, size)
    showToast(`已载入 ${label}`, 'default')
  }

  /* ---------------- 位标记 ---------------- */
  const setBit = (index: number) => {
    const next = (bits ^ (1n << BigInt(index))) & maskOf(size)
    setBits(next)
    syncDrafts(next, size)
  }

  const bitIndexes = Array.from({ length: size }, (_, i) => size - 1 - i)

  return (
    <ToolShell
      icon={Binary}
      title="进制转换与位运算沙箱"
      subtitle="2 / 8 / 10 / 16 进制同步换算，位掩码、位移、大小端与 IEEE 754 解析"
      badge={
        <ToolBadge tone={isNegative ? 'amber' : 'emerald'}>
          {size} 位 · {isNegative ? `有符号 ${signed}` : '正值'}
        </ToolBadge>
      }
      actions={
        <>
          <Tooltip content="按字节翻转大小端">
            <button onClick={swapEndianness} className={BTN.secondary}>
              <ArrowLeftRight size={14} />
              <span>大小端翻转</span>
            </button>
          </Tooltip>
          <CopyButton value={() => formatValue(bits & maskOf(size), 16, size, false)} label="复制 HEX" />
        </>
      }
    >
      <div className="tool-cascade flex flex-col gap-3.5">
        {/* 位宽选择 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            数据位宽
          </span>
          <Segmented
            value={String(size)}
            options={SIZE_OPTIONS}
            onChange={(value) => changeSize(Number(value) as IntSize)}
          />
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            超出位宽的位会被截断，负数按补码表示
          </span>
        </div>

        {/* 四个进制同步输入 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {BASES.map((base) => (
            <ToolCard key={base.key} fill={false}>
              <ToolCardHeader
                title={base.label}
                icon={Hash}
                meta={base.hint}
                actions={
                  <CopyButton
                    value={() => drafts[base.key].replace(/[\s_,]/g, '')}
                    label={`复制 ${base.label}`}
                  />
                }
              />
              <div className="p-3.5">
                <input
                  value={drafts[base.key]}
                  onChange={(e) => applyInput(base.key, e.target.value)}
                  spellCheck={false}
                  className="w-full bg-transparent outline-none font-mono text-[15px] tracking-wide text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600"
                  placeholder={`输入${base.label}`}
                />
              </div>
            </ToolCard>
          ))}
        </div>

        {/* 位标记图：点一下翻转该位 */}
        <ToolCard fill={false}>
          <ToolCardHeader
            title="位标记"
            icon={Binary}
            sublabel="点任意一位即可翻转（从低位到高位，右起第 0 位）"
            actions={
              <ToolTag tone="slate">
                0x{(bits & maskOf(size)).toString(16).toUpperCase()}
              </ToolTag>
            }
          />
          <div className="p-3.5 flex flex-wrap gap-1.5">
            {bitIndexes.map((index) => {
              const on = ((bits >> BigInt(index)) & 1n) === 1n
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setBit(index)}
                  title={`第 ${index} 位`}
                  className={`group flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-md border transition-colors ${
                    on
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/15 dark:text-brand-300'
                      : 'border-slate-200 dark:border-dark-border text-slate-400 hover:bg-slate-50 dark:hover:bg-dark-hover'
                  }`}
                >
                  <span className="font-mono text-[11px] font-bold tabular-nums leading-none">
                    {on ? 1 : 0}
                  </span>
                  <span className="text-[9px] tabular-nums leading-none opacity-70">
                    {index}
                  </span>
                </button>
              )
            })}
          </div>
        </ToolCard>

        {/* 位运算 */}
        <ToolCard fill={false}>
          <ToolCardHeader title="位运算沙箱" icon={Calculator} sublabel="在当前值上继续运算" />
          <div className="p-3.5 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Segmented
                value={op}
                options={[
                  { value: 'and', label: 'AND' },
                  { value: 'or', label: 'OR' },
                  { value: 'xor', label: 'XOR' },
                  { value: 'shl', label: '<<' },
                  { value: 'shr', label: '>>' },
                  { value: 'sar', label: '算术 >>' },
                ]}
                onChange={(value) => setOp(value as typeof op)}
              />
              <input
                value={operand}
                onChange={(e) => setOperand(e.target.value)}
                spellCheck={false}
                placeholder={op === 'shl' || op === 'shr' || op === 'sar' ? '位移位数' : '十六进制操作数'}
                className="flex-1 min-w-[160px] h-8 px-3 rounded-[10px] border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel font-mono text-xs outline-none focus:border-brand-400 dark:focus:border-brand-500 transition-colors text-slate-800 dark:text-slate-100"
              />
              <button onClick={applyOp} className={BTN.primary}>
                <Zap size={14} />
                <span>执行</span>
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                常用掩码
              </span>
              {[
                { label: '全 1', value: maskOf(size) },
                { label: '0x0F', value: 0x0fn },
                { label: '0xFF', value: 0xffn },
                { label: '0xFFFF', value: 0xffffn },
                { label: '0x5555', value: 0x5555n },
                { label: '0xAAAA', value: 0xaaaan },
                { label: '1 << 31', value: 1n << 31n },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setPreset(preset.value, preset.label)}
                  className="h-6 px-2 rounded-md border border-slate-200 dark:border-dark-border text-[11px] font-mono text-slate-500 dark:text-slate-400 hover:border-brand-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </ToolCard>

        {/* IEEE 754 */}
        <Ieee754Panel />

        <ToolActionBar info="所有换算都在本机完成：位模式用 BigInt 表示，不受 JS 双精度 53 位限制">
          <button
            onClick={() => {
              const next = 0n
              setBits(next)
              syncDrafts(next, size)
            }}
            className={BTN.secondary}
          >
            清零
          </button>
        </ToolActionBar>
      </div>
    </ToolShell>
  )
}

/* ==================== IEEE 754 浮点数解析 ==================== */

type FloatPrecision = '32' | '64'

/**
 * 手工按位拆解 IEEE 754。
 *
 * 不用 DataView 代劳：这里要的正是「符号位 / 阶码 / 尾数各是什么」，
 * DataView 只能给出数值本身，拆位还得自己来。而且拆位后能把每一段
 * 单独高亮出来，比一串二进制串好读得多。
 */
function decodeFloat(text: string, precision: FloatPrecision) {
  const value = Number(text)
  if (!Number.isFinite(value)) return null

  const totalBits = precision === '32' ? 32 : 64
  const exponentBits = precision === '32' ? 8 : 11
  const mantissaBits = precision === '32' ? 23 : 52
  const bias = precision === '32' ? 127 : 1023

  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  if (precision === '32') view.setFloat32(0, value, false)
  else view.setFloat64(0, value, false)

  // 取成二进制串，再按 1 / 8 / 23（或 1 / 11 / 52）切开。
  // setFloat32 只写前 4 字节，所以按精度读对应的字节数即可
  const byteCount = totalBits / 8
  const raw = Array.from({ length: byteCount }, (_, i) =>
    view.getUint8(i).toString(2).padStart(8, '0'),
  ).join('')

  const sign = raw.slice(0, 1)
  const exponent = raw.slice(1, 1 + exponentBits)
  const mantissa = raw.slice(1 + exponentBits)

  const exponentValue = parseInt(exponent, 2)
  const isSubnormal = exponentValue === 0
  const isSpecial = exponentValue === (1 << exponentBits) - 1

  return {
    value,
    totalBits,
    exponentBits,
    mantissaBits,
    bias,
    sign,
    exponent,
    mantissa,
    raw,
    exponentValue,
    /** 实际参与计算的阶：规格化数是 阶码 - 偏移量，非规格化数固定为 1 - 偏移量 */
    unbiased: isSubnormal ? 1 - bias : exponentValue - bias,
    isSubnormal,
    isSpecial,
    isZero: isSubnormal && /^0+$/.test(mantissa),
  }
}

function Ieee754Panel() {
  const [text, setText] = useState('0.1')
  const [precision, setPrecision] = useState<FloatPrecision>('32')

  const decoded = useMemo(() => decodeFloat(text, precision), [text, precision])

  return (
    <ToolCard fill={false}>
      <ToolCardHeader
        title="IEEE 754 浮点数解析"
        icon={Sigma}
        sublabel="调音视频、抠二进制协议时的照妖镜"
        actions={
          <Segmented
            value={precision}
            options={[
              { value: '32', label: '单精度 float' },
              { value: '64', label: '双精度 double' },
            ]}
            onChange={(value) => setPrecision(value as FloatPrecision)}
          />
        }
      />

      <div className="p-3.5 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="输入一个浮点数，如 0.1 / -3.14 / 1e-40"
            className="flex-1 min-w-[200px] h-9 px-3 rounded-[10px] border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel font-mono text-[13px] outline-none focus:border-brand-400 dark:focus:border-brand-500 transition-colors text-slate-800 dark:text-slate-100"
          />
          {decoded && (
            <ToolTag tone="brand">
              实际存储值 {String(decoded.value)}
            </ToolTag>
          )}
        </div>

        {!decoded ? (
          <ToolEmpty
            icon={Sigma}
            title="还看不出结果"
            hint="请输入一个有限浮点数；NaN 与 Infinity 也可以试着输进来看看"
          />
        ) : (
          <>
            {/* 符号位 / 阶码 / 尾数三段分色 */}
            <div className="flex flex-wrap gap-2">
              <FieldBlock label="符号位 S" bits={decoded.sign} tone="rose" hint={decoded.sign === '1' ? '负数' : '正数'} />
              <FieldBlock
                label={`阶码 E（${decoded.exponentBits} 位）`}
                bits={decoded.exponent}
                tone="amber"
                hint={
                  decoded.isSpecial
                    ? '全 1：NaN / Infinity'
                    : `无偏移 ${decoded.exponentValue} → 实际 ${decoded.unbiased}`
                }
              />
              <FieldBlock
                label={`尾数 M（${decoded.mantissaBits} 位）`}
                bits={decoded.mantissa}
                tone="brand"
                hint={decoded.isSubnormal ? '阶码为 0：非规格化数' : '隐含整数位 1'}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                完整位模式（{decoded.totalBits} 位）
              </span>
              <div className="font-mono text-[12px] leading-6 break-all select-text text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-dark-hover/40 rounded-lg px-3 py-2 border border-slate-200/70 dark:border-dark-border">
                {/*
                  split/join 而不是 replace：替换串里的 $1 是反向引用的占位符，
                  用 '$1 ' 当替换串会把分组匹配结果替换成字面量 "$1"。
                */}
                {decoded.raw.match(/.{8}/g)?.join(' ') ?? decoded.raw}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <MiniStat label="十六进制" value={`0x${BigInt(`0b${decoded.raw}`).toString(16).toUpperCase()}`} />
              <MiniStat label="偏移量 Bias" value={String(decoded.bias)} />
              <MiniStat label="精度" value={precision === '32' ? '约 7 位十进制有效数字' : '约 15~17 位'} />
              <MiniStat
                label="最小非零"
                value={precision === '32' ? '≈1.4e-45' : '≈4.9e-324'}
              />
            </div>

            {decoded.isSubnormal && !decoded.isZero && (
              <ToolNotice tone="warn" icon={Sigma}>
                这是非规格化（subnormal）数：阶码全 0，尾数不再隐含整数位 1，
                精度会明显下降。0.1 这类值的舍入误差正是从这儿来的。
              </ToolNotice>
            )}
          </>
        )}
      </div>
    </ToolCard>
  )
}

/** 一段位域的可视块：标题 + 二进制串 + 解释 */
function FieldBlock({
  label,
  bits,
  tone,
  hint,
}: {
  label: string
  bits: string
  tone: 'rose' | 'amber' | 'brand'
  hint: string
}) {
  const tones = {
    rose: 'border-rose-200/70 bg-rose-50/60 dark:border-rose-500/25 dark:bg-rose-500/10',
    amber: 'border-amber-200/70 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-500/10',
    brand: 'border-brand-200/70 bg-brand-50/60 dark:border-brand-500/25 dark:bg-brand-500/10',
  } as const

  return (
    <div className={`flex-1 min-w-[180px] rounded-xl border px-3 py-2 ${tones[tone]}`}>
      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</p>
      <p className="font-mono text-[13px] font-bold break-all mt-0.5 text-slate-800 dark:text-white">
        {bits}
      </p>
      <p className="text-[10px] mt-1 text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 dark:border-dark-border px-2.5 py-2">
      <p className="text-[10px] text-slate-400 dark:text-slate-500">{label}</p>
      <p className="font-mono text-[12px] font-semibold text-slate-800 dark:text-slate-100 break-all mt-0.5">
        {value}
      </p>
    </div>
  )
}
