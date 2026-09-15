import { useState, useEffect } from 'react'
import type { ComponentType } from 'react'
import {
  CloudUpload,
  CloudDownload,
  Loader2,
  Copy,
  Check,
  Shield,
  KeyRound,
  ExternalLink,
  Lock,
  Eye,
  EyeOff,
  RotateCcw,
  Zap,
  History,
  Clock,
  Trash2,
  Sparkles,
  Archive,
  FileText,
} from 'lucide-react'
import { useNotes } from '../../context/NotesContext'
import {
  CLOUDFLARE_WORKER_SCRIPT,
  type CloudflareSyncConfig,
  type BackupSnapshot,
} from '../../utils/cloudflareSync'
import { useContextMenu } from '../ui/ContextMenu'
import { useToast } from '../ui/Toast'
import { copyText } from '../../utils/clipboard'
import Tooltip from '../ui/Tooltip'
import { NoteCard, Switch } from '../ui'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

/** NoteCard 的图标位不接受额外 props，转圈状态只能靠包一层常量组件带进去 */
function SyncingIcon({ className }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className ?? ''}`} />
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  return `${day} 天前`
}

/** 全局设置 · 云同步：Cloudflare 备份/同步/快照面板（自 CloudflareSyncModal 迁移而来） */
export default function CloudflareSyncPanel() {
  const {
    notes,
    cfConfig,
    cfSyncStatus,
    cfSyncMessage,
    updateCfConfig,
    triggerCfTest,
    triggerCfBackup,
    triggerCfPull,
    snapshots,
    restoreSnapshot,
    deleteSnapshot,
    clearAllSnapshots,
    createManualSnapshot,
  } = useNotes()

  const [activeTab, setActiveTab] = useState<'console' | 'snapshots' | 'config' | 'deploy'>('console')
  const [copied, setCopied] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // 表单本地暂存编辑状态
  const [formConfig, setFormConfig] = useState<CloudflareSyncConfig>(cfConfig)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [isOperating, setIsOperating] = useState(false)
  const [snapshotMsg, setSnapshotMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const { openContextMenu } = useContextMenu()
  const { showToast } = useToast()

  // 当外部配置改变时同步到本地表单
  useEffect(() => {
    setFormConfig(cfConfig)
  }, [cfConfig])

  // 复制 Worker 代码
  const handleCopyWorkerScript = async () => {
    try {
      await navigator.clipboard.writeText(CLOUDFLARE_WORKER_SCRIPT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  // 测试连接
  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await triggerCfTest(formConfig)
      setTestResult(res)
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || '测试失败' })
    } finally {
      setIsTesting(false)
    }
  }

  // 保存设置
  const handleSaveConfig = async () => {
    await updateCfConfig(formConfig)
    setTestResult({ ok: true, message: '配置已保存并生效' })
  }

  // 触发备份
  const handleBackup = async () => {
    setIsOperating(true)
    try {
      await triggerCfBackup()
    } finally {
      setIsOperating(false)
    }
  }

  // 触发合并拉取
  const handlePullMerge = async () => {
    setIsOperating(true)
    try {
      await triggerCfPull('merge')
    } finally {
      setIsOperating(false)
    }
  }

  // 触发单向覆盖拉取
  const handlePullOverwrite = async () => {
    const ok = window.confirm('警告：此操作将用 Cloudflare 云端备份完全覆盖本地全部笔记，确定继续吗？')
    if (!ok) return
    setIsOperating(true)
    try {
      await triggerCfPull('overwrite')
    } finally {
      setIsOperating(false)
    }
  }

  // 手动创建快照
  const handleCreateSnapshot = async () => {
    setIsOperating(true)
    try {
      await createManualSnapshot()
      setSnapshotMsg({ ok: true, text: '手动备份快照创建成功！' })
      setTimeout(() => setSnapshotMsg(null), 3000)
    } catch (err: any) {
      setSnapshotMsg({ ok: false, text: err?.message || '快照创建失败' })
    } finally {
      setIsOperating(false)
    }
  }

  // 恢复快照回滚
  const handleRestore = async (snap: BackupSnapshot) => {
    const timeStr = new Date(snap.timestamp).toLocaleString()
    const ok = window.confirm(
      `确定恢复至 [${timeStr}] 的历史快照吗？\n\n🛡️ 安全保护机制：系统会在执行恢复前自动为您当前的数据生成一次【回滚保护快照】，即使误操作也可随时一键回退。`
    )
    if (!ok) return

    setIsOperating(true)
    try {
      const success = await restoreSnapshot(snap.id)
      if (success) {
        setSnapshotMsg({ ok: true, text: `已成功恢复至快照版本 (${timeStr})` })
        setTimeout(() => setSnapshotMsg(null), 3500)
      } else {
        setSnapshotMsg({ ok: false, text: '恢复快照失败，请稍后重试' })
      }
    } finally {
      setIsOperating(false)
    }
  }

  // 删除单条快照
  const handleDeleteSnapshot = async (id: string) => {
    if (!window.confirm('确定删除该历史快照吗？')) return
    await deleteSnapshot(id)
  }

  // 快照项的右键菜单:恢复 / 复制标题清单 / 删除
  const handleSnapshotContextMenu = (e: React.MouseEvent, snap: BackupSnapshot) => {
    const titles = (snap.noteTitles || []).join('\n')
    openContextMenu(e, [
      {
        id: 'snap-restore',
        label: '回滚恢复',
        icon: <RotateCcw className="w-3.5 h-3.5" />,
        onSelect: () => handleRestore(snap),
      },
      {
        id: 'snap-copy-titles',
        label: '复制笔记标题',
        icon: <Copy className="w-3.5 h-3.5" />,
        disabled: !titles,
        onSelect: async () => {
          const ok = await copyText(titles)
          showToast(ok ? '已复制标题清单' : '复制失败', ok ? 'default' : 'error')
        },
      },
      { id: 'snap-sep', separator: true },
      {
        id: 'snap-delete',
        label: '删除此快照',
        icon: <Trash2 className="w-3.5 h-3.5" />,
        danger: true,
        onSelect: () => handleDeleteSnapshot(snap.id),
      },
    ])
  }

  // 清空全部快照
  const handleClearAllSnapshots = async () => {
    if (!window.confirm('危险操作：确定清空全部本地历史快照备份吗？此操作不可逆！')) return
    await clearAllSnapshots()
    setSnapshotMsg({ ok: true, text: '已清空全部本地快照记录' })
    setTimeout(() => setSnapshotMsg(null), 3000)
  }

  const isConfigured = Boolean(
    cfConfig.enabled &&
      (cfConfig.mode === 'worker'
        ? cfConfig.workerUrl
        : cfConfig.kvAccountId && cfConfig.kvNamespaceId && cfConfig.kvApiToken)
  )

  const TABS: {
    id: 'console' | 'snapshots' | 'config' | 'deploy'
    label: string
    icon: ComponentType<{ className?: string }>
  }[] = [
    { id: 'console', label: '同步控制台', icon: Zap },
    { id: 'snapshots', label: '自动备份与快照', icon: History },
    { id: 'config', label: '接入设置', icon: KeyRound },
    { id: 'deploy', label: 'Worker 部署指南', icon: ExternalLink },
  ]

  return (
    <div className="space-y-4">
      {/* 连接状态条 */}
      <div
        className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border transition-colors ${
          isConfigured
            ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/30'
            : 'bg-slate-50/70 dark:bg-dark-sidebar/50 border-slate-200/70 dark:border-dark-border'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isConfigured ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'
            }`}
          />
          <span
            className={`text-xs font-semibold flex-shrink-0 ${
              isConfigured ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            {isConfigured ? '云端已接入' : '尚未接入云端'}
          </span>
          <span className="text-[11px] text-slate-400 truncate">
            {isConfigured
              ? '笔记变更会自动加密备份到 Cloudflare'
              : '前往「接入设置」填写 Cloudflare 凭据后启用'}
          </span>
        </div>
        <span className="text-[10px] text-slate-400 flex-shrink-0 font-mono">
          {cfConfig.lastSyncTime ? new Date(cfConfig.lastSyncTime).toLocaleString() : '暂无同步记录'}
        </span>
      </div>

      {/* 面板内标签页切换栏：分段胶囊式控制器 */}
      <div className="p-1 bg-slate-100/90 dark:bg-dark-sidebar/90 rounded-xl border border-slate-200/70 dark:border-dark-border flex gap-1 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-fit flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-all active:scale-[0.98] ${
                active
                  ? 'bg-white dark:bg-dark-panel text-slate-900 dark:text-white font-semibold shadow-2xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Icon
                className={`w-3.5 h-3.5 ${
                  active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400'
                }`}
              />
              <span>{tab.label}</span>
              {tab.id === 'snapshots' && snapshots.length > 0 && (
                <span
                  className={`ml-0.5 px-1.5 text-[10px] font-mono rounded-full ${
                    active
                      ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300'
                      : 'bg-slate-200/70 text-slate-500 dark:bg-dark-hover dark:text-slate-400'
                  }`}
                >
                  {snapshots.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 标签页内容 */}
      <div className="space-y-5">
        {/* TAB 1: 同步与备份控制台 */}
        {activeTab === 'console' && (
          <div className="space-y-5">
            {/* 状态总览卡片：现代纯净指标看板 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 bg-white dark:bg-dark-panel/90 border border-slate-200/80 dark:border-dark-border rounded-2xl shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-xl bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 flex items-center justify-center shadow-2xs">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      本地文档
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">已就绪</span>
                </div>
                <div className="flex items-baseline gap-1.5 pt-0.5">
                  <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white tracking-tight">
                    {notes.length}
                  </span>
                  <span className="text-xs text-slate-400">篇</span>
                </div>
              </div>

              <div
                onClick={() => setActiveTab('snapshots')}
                className="p-4 bg-white dark:bg-dark-panel/90 border border-slate-200/80 dark:border-dark-border rounded-2xl shadow-2xs cursor-pointer hover:border-brand-400 dark:hover:border-brand-600 hover:shadow-xs active:scale-[0.99] transition-all group space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center shadow-2xs">
                      <History className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      备份快照
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-brand-600 dark:text-brand-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                    查看 ↗
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5 pt-0.5">
                  <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white tracking-tight">
                    {snapshots.length}
                  </span>
                  <span className="text-xs text-slate-400">个历史版本</span>
                </div>
              </div>
            </div>

            {/* 操作核心动作区 */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                同步操作动作
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 推送到云端 */}
                <div className="p-4 border border-slate-200/80 dark:border-dark-border rounded-xl bg-white dark:bg-dark-sidebar/40 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-white text-xs">
                      <CloudUpload className="w-4 h-4 text-brand-500" />
                      <span>推送备份至 Cloudflare</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      将本地全部 {notes.length} 篇笔记加密打包推送到云端空间作为最新快照。
                    </p>
                  </div>
                  <button
                    disabled={isOperating || !isConfigured}
                    onClick={handleBackup}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white text-xs font-semibold rounded-xl shadow-xs shadow-brand-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isOperating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CloudUpload className="w-3.5 h-3.5" />
                    )}
                    <span>立即备份到云端</span>
                  </button>
                </div>

                {/* 从云端智能拉取合并 */}
                <div className="p-4 border border-slate-200/80 dark:border-dark-border rounded-xl bg-white dark:bg-dark-sidebar/40 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-white text-xs">
                      <CloudDownload className="w-4 h-4 text-emerald-500" />
                      <span>智能合并云端修改</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      对比云端与本地时间戳，合流新增笔记并保留较新修改，安全无损。
                    </p>
                  </div>
                  <button
                    disabled={isOperating || !isConfigured}
                    onClick={handlePullMerge}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-slate-100 hover:bg-slate-200/80 dark:bg-dark-hover dark:hover:bg-slate-700/60 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-dark-border text-xs font-semibold rounded-xl shadow-2xs transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isOperating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CloudDownload className="w-3.5 h-3.5" />
                    )}
                    <span>拉取并合并</span>
                  </button>
                </div>
              </div>

              {/* 危险操作区：云端单向覆盖 */}
              <NoteCard
                variant="danger"
                icon={RotateCcw}
                action={
                  <button
                    disabled={isOperating || !isConfigured}
                    onClick={handlePullOverwrite}
                    className="px-2.5 py-1 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800/60 rounded-lg text-xs font-medium transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    从云端覆盖本地
                  </button>
                }
              >
                <span className="font-semibold text-rose-900 dark:text-rose-200 block text-xs mb-0.5">
                  以云端完全覆盖重置本地
                </span>
                <span className="text-[11px] text-rose-800/80 dark:text-rose-300/80">
                  将本地所有笔记清空并强制对齐云端备份版本，请谨慎执行。
                </span>
              </NoteCard>
            </div>

            {/* 实时状态提示 */}
            {cfSyncMessage && (
              <NoteCard
                variant={
                  cfSyncStatus === 'error'
                    ? 'danger'
                    : cfSyncStatus === 'success'
                      ? 'success'
                      : 'warning'
                }
                icon={cfSyncStatus === 'syncing' ? SyncingIcon : undefined}
              >
                <span className="truncate">{cfSyncMessage}</span>
              </NoteCard>
            )}

            {/* 自动化策略开关 */}
            <div className="border-t border-slate-100 dark:border-dark-border pt-4 space-y-3">
              <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                自动化备份策略
              </h4>

              <div className="space-y-2.5">
                <div className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sidebar/40 space-y-3 shadow-2xs">
                  <Switch
                    checked={Boolean(cfConfig.autoBackupEnabled)}
                    onChange={(checked) => updateCfConfig({ autoBackupEnabled: checked })}
                    label={
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                        <span>后台周期性自动备份</span>
                      </span>
                    }
                    description="按固定时间间隔在后台自动生成多版本快照并安全推送至云端存储"
                  />

                  {cfConfig.autoBackupEnabled && (
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60 dark:border-dark-border/60">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">备份频率周期:</span>
                      <div className="flex items-center gap-1.5">
                        {[5, 10, 15, 30, 60].map((mins) => (
                          <button
                            key={mins}
                            type="button"
                            onClick={() => updateCfConfig({ autoBackupIntervalMinutes: mins })}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all active:scale-[0.98] ${
                              (cfConfig.autoBackupIntervalMinutes || 10) === mins
                                ? 'bg-brand-600 text-white shadow-xs font-semibold'
                                : 'bg-white dark:bg-dark-panel text-slate-600 dark:text-slate-400 border border-slate-200/80 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-dark-hover shadow-2xs'
                            }`}
                          >
                            {mins} 分钟
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-dark-border bg-white dark:bg-dark-sidebar/40 shadow-2xs">
                  <Switch
                    checked={Boolean(cfConfig.autoSync)}
                    onChange={(checked) => updateCfConfig({ autoSync: checked })}
                    label="内容修改后防抖自动上传与快照"
                    description="停止编辑 3 秒后，自动将笔记静默同步到 Cloudflare 云端并存档"
                  />
                </div>

                <div className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-dark-border bg-white dark:bg-dark-sidebar/40 shadow-2xs">
                  <Switch
                    checked={Boolean(cfConfig.autoSyncOnStartup)}
                    onChange={(checked) => updateCfConfig({ autoSyncOnStartup: checked })}
                    label="软件启动时自动拉取"
                    description="每次打开 devNotes 时，自动拉取云端最新笔记并进行智能合并"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: 自动备份与历史快照 */}
        {activeTab === 'snapshots' && (
          <div className="space-y-4">
            {/* 快照顶层控制栏 */}
            <div className="p-3.5 bg-slate-50 dark:bg-dark-sidebar/60 border border-slate-100 dark:border-dark-border rounded-xl space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                    <Archive className="w-4 h-4 text-brand-500" />
                    <span>多版本历史快照库</span>
                    <span className="text-[10px] font-normal text-slate-400">
                      (当前已存 {snapshots.length} / {cfConfig.maxSnapshots || 20} 个版本)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    支持定时自动备份、编辑触发存档与手动快照，任何时间点均可一键安全回滚。
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    disabled={isOperating}
                    onClick={handleCreateSnapshot}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>创建手动快照</span>
                  </button>

                  {snapshots.length > 0 && (
                    <Tooltip content="清空所有快照">
                      <button
                        type="button"
                        disabled={isOperating}
                        onClick={handleClearAllSnapshots}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg text-xs transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>

              {/* 快照通知信息 */}
              {snapshotMsg && (
                <NoteCard variant={snapshotMsg.ok ? 'success' : 'danger'}>
                  <span>{snapshotMsg.text}</span>
                </NoteCard>
              )}
            </div>

            {/* 快照列表区 */}
            {snapshots.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center text-slate-400 space-y-3 border border-dashed border-slate-200 dark:border-dark-border rounded-xl">
                <div className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-950/40 flex items-center justify-center text-brand-500">
                  <History className="w-6 h-6" />
                </div>
                <div>
                  <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    暂无备份快照记录
                  </h5>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                    当您编辑笔记或达到设定的后台自动备份周期（默认每10分钟）时，系统会自动在此生成历史快照。
                  </p>
                </div>
                <button
                  onClick={handleCreateSnapshot}
                  className="mt-2 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline"
                >
                  立即为当前数据创建首份快照 ↗
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[46vh] overflow-y-auto pr-1">
                {snapshots.map((snap) => {
                  const snapDate = new Date(snap.timestamp)
                  const timeFormatted = snapDate.toLocaleString()
                  const relativeText = formatRelativeTime(snap.timestamp)

                  return (
                    <div
                      key={snap.id}
                      onContextMenu={(e) => void handleSnapshotContextMenu(e, snap)}
                      className="p-3 bg-white dark:bg-dark-sidebar/40 border border-slate-200/80 dark:border-dark-border rounded-xl hover:border-brand-300 dark:hover:border-brand-800 transition-all space-y-2 group shadow-2xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {snap.trigger === 'manual' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40">
                              <Sparkles className="w-2.5 h-2.5" />
                              手动快照
                            </span>
                          )}
                          {snap.trigger === 'auto' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
                              <Clock className="w-2.5 h-2.5" />
                              自动备份
                            </span>
                          )}
                          {snap.trigger === 'rollback_guard' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
                              <Shield className="w-2.5 h-2.5" />
                              回滚前保护
                            </span>
                          )}
                          {snap.trigger === 'startup' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/40">
                              <Zap className="w-2.5 h-2.5" />
                              启动快照
                            </span>
                          )}

                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 font-mono">
                            {timeFormatted}
                          </span>
                          <span className="text-[10px] text-slate-400">({relativeText})</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400 font-mono">
                            {snap.docCount} 篇 · {formatBytes(snap.sizeBytes)}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleRestore(snap)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-brand-600 dark:bg-dark-hover dark:hover:bg-brand-600 text-slate-700 hover:text-white dark:text-slate-200 dark:hover:text-white border border-slate-200/80 dark:border-dark-border hover:border-brand-600 rounded-lg text-[11px] font-semibold transition-all active:scale-[0.98] flex items-center gap-1 shadow-2xs group-hover:border-brand-300"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>回滚恢复</span>
                          </button>

                          <Tooltip content="删除此快照">
                            <button
                              type="button"
                              onClick={() => handleDeleteSnapshot(snap.id)}
                              className="p-1 text-slate-300 hover:text-rose-500 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>
                        </div>
                      </div>

                      {/* 笔记标题预览小药丸 */}
                      {snap.noteTitles && snap.noteTitles.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                          {snap.noteTitles.map((title, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 bg-slate-100 dark:bg-dark-hover text-slate-600 dark:text-slate-400 rounded text-[10px] max-w-[120px] truncate"
                            >
                              {title}
                            </span>
                          ))}
                          {snap.docCount > snap.noteTitles.length && (
                            <span className="text-[10px] text-slate-400">
                              等共 {snap.docCount} 篇
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: 接入设置 */}
        {activeTab === 'config' && (
          <div className="space-y-4">
            {/* 启用主开关 */}
            <div className="p-3.5 bg-slate-50/70 dark:bg-dark-sidebar/50 border border-slate-200/80 dark:border-dark-border rounded-2xl shadow-2xs">
              <Switch
                checked={Boolean(formConfig.enabled)}
                onChange={(checked) => setFormConfig((prev) => ({ ...prev, enabled: checked }))}
                label="开启 Cloudflare 云端同步"
                description="开启后允许本客户端与 Cloudflare 通信进行备份与拉取"
              />
            </div>

            {/* 模式选择 */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                接入通道模式
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setFormConfig((prev) => ({ ...prev, mode: 'worker' }))}
                  className={`p-3 rounded-2xl border text-left transition-all active:scale-[0.99] shadow-2xs ${
                    formConfig.mode === 'worker'
                      ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/25 ring-2 ring-brand-500/15'
                      : 'border-slate-200/80 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-dark-hover/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Cloudflare Worker
                    </span>
                    <span className="text-[9px] font-semibold bg-brand-600 text-white px-1.5 py-px rounded-full flex-shrink-0">
                      推荐
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    只需 Worker 地址与秘钥，免 CORS 限制
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setFormConfig((prev) => ({ ...prev, mode: 'kv' }))}
                  className={`p-3 rounded-2xl border text-left transition-all active:scale-[0.99] shadow-2xs ${
                    formConfig.mode === 'kv'
                      ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/25 ring-2 ring-brand-500/15'
                      : 'border-slate-200/80 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-dark-hover/50'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Cloudflare KV API
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    官方 REST API 直连，免写 Worker 代码
                  </div>
                </button>
              </div>
            </div>

            {/* 根据模式显示不同的输入表单 */}
            {formConfig.mode === 'worker' ? (
              <div className="space-y-3 p-3.5 bg-slate-50/60 dark:bg-dark-sidebar/40 rounded-xl border border-slate-100 dark:border-dark-border">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Worker 部署地址 (URL)
                  </label>
                  <input
                    type="text"
                    value={formConfig.workerUrl}
                    onChange={(e) =>
                      setFormConfig((prev) => ({ ...prev, workerUrl: e.target.value.trim() }))
                    }
                    placeholder="https://fehelper.1024327189.workers.dev"
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 text-slate-800 dark:text-white placeholder:text-slate-400 transition-all shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    同步鉴权秘钥 (Secret Token, 可选)
                  </label>
                  <input
                    type="password"
                    value={formConfig.workerToken}
                    onChange={(e) =>
                      setFormConfig((prev) => ({ ...prev, workerToken: e.target.value.trim() }))
                    }
                    placeholder="在 Worker 环境变量中配置的 SECRET_TOKEN"
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 text-slate-800 dark:text-white placeholder:text-slate-400 font-mono transition-all shadow-2xs"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-3.5 bg-slate-50/60 dark:bg-dark-sidebar/40 rounded-xl border border-slate-100 dark:border-dark-border">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Cloudflare Account ID
                  </label>
                  <input
                    type="text"
                    value={formConfig.kvAccountId}
                    onChange={(e) =>
                      setFormConfig((prev) => ({ ...prev, kvAccountId: e.target.value.trim() }))
                    }
                    placeholder="可在 Cloudflare 域名概述或控制台右下角复制"
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 text-slate-800 dark:text-white placeholder:text-slate-400 font-mono transition-all shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    KV Namespace ID
                  </label>
                  <input
                    type="text"
                    value={formConfig.kvNamespaceId}
                    onChange={(e) =>
                      setFormConfig((prev) => ({ ...prev, kvNamespaceId: e.target.value.trim() }))
                    }
                    placeholder="Cloudflare -> Workers & Pages -> KV 中创建的 ID"
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 text-slate-800 dark:text-white placeholder:text-slate-400 font-mono transition-all shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Cloudflare API Token
                  </label>
                  <input
                    type="password"
                    value={formConfig.kvApiToken}
                    onChange={(e) =>
                      setFormConfig((prev) => ({ ...prev, kvApiToken: e.target.value.trim() }))
                    }
                    placeholder="具备 Workers KV Storage: Edit 权限的 API Token"
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 text-slate-800 dark:text-white placeholder:text-slate-400 font-mono transition-all shadow-2xs"
                  />
                </div>
              </div>
            )}

            {/* 端到端加密 E2EE 设置 */}
            <div className="p-3.5 bg-slate-50/70 dark:bg-dark-sidebar/40 rounded-2xl border border-slate-200/80 dark:border-dark-border space-y-3 shadow-2xs">
              <Switch
                checked={Boolean(formConfig.enableE2EE)}
                onChange={(checked) =>
                  setFormConfig((prev) => ({ ...prev, enableE2EE: checked }))
                }
                label={
                  <span className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-500" />
                    <span>端到端数据加密 (E2EE)</span>
                  </span>
                }
                description="笔记在离开本地前完成 AES-256-GCM 加密，云端无法解密读取"
              />

              {formConfig.enableE2EE && (
                <div className="space-y-2 pt-2.5 border-t border-slate-200/60 dark:border-dark-border/60">
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formConfig.encryptionPassword || ''}
                      onChange={(e) =>
                        setFormConfig((prev) => ({
                          ...prev,
                          encryptionPassword: e.target.value,
                        }))
                      }
                      placeholder="输入端到端加密保护密码（请务必牢记）"
                      className="w-full pl-8 pr-9 py-2 text-xs bg-white dark:bg-dark-panel border border-slate-200/80 dark:border-dark-border rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 text-slate-800 dark:text-white placeholder:text-slate-400 font-mono transition-all shadow-2xs"
                    />
                    <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <Tooltip content={showPassword ? '隐藏密码' : '显示密码'}>
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="p-1 text-slate-400 hover:text-slate-600 absolute right-2 top-1/2 -translate-y-1/2 rounded-md transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </Tooltip>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    采用 Web Crypto AES-256-GCM 算法。请务必牢记该密码，一旦遗失将无法解密还原云端数据。
                  </p>
                </div>
              )}
            </div>

            {/* 测试连接反馈 */}
            {testResult && (
              <NoteCard variant={testResult.ok ? 'success' : 'danger'}>
                <span className="break-all select-text">{testResult.message}</span>
              </NoteCard>
            )}

            {/* 底部按钮栏 */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-dark-border">
              <button
                type="button"
                disabled={isTesting}
                onClick={handleTestConnection}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200/80 dark:bg-dark-hover dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg border border-slate-200/60 dark:border-dark-border transition-all active:scale-[0.98] flex items-center gap-1.5 disabled:opacity-50"
              >
                {isTesting && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>测试连接</span>
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg shadow-xs shadow-brand-500/20 transition-all active:scale-[0.98]"
              >
                保存设置
              </button>
            </div>
          </div>
        )}

        {/* TAB 4: Cloudflare Worker 部署指南 */}
        {activeTab === 'deploy' && (
          <div className="space-y-4">
            <NoteCard variant="warning" title="三步拥有属于你的 Cloudflare 同步服务">
              1. 登录 Cloudflare Dashboard 并在 Workers 中新建一个 Worker。
              <br />
              2. 复制下方脚本粘贴并部署，在 Settings → Variables 中绑定名为{' '}
              <strong className="font-semibold">FEHELPER_KV</strong> 的 KV 空间。
              <br />
              3. 将生成的 Worker 网址填回「接入设置」即可永久免费同步。
            </NoteCard>

            <div className="relative">
              <div className="flex items-center justify-between pb-1.5 text-xs text-slate-400">
                <span>Worker 完整网关脚本</span>
                <Tooltip content="复制 Worker 脚本">
                  <button
                    onClick={handleCopyWorkerScript}
                    className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200/80 dark:bg-dark-hover dark:hover:bg-slate-700/60 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-dark-border transition-all active:scale-[0.98]"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>复制代码</span>
                      </>
                    )}
                  </button>
                </Tooltip>
              </div>

              <pre className="p-3.5 bg-slate-900 text-slate-200 rounded-2xl font-mono text-[11px] leading-5 max-h-72 overflow-y-auto border border-slate-800 shadow-2xs">
                {CLOUDFLARE_WORKER_SCRIPT}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
