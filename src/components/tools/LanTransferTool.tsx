import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, FileText, FileWarning, FolderOpen, Plus, RefreshCw, Send, Trash2, Wifi } from 'lucide-react'
import { CopyButton, META, Segmented, Switch, ToolBadge, ToolCard, ToolCardHeader, ToolEmpty, ToolNotice, ToolShell, ToolTag, iconButtonClass, type SegmentOption } from '../ui'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'

type Side = 'inbox' | 'outbox'
const SIDE_OPTIONS: SegmentOption<Side>[] = [
  { value: 'inbox', label: '收到的' },
  { value: 'outbox', label: '发给手机' },
]

/** 危险操作要点两次：第一次点击变成「确定」，几秒内不再点就撤回 */
function ArmedButton({ label, confirmLabel, onConfirm, children, className }: { label: string; confirmLabel: string; onConfirm: () => void; children: ReactNode; className: string }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  const click = () => {
    if (!armed) {
      setArmed(true)
      timer.current = window.setTimeout(() => setArmed(false), 2500)
      return
    }
    if (timer.current !== null) window.clearTimeout(timer.current)
    setArmed(false)
    onConfirm()
  }
  return (
    <button type="button" onClick={click} aria-label={label} className={`${className} ${armed ? 'bg-rose-500 text-white hover:bg-rose-600' : ''}`}>
      {armed ? <Check size={13} strokeWidth={2.6} /> : children}
      {armed && <span>{confirmLabel}</span>}
    </button>
  )
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function InboxRow({ entry, thumb, fresh, onCopy, onReveal, onDelete }: { entry: LanInboxEntry; thumb: string | null | undefined; fresh: boolean; onCopy: () => void; onReveal: () => void; onDelete: () => void }) {
  const isImage = entry.kind === 'file' && entry.mime.startsWith('image/')
  return (
    <li className={`group flex items-center gap-3 rounded-xl border border-slate-200/70 px-3 py-2.5 dark:border-dark-border ${fresh ? 'fe-rise ring-2 ring-brand-400/60' : ''}`}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-dark-hover">
        {isImage && thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} /> : entry.kind === 'text' ? <FileText size={16} className="text-slate-400" /> : <FileText size={16} className="text-slate-400" />}
      </div>
      <div className="min-w-0 flex-1">
        {entry.kind === 'file' ? (
          <>
            <p className="truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">{entry.name}</p>
            <p className={`${META} font-mono tabular-nums`}>{formatSize(entry.size)} · {formatTime(entry.receivedAt)}</p>
          </>
        ) : (
          <>
            <p className="line-clamp-2 break-words text-[12.5px] text-slate-800 dark:text-slate-100">{entry.text}</p>
            <p className={`${META} font-mono tabular-nums`}>{entry.text.length} 字 · {formatTime(entry.receivedAt)}</p>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content={entry.kind === 'text' ? '复制文字' : '复制到剪贴板'}>
          <button type="button" onClick={onCopy} className={iconButtonClass('brand')}><Copy size={14} /></button>
        </Tooltip>
        {entry.kind === 'file' && (
          <Tooltip content="在文件夹中显示">
            <button type="button" onClick={onReveal} className={iconButtonClass('neutral')}><FolderOpen size={14} /></button>
          </Tooltip>
        )}
        <ArmedButton label="删除" confirmLabel="确定" onConfirm={onDelete} className="inline-flex h-7 items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold text-slate-400 transition-colors hover:text-rose-600">
          <Trash2 size={14} />
        </ArmedButton>
      </div>
    </li>
  )
}

export default function LanTransferTool() {
  const api = window.electronAPI
  const available = !!api?.lanStart
  const { showToast } = useToast()

  const [side, setSide] = useState<Side>('inbox')
  const [status, setStatus] = useState<LanStatus>({ running: false, url: null })
  const [qr, setQr] = useState('')
  const [starting, setStarting] = useState(false)
  const [autoCopy, setAutoCopy] = useState(true)
  const [inbox, setInbox] = useState<LanInboxEntry[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string | null | undefined>>({})
  const [freshId, setFreshId] = useState<string | null>(null)
  const [outbox, setOutbox] = useState<LanOutboxEntry[]>([])
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)

  // 进入工具就开启服务，离开就停止；发出去的列表只属于这一次会话
  useEffect(() => {
    if (!available || !api) return
    let alive = true
    setStarting(true)
    api.lanStart!().then((next) => alive && setStatus(next)).catch(() => alive && showToast('无法开启局域网服务', 'error')).finally(() => alive && setStarting(false))
    api.lanInboxList?.().then((list) => alive && setInbox(list)).catch(() => {})
    api.lanOutboxList?.().then((list) => alive && setOutbox(list)).catch(() => {})
    const off = api.onLanInboxReceived?.((entry) => {
      if (!alive) return
      setInbox((prev) => [entry, ...prev.filter((item) => item.id !== entry.id)])
      setFreshId(entry.id)
      showToast('收到一条新内容')
    })
    return () => {
      alive = false
      off?.()
      void api.lanStop?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available])

  useEffect(() => {
    if (!freshId) return
    const timer = window.setTimeout(() => setFreshId(null), 1200)
    return () => window.clearTimeout(timer)
  }, [freshId])

  useEffect(() => {
    api?.lanSetAutoCopy?.(autoCopy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCopy, available])

  useEffect(() => {
    if (!status.url) return setQr('')
    let cancelled = false
    QRCode.toDataURL(status.url, { width: 200, margin: 1, errorCorrectionLevel: 'M' }).then((url) => !cancelled && setQr(url)).catch(() => !cancelled && setQr(''))
    return () => { cancelled = true }
  }, [status.url])

  // 图片缩略图按需取一次
  useEffect(() => {
    if (!api?.lanInboxThumb) return
    inbox.forEach((entry) => {
      if (entry.kind !== 'file' || !entry.mime.startsWith('image/') || entry.id in thumbs) return
      setThumbs((prev) => ({ ...prev, [entry.id]: undefined }))
      api.lanInboxThumb!(entry.id).then((url) => setThumbs((prev) => ({ ...prev, [entry.id]: url }))).catch(() => setThumbs((prev) => ({ ...prev, [entry.id]: null })))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox])

  const regenerate = async () => {
    if (!api?.lanStop || !api.lanStart) return
    setStarting(true)
    try {
      await api.lanStop()
      setStatus(await api.lanStart())
      showToast('已生成新的二维码，旧码已失效')
    } catch {
      showToast('重新生成失败', 'error')
    } finally {
      setStarting(false)
    }
  }

  const copyInbox = async (entry: LanInboxEntry) => {
    const ok = await api?.lanInboxCopy?.(entry.id)
    showToast(ok ? (entry.kind === 'text' ? '已复制文字' : '已复制到剪贴板') : '这条内容无法复制', ok ? 'default' : 'error')
  }

  const deleteInbox = async (id: string) => {
    if (await api?.lanInboxDelete?.(id)) {
      setInbox((prev) => prev.filter((item) => item.id !== id))
      setThumbs((prev) => { const next = { ...prev }; delete next[id]; return next })
    }
  }

  const addFiles = async (paths: string[]) => {
    if (paths.length === 0 || !api?.lanOutboxAddFiles) return
    setOutbox(await api.lanOutboxAddFiles(paths))
  }

  const sendText = async () => {
    const value = draft.trim()
    if (!value || !api?.lanOutboxAddText) return
    setOutbox(await api.lanOutboxAddText(value))
    setDraft('')
  }

  const copyOutboxText = async (text: string) => {
    const ok = await copyText(text)
    showToast(ok ? '已复制' : '复制失败', ok ? 'default' : 'error')
  }

  const fileOutbox = useMemo(() => outbox.filter((item): item is Extract<LanOutboxEntry, { kind: 'file' }> => item.kind === 'file'), [outbox])

  if (!available) {
    return (
      <ToolShell icon={ArrowUpFromLine} title="局域网互传" subtitle="仅桌面版可用">
        <ToolNotice tone="info" icon={FileWarning}>局域网互传需要运行在 devNotes 桌面版中。</ToolNotice>
      </ToolShell>
    )
  }

  return (
    <ToolShell
      icon={ArrowUpFromLine}
      title="局域网互传"
      subtitle="手机扫一次码，文件、图片、文字双向传"
      badge={status.running ? <ToolBadge tone="emerald">已连接</ToolBadge> : <ToolBadge tone="amber">未开启</ToolBadge>}
    >
      <div className="tool-cascade grid grid-cols-1 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* 左：二维码 */}
        <ToolCard fill={false}>
          <ToolCardHeader title="扫码连接" icon={Wifi} />
          <div className="flex flex-col items-center gap-3.5 p-4">
            <div className="flex h-[228px] w-[228px] items-center justify-center rounded-2xl bg-white p-2 ring-1 ring-slate-200/70">
              {qr ? <img src={qr} alt="连接二维码" width={212} height={212} className="block" /> : <span className="text-[12px] text-slate-400">{starting ? '正在开启…' : '没有可用的局域网地址'}</span>}
            </div>
            {status.url ? (
              <div className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-dark-bg/40">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">{status.url}</span>
                <CopyButton value={status.url} label="复制地址" size={13} />
              </div>
            ) : (
              <ToolNotice tone="warn" icon={FileWarning} className="w-full">没有找到可用的局域网 IP，请确认已连上 Wi-Fi。</ToolNotice>
            )}
            <p className={`${META} text-center leading-relaxed`}>手机需与电脑连接同一 Wi‑Fi。<br />手机页面里有「发给电脑」和「从电脑获取」两栏。</p>
            <button type="button" onClick={() => void regenerate()} disabled={starting} className="tool-button-secondary h-8 disabled:opacity-40">
              <RefreshCw size={14} className={starting ? 'animate-spin' : ''} />
              <span>重新生成二维码</span>
            </button>
          </div>
          <div className="border-t border-slate-100 px-4 py-3 dark:border-dark-border">
            <Switch checked={autoCopy} onChange={setAutoCopy} label="收到后自动复制" description="图片与文字到电脑后直接进剪贴板" />
          </div>
        </ToolCard>

        {/* 右：两个方向 */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Segmented value={side} options={SIDE_OPTIONS} onChange={setSide} />
            <span className={META}>{side === 'inbox' ? `${inbox.length} 条` : `${outbox.length} 条`}</span>
          </div>

          {side === 'inbox' ? (
            <ToolCard fill={false}>
              <ToolCardHeader title="手机发来的" icon={ArrowDownToLine} sublabel="图片、文件、文字" actions={inbox.length > 0 ? (
                <ArmedButton label="清空" confirmLabel="确定清空" onConfirm={() => { void api?.lanInboxClear?.(); setInbox([]); setThumbs({}) }} className="tool-button-secondary h-7 px-2.5 text-[11px] text-rose-500 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10">
                  <Trash2 size={12} /> 清空
                </ArmedButton>
              ) : undefined} />
              {inbox.length === 0 ? (
                <ToolEmpty icon={ArrowDownToLine} title="还没有收到内容" hint="用手机扫左边的二维码，选择文件或发一段文字，会出现在这里" className="min-h-[300px]" />
              ) : (
                <ul className="flex flex-col gap-2 p-3.5">
                  {inbox.map((entry) => (
                    <InboxRow
                      key={entry.id}
                      entry={entry}
                      thumb={thumbs[entry.id]}
                      fresh={freshId === entry.id}
                      onCopy={() => void copyInbox(entry)}
                      onReveal={() => void api?.lanInboxReveal?.(entry.id)}
                      onDelete={() => void deleteInbox(entry.id)}
                    />
                  ))}
                </ul>
              )}
            </ToolCard>
          ) : (
            <>
              <ToolCard fill={false}>
                <ToolCardHeader title="发送文字" icon={Send} sublabel="验证码、链接、Token 等，手机上可一键复制" />
                <div className="flex flex-col gap-2.5 p-3.5">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendText()
                    }}
                    placeholder="输入或粘贴要发给手机的内容…（⌘ / Ctrl + Enter 发送）"
                    rows={3}
                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] text-slate-800 outline-none focus:border-brand-400 dark:border-dark-border dark:bg-dark-panel dark:text-slate-100"
                  />
                  <div className="flex justify-end">
                    <button type="button" onClick={() => void sendText()} disabled={!draft.trim()} className="tool-button-primary h-8 px-4 disabled:opacity-40">
                      <Send size={14} />
                      <span>发给手机</span>
                    </button>
                  </div>
                </div>
              </ToolCard>

              <ToolCard fill={false}>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDragging(false) }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    void addFiles(api?.filePathsFromFiles?.(Array.from(e.dataTransfer.files ?? [])) ?? [])
                  }}
                  className={`m-3.5 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/50 dark:bg-brand-500/10' : 'border-slate-200 dark:border-dark-border'}`}
                >
                  <Plus size={18} className="text-slate-400" />
                  <p className="text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">把文件拖到这里，发给手机</p>
                  <button type="button" onClick={async () => setOutbox(await api!.lanOutboxPick!())} className="text-[11.5px] font-semibold text-brand-600 hover:underline dark:text-brand-400">或点击选择文件</button>
                </div>
                <ToolCardHeader title="待手机获取" icon={ArrowUpFromLine} meta={outbox.length > 0 ? `${outbox.length} 条` : undefined} actions={outbox.length > 0 ? (
                  <ArmedButton label="清空" confirmLabel="确定清空" onConfirm={() => { void api?.lanOutboxClear?.(); setOutbox([]) }} className="tool-button-secondary h-7 px-2.5 text-[11px] text-rose-500 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10">
                    <Trash2 size={12} /> 清空
                  </ArmedButton>
                ) : undefined} />
                {outbox.length === 0 ? (
                  <p className={`${META} px-4 py-6 text-center`}>还没有发给手机的内容</p>
                ) : (
                  <ul className="flex flex-col gap-2 p-3.5">
                    {outbox.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200/70 px-3 py-2.5 dark:border-dark-border">
                        <div className="min-w-0 flex-1">
                          {item.kind === 'file' ? (
                            <>
                              <p className="truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">{item.name}</p>
                              <p className={`${META} font-mono`}>{formatSize(item.size)}</p>
                            </>
                          ) : (
                            <p className="line-clamp-2 break-words text-[12.5px] text-slate-800 dark:text-slate-100">{item.text}</p>
                          )}
                        </div>
                        <ToolTag tone="brand">待获取</ToolTag>
                        {item.kind === 'text' && (
                          <Tooltip content="复制文字">
                            <button type="button" onClick={() => void copyOutboxText(item.text)} className={iconButtonClass('brand')}><Copy size={14} /></button>
                          </Tooltip>
                        )}
                        <Tooltip content="移除">
                          <button type="button" onClick={async () => setOutbox(await api!.lanOutboxRemove!(item.id))} className={iconButtonClass('danger')}><Trash2 size={14} /></button>
                        </Tooltip>
                      </li>
                    ))}
                  </ul>
                )}
                {fileOutbox.length > 0 && <p className={`${META} px-4 pb-3`}>文件可在手机页面「从电脑获取」里下载。</p>}
              </ToolCard>
            </>
          )}
        </div>
      </div>
    </ToolShell>
  )
}
