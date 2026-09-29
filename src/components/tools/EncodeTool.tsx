import { useState } from 'react'
import { ArrowDown, Copy, History, KeyRound, Shuffle, TriangleAlert } from 'lucide-react'
import { useToolHistory } from '../../hooks/useToolHistory'
import { useHistoryContextMenu } from '../../hooks/useHistoryContextMenu'
import {
  BODY_OUTPUT,
  BODY_TEXTAREA,
  BTN,
  META,
  SECTION_LABEL,
  Segmented,
  Select,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolHistoryOverlay,
  ToolNotice,
  ToolShell,
  iconButtonClass,
} from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'
import {
  AES_KEY_SIZES,
  AES_MODES,
  aesDecrypt,
  aesEncrypt,
  encoderTypes,
  type AesKeySize,
  type AesKeySource,
  type AesParams,
} from '../../utils/encoders'

/** AES 在 UI 上表现为一个「编码类型」，但它异步，所以跟同步的那批分开判断 */
const AES_ID = 'aes'

const DEFAULT_AES: AesParams = {
  mode: 'GCM',
  keySize: 256,
  keySource: 'hex',
  key: '',
  iterations: 100000,
}

/** 按位宽生成一个随机密钥的十六进制，方便用户直接用 */
function randomHexKey(keySize: AesKeySize): string {
  const bytes = crypto.getRandomValues(new Uint8Array(keySize / 8))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 左栏里的一个转换方式。
 *
 * 单行铺开：左边名称、右边说明，说明过长就省略 —— 单列宽度够放常见文案，
 * 放不下的截断即可，完整说明在 title 里。点它就等于直接执行（见 pick）。
 */
function MethodTile({
  name,
  hint,
  active,
  decode = false,
  onClick,
}: {
  name: string
  hint?: string
  active: boolean
  decode?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`flex items-center gap-2 rounded-lg border px-2.5 h-9 text-left transition-colors ${
        active
          ? 'border-brand-200 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10'
          : 'border-slate-200 dark:border-dark-border hover:border-slate-300 hover:bg-slate-50 dark:hover:border-slate-600 dark:hover:bg-dark-hover'
      }`}
    >
      <span
        className={`text-[12px] font-semibold shrink-0 ${
          active ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'
        }`}
      >
        {name}
      </span>
      <span
        className={`ml-auto text-[10px] truncate ${
          active ? 'text-brand-500' : 'text-slate-400 dark:text-slate-500'
        }`}
      >
        {decode ? '← ' : '→ '}
        {hint}
      </span>
    </button>
  )
}

export default function EncodeTool({ initialType = 'base64' }: { initialType?: string } = {}) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  // 工具库里的 Base64 / URL 是同一个工具的不同入口，各自指定落点模式；
  // 以后新开入口只要传 initialType，不用再复制一份组件
  const [activeType, setActiveType] = useState(
    encoderTypes.some((type) => type.id === initialType) || initialType === AES_ID
      ? initialType
      : 'base64',
  )
  /**
   * 当前方向。左栏把每种方式在「编码」「解码」两组各列了一格，
   * 光靠 activeType 分不出选的是哪一格 —— 两格都会命中同一次比较。
   * 加上方向状态，「选中」才唯一，高亮也只亮一格。
   */
  const [direction, setDirection] = useState<'encode' | 'decode'>('encode')
  const [aes, setAes] = useState<AesParams>(DEFAULT_AES)
  /** GCM 是 AEAD 模式，安全但密文长度会多 16 字节认证标签；这里给个可见提示 */
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const { showToast } = useToast()

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>('encode')
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setInput(item.data)
      setShowHistory(false)
    },
    onRemove: removeHistoryItem,
  })

  const isAes = activeType === AES_ID
  const currentType = encoderTypes.find((t) => t.id === activeType)

  const runSync = (direction: 'encode' | 'decode') => {
    if (!currentType) return
    try {
      setOutput(direction === 'encode' ? currentType.encode(input) : currentType.decode(input))
      setError('')
      saveHistory(input, `${currentType.name} ${direction === 'encode' ? '编码' : '解码'}`)
    } catch (e) {
      setError((direction === 'encode' ? '编码失败: ' : '解码失败: ') + (e as Error).message)
    }
  }

  const runAes = async (direction: 'encode' | 'decode') => {
    setRunning(true)
    try {
      const result =
        direction === 'encode' ? await aesEncrypt(input, aes) : await aesDecrypt(input, aes)
      setOutput(result)
      setError('')
      saveHistory(input, `AES-${aes.mode} ${direction === 'encode' ? '加密' : '解密'}`)
    } catch (e) {
      setError((direction === 'encode' ? '加密失败: ' : '解密失败: ') + (e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const run = (dir: 'encode' | 'decode') => {
    if (!input.trim()) return
    if (isAes) void runAes(dir)
    else runSync(dir)
  }

  /** 选中某格的「方式 + 方向」，此时并不执行 —— 执行交给底部按钮 */
  const pick = (id: string, dir: 'encode' | 'decode') => {
    setActiveType(id)
    setDirection(dir)
    setError('')
  }

  const clearAll = () => {
    setInput('')
    setOutput('')
    setError('')
  }

  const copyOutput = async () => {
    if (!output) return
    const ok = await copyText(output)
    showToast(ok ? '已复制结果' : '复制失败', ok ? 'default' : 'error')
  }

  /** 密钥没填就别让 AES 按钮亮着，省得点了才报错 */
  const aesKeyMissing = isAes && !aes.key.trim()
  const canRun = Boolean(input.trim()) && !running && !aesKeyMissing

  return (
    // 外层再包一层 flex：ToolShell 占满剩余高度并自己滚动，动作条在它下面占位，
    // 两者是兄弟节点、各占各的高度，不会互相覆盖
    <div className="flex flex-col h-full min-h-0">
      <ToolShell
        icon={Shuffle}
        title="万能编解码工作室"
        subtitle="Base64 / Hex / 进制 / 摩斯码 / 古典密码 / AES 加解密，全部双向"
        // 左栅格给个最小高度，窄屏下面板不够高时整页还能滚动，不至于把卡片压扁
        contentClassName="min-h-0"
      badge={
        <ToolBadge tone="emerald" className="hidden sm:flex">
          {isAes ? `AES-${aes.mode}` : currentType?.name ?? ''} · 就绪
        </ToolBadge>
      }
      actions={
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`tool-button-secondary h-8 ${
            showHistory
              ? 'ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400'
              : ''
          }`}
        >
          <History size={15} />
          <span>历史记录</span>
        </button>
      }
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="历史文本片段"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setInput(item.data)
            setShowHistory(false)
          }}
          onItemContextMenu={openHistoryMenu}
        />
      }
    >
      {error && (
        <ToolNotice tone="error" icon={TriangleAlert}>
          <p className="whitespace-pre-line">{error}</p>
        </ToolNotice>
      )}

      {/* 说明当前方式的特性与局限，尤其是有损编码 */}
      {!isAes && currentType?.hint && (
        <ToolNotice tone={currentType.lossy ? 'warn' : 'info'}>
          <span className="font-semibold">{currentType.name}：</span>
          {currentType.hint}
        </ToolNotice>
      )}

      <div className="h-full min-h-[420px] grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-stretch">
        {/* ---------------- 左栏：全部转换方式，单列铺开 ---------------- */}
        <ToolCard>
          <ToolCardHeader
            title="转换方式"
            sublabel="METHOD"
            // meta 自带一层灰底，这里只能传纯文本；再套 ToolTag 会双层叠色
            meta={`${encoderTypes.length + 1} 种`}
          />

          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className={SECTION_LABEL}>编码</span>
                <span className={META}>ENCODE</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {encoderTypes.map((type) => (
                  <MethodTile
                    key={type.id}
                    name={type.name}
                    hint={type.hint}
                    active={activeType === type.id && direction === 'encode'}
                    onClick={() => pick(type.id, 'encode')}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className={SECTION_LABEL}>解码</span>
                <span className={META}>DECODE</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {encoderTypes.map((type) => (
                  <MethodTile
                    key={type.id}
                    name={type.name}
                    hint={type.lossy ? '有损，不能完全还原' : '还原为原文'}
                    active={activeType === type.id && direction === 'decode'}
                    decode
                    onClick={() => pick(type.id, 'decode')}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className={SECTION_LABEL}>加解密</span>
                <span className={META}>AES</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <MethodTile
                  name="AES 加密"
                  hint={`${aes.mode} · ${aes.keySize} 位`}
                  active={isAes && direction === 'encode'}
                  onClick={() => pick(AES_ID, 'encode')}
                />
                <MethodTile
                  name="AES 解密"
                  hint={`${aes.mode} · ${aes.keySize} 位`}
                  active={isAes && direction === 'decode'}
                  decode
                  onClick={() => pick(AES_ID, 'decode')}
                />
              </div>
            </div>
          </div>

          {/* 底部按钮跟上面的滚动列表隔一道，免得像压在最后一格上 */}
          <div className="p-3 border-t border-slate-200/60 dark:border-dark-border flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => run('encode')}
              disabled={!canRun}
              className={`${BTN.primary} flex-1`}
            >
              {running ? '处理中…' : '转换'}
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={!input && !output}
              className={BTN.secondary}
            >
              清空
            </button>
          </div>
        </ToolCard>

        {/* ---------------- 右侧：输入 / 参数 / 结果，自上而下 ---------------- */}
        <div className="flex flex-col gap-4 min-h-0 pr-2 overflow-y-scroll">
          <ToolCard className="min-h-[150px]">
            <ToolCardHeader
              title={isAes ? '明文 / 密文' : '输入内容'}
              sublabel="SOURCE"
              // meta 自带一层灰底，这里只能传纯文本；再套 ToolTag 会双层叠色
              meta={isAes ? 'IV:密文' : '纯文本'}
            />
            <div className="flex-1 min-h-0 p-4 flex flex-col">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  isAes ? '加密时填明文；解密时贴入「IV:密文」' : '在这里输入需要转换的文本…'
                }
                className={BODY_TEXTAREA}
              />
            </div>
            <ToolCardFooter>
              <span className="font-mono">{input.length} 字符</span>
              <span className={META}>{isAes ? `AES-${aes.mode}` : currentType?.name}</span>
            </ToolCardFooter>
          </ToolCard>

          {/* AES 参数：只有选了 AES 才出现，夹在输入与结果之间 */}
          {isAes && (
            <ToolCard fill={false}>
              <ToolCardHeader title="AES 参数" icon={KeyRound} meta={`${aes.mode} · ${aes.keySize} 位`} />
              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-2">
                  <span className={SECTION_LABEL}>加密模式</span>
                  <Select
                    value={aes.mode}
                    onChange={(mode) => setAes({ ...aes, mode })}
                    options={AES_MODES.map((mode) => ({ value: mode, label: mode }))}
                  />
                  <p className={META}>
                    {aes.mode === 'GCM' ? '带完整性校验，推荐' : '经典模式，无校验'}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={SECTION_LABEL}>密钥长度</span>
                  <Select
                    value={String(aes.keySize)}
                    onChange={(value) => setAes({ ...aes, keySize: Number(value) as AesKeySize })}
                    options={AES_KEY_SIZES.map((size) => ({ value: String(size), label: `${size} 位` }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <span className={SECTION_LABEL}>密钥来源</span>
                  <Segmented
                    value={aes.keySource}
                    onChange={(keySource: AesKeySource) => setAes({ ...aes, keySource })}
                    options={[
                      { value: 'hex' as const, label: '十六进制' },
                      { value: 'passphrase' as const, label: '口令派生' },
                    ]}
                  />
                </div>

                <div className="md:col-span-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className={SECTION_LABEL}>
                      {aes.keySource === 'hex' ? '密钥（十六进制）' : '口令'}
                    </span>
                    {aes.keySource === 'hex' && (
                      <button
                        onClick={() => setAes({ ...aes, key: randomHexKey(aes.keySize) })}
                        className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        随机生成一个
                      </button>
                    )}
                  </div>
                  <textarea
                    value={aes.key}
                    onChange={(e) => setAes({ ...aes, key: e.target.value })}
                    placeholder={
                      aes.keySource === 'hex'
                        ? `需要 ${aes.keySize / 4} 个十六进制字符`
                        : '任意口令，会用 PBKDF2 派生密钥'
                    }
                    rows={2}
                    className="w-full bg-slate-50/70 dark:bg-dark-hover/40 border border-slate-200/70 dark:border-dark-border rounded-lg px-3 py-2 resize-none outline-none font-mono text-[12px] leading-5 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-brand-400"
                  />
                  {aesKeyMissing && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      {aes.keySource === 'hex' ? '还没填密钥' : '还没填口令'}，填了才能加密
                    </p>
                  )}
                </div>
              </div>
            </ToolCard>
          )}

          <ToolCard className="flex-1 min-h-[150px]">
            <ToolCardHeader
              title="解析结果"
              sublabel="RESULT"
              // meta 自带一层灰底，这里只能传纯文本；再套 ToolTag 会双层叠色
              meta={isAes ? `AES-${aes.mode}` : currentType?.name}
              actions={
                <Tooltip content="复制结果">
                  <button
                    type="button"
                    onClick={() => void copyOutput()}
                    disabled={!output}
                    className={iconButtonClass('brand')}
                  >
                    <Copy size={15} />
                  </button>
                </Tooltip>
              }
            />
            <div className="flex-1 min-h-0 p-4 flex flex-col">
              <div className={BODY_OUTPUT}>
                {output || (
                  <span className="text-slate-300 dark:text-slate-600 not-italic">
                    转换结果将在此呈现…
                  </span>
                )}
              </div>
            </div>
            <ToolCardFooter>
              <span className="font-mono">{output.length} 字符</span>
              <span className={META}>点左侧方式即出结果</span>
            </ToolCardFooter>
          </ToolCard>
        </div>
      </div>
      </ToolShell>

      {/* 底部动作条：ToolShell 之外、外层 flex 里的兄弟节点，独占一条高度 */}
      <div className="shrink-0 px-4 md:px-6 py-3">
        <ToolActionBar
          info={
            <>
              <ArrowDown size={13} className="text-brand-500" />
              将按
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                {isAes ? `AES-${aes.mode}` : currentType?.name}
              </span>
              {isAes
                ? direction === 'encode'
                  ? '加密，生成 IV:密文'
                  : '解密，请贴入 IV:密文'
                : direction === 'encode'
                  ? '编码，把原文转成该格式'
                  : '解码，还原为原文'}
            </>
          }
        >
          {/* 按钮只执行当前选中的方向，跟左栏高亮的是同一件事 */}
          <button
            type="button"
            onClick={() => run(direction)}
            disabled={!canRun}
            className={BTN.primary}
          >
            <span>
              {running
                ? '处理中…'
                : isAes
                  ? direction === 'encode'
                    ? '加密'
                    : '解密'
                  : direction === 'encode'
                    ? '编码'
                    : '解码'}
            </span>
          </button>
        </ToolActionBar>
      </div>
    </div>
  )
}
