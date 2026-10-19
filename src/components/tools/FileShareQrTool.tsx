import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Download, FilePlus, FileWarning, Share2, Trash2 } from 'lucide-react'
import {
  BTN,
  META,
  ToolActionBar,
  ToolBadge,
  ToolCard,
  ToolCardFooter,
  ToolCardHeader,
  ToolNotice,
  ToolShell,
  CopyButton,
} from '../ui'
import { useToast } from '../ui/Toast'
import Tooltip from '../ui/Tooltip'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function ShareCard({ item, onRemove }: { item: FileShareItem; onRemove: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    if (!item.url) {
      setQrDataUrl('')
      return
    }
    let cancelled = false
    QRCode.toDataURL(item.url, { width: 180, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [item.url])

  const downloadQr = () => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `${item.name}-qrcode.png`
    a.click()
  }

  return (
    <ToolCard fill={false}>
      <ToolCardHeader
        title={item.name}
        icon={Share2}
        meta={formatSize(item.size)}
        actions={
          <>
            <CopyButton value={item.url ?? ''} disabled={!item.url} label="复制下载地址" />
            <Tooltip content="取消分享">
              <button
                type="button"
                onClick={onRemove}
                className="text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 p-1"
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </>
        }
      />

      <div className="p-4 flex gap-4 items-start">
        <div className="shrink-0 rounded-xl bg-white p-2 ring-1 ring-slate-200/60">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`${item.name} 下载二维码`} width={160} height={160} className="block" />
          ) : (
            <div className="flex h-[160px] w-[160px] items-center justify-center text-[11px] text-slate-400">
              无地址
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 flex flex-col gap-3">
          {item.url ? (
            <p className="font-mono text-[12px] leading-6 text-slate-700 dark:text-slate-200 break-all select-text">
              {item.url}
            </p>
          ) : (
            <ToolNotice tone="error" icon={FileWarning}>
              没有找到可用的局域网 IP，请确认电脑已连接网络后重新添加。
            </ToolNotice>
          )}

        </div>
      </div>

      <ToolCardFooter>
        <span className={META}>{item.size.toLocaleString()} 字节</span>
        <button
          type="button"
          onClick={downloadQr}
          disabled={!qrDataUrl}
          className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          <span className="inline-flex items-center gap-1">
            <Download size={12} />
            保存二维码图片
          </span>
        </button>
      </ToolCardFooter>
    </ToolCard>
  )
}

/**
 * 文件局域网分享：选 apk / ipa 等文件，应用内置小服务器对局域网提供下载，
 * 每个文件生成一个二维码，手机扫码即可下载。
 */
export default function FileShareQrTool() {
  const available = typeof window !== 'undefined' && !!window.electronAPI?.fileSharePick
  const [items, setItems] = useState<FileShareItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { showToast } = useToast()

  useEffect(() => {
    if (!available) return
    window.electronAPI?.fileShareList?.().then(setItems).catch(() => setItems([]))
  }, [available])

  const pickFiles = async () => {
    if (!window.electronAPI?.fileSharePick) return
    setBusy(true)
    setError('')
    try {
      setItems(await window.electronAPI.fileSharePick())
    } catch (err) {
      setError('添加失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  const removeFile = async (id: string) => {
    if (!window.electronAPI?.fileShareRemove) return
    try {
      setItems(await window.electronAPI.fileShareRemove(id))
    } catch {
      showToast('取消分享失败', 'error')
    }
  }

  if (!available) {
    return (
      <ToolShell icon={Share2} title="文件扫码分享" subtitle="仅桌面版可用">
        <ToolNotice tone="info" icon={FileWarning}>
          文件分享需要运行在 devNotes 桌面版中，网页版无法提供局域网下载。
        </ToolNotice>
      </ToolShell>
    )
  }

  return (
    <ToolShell
      icon={Share2}
      title="文件扫码分享"
      subtitle="选择 apk，手机扫码即可通过局域网下载"
      badge={items.length > 0 ? <ToolBadge tone="brand">{items.length} 个文件</ToolBadge> : undefined}
      actions={
        <button onClick={pickFiles} disabled={busy} className="tool-button-primary h-8 px-5">
          <FilePlus size={15} />
          <span>{busy ? '添加中…' : '添加文件'}</span>
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <ToolNotice tone="info" icon={Share2}>
          手机需与电脑连接同一 Wi‑Fi。Windows 首次运行可能弹出防火墙提示，请允许访问。关闭全部分享后服务会自动停止。
        </ToolNotice>

        {error && (
          <ToolNotice tone="error" icon={FileWarning}>
            {error}
          </ToolNotice>
        )}

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 dark:border-dark-border py-16">
            <Share2 size={24} className="text-slate-300 dark:text-slate-600" />
            <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">还没有分享的文件</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-600">点击右上角「添加文件」选择 apk</p>
          </div>
        ) : (
          <div className="tool-cascade grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            {items.map((item) => (
              <ShareCard key={item.id} item={item} onRemove={() => void removeFile(item.id)} />
            ))}
          </div>
        )}
      </div>

      <ToolActionBar info="二维码内容为局域网地址，换网络后需重新添加">
        <button onClick={pickFiles} disabled={busy} className={BTN.primary}>
          <FilePlus size={14} />
          <span>添加文件</span>
        </button>
      </ToolActionBar>
    </ToolShell>
  )
}
