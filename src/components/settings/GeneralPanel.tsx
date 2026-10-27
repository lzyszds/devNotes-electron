import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  PanelLeft,
  RefreshCw,
  Sparkles,
  Zap,
} from 'lucide-react'
import Select from '../ui/Select'
import Switch from '../ui/Switch'
import {
  CODE_BLOCK_THEMES,
  getCachedCodeBlockTheme,
  getCodeBlockPreset,
  saveCodeBlockTheme,
  subscribeCodeBlockTheme,
  type CodeBlockThemeId,
} from '../../utils/codeBlockTheme'
import { useNotes } from '../../context/NotesContext'
import {
  AUTO_SAVE_DELAY_OPTIONS,
  clampAutoSaveDelay,
} from '../../utils/notesSettings'

const CODE_THEME_OPTIONS = (['light', 'dark'] as const).flatMap((tone) =>
  CODE_BLOCK_THEMES.filter((preset) => preset.tone === tone)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((preset) => ({
      value: preset.id,
      label: preset.label,
      group: tone === 'light' ? '浅色主题' : '深色主题',
    }))
)

export interface GeneralPanelProps {
  onResetSidebarWidth: () => void
}

/** 全局设置 · 通用：保存策略、编辑器代码高亮与关于信息 */
export default function GeneralPanel({
  onResetSidebarWidth,
}: GeneralPanelProps) {
  const [version, setVersion] = useState('')

  // 在线更新状态
  type UpdateStatusInfo = {
    state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev-mode'
    version?: string
    percent?: number
    bytesPerSecond?: number
    transferred?: number
    total?: number
    message?: string
  }
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusInfo | null>(null)
  const [lastChecked, setLastChecked] = useState('')

  const { notesSave, updateNotesSave } = useNotes()

  // 代码块主题
  const [codeTheme, setCodeTheme] = useState<CodeBlockThemeId>(() => getCachedCodeBlockTheme())

  useEffect(() => subscribeCodeBlockTheme(setCodeTheme), [])
  const activePreset = getCodeBlockPreset(codeTheme)

  const handleCodeThemeChange = (next: CodeBlockThemeId) => {
    setCodeTheme(next)
    saveCodeBlockTheme(next)
  }

  useEffect(() => {
    window.electronAPI
      ?.getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(''))

    // 读取当前已有更新状态缓存
    window.electronAPI?.getUpdateStatus?.().then((status) => {
      if (status) setUpdateStatus(status as UpdateStatusInfo)
    })

    // 订阅后续更新推送
    const unsub = window.electronAPI?.onUpdateStatus?.((status) => {
      setUpdateStatus(status as UpdateStatusInfo)
    })
    return () => unsub?.()
  }, [])

  const handleCheckUpdate = async () => {
    setUpdateStatus({ state: 'checking' })
    setLastChecked(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    try {
      if (window.electronAPI?.checkForUpdates) {
        const res: any = await window.electronAPI.checkForUpdates()
        if (res && res.state === 'dev-mode') {
          setUpdateStatus(res)
        }
      } else {
        setUpdateStatus({
          state: 'dev-mode',
          message: '当前处于非 Electron 运行环境，自动更新在客户端打包后生效。',
        })
      }
    } catch (e: any) {
      setUpdateStatus({
        state: 'error',
        message: e?.message || '检查更新失败，请检查网络连接',
      })
    }
  }

  const handleInstallNow = () => {
    window.electronAPI?.installUpdate?.()
  }

  return (
    <div className="space-y-6">
      {/* ================= 笔记保存策略 ================= */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[#787774] uppercase tracking-wider">
          笔记保存
        </h4>

        <div className="p-3.5 rounded-xl border border-[#E6E6E3] bg-[#FFFFFF] space-y-3">
          <Switch
            checked={notesSave.autoSaveEnabled}
            onChange={(checked) => void updateNotesSave({ autoSaveEnabled: checked })}
            label="自动保存"
            description="停止编辑后按设定的间隔自动写入本机磁盘"
          />

          <div
            className={`flex items-center justify-between gap-3 pt-3 border-t border-[#E6E6E3] transition-opacity ${
              notesSave.autoSaveEnabled ? '' : 'opacity-50 pointer-events-none'
            }`}
          >
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#191918]">
                自动保存间隔
              </div>
              <div className="text-[11px] text-[#787774] mt-0.5 leading-relaxed">
                停止编辑这么久才真正写一次，期间继续打字则顺延
              </div>
            </div>
            <Select
              value={String(notesSave.autoSaveDelayMs)}
              options={AUTO_SAVE_DELAY_OPTIONS.map((item) => ({
                value: String(item.value),
                label: item.label,
              }))}
              onChange={(value) =>
                void updateNotesSave({ autoSaveDelayMs: clampAutoSaveDelay(Number(value)) })
              }
              className="w-28 shrink-0"
            />
          </div>

          <p className="text-[11px] text-[#787774] leading-relaxed">
            关闭自动保存后，编辑内容只留在内存中，按{' '}
            <kbd className="px-1 py-0.5 bg-[#F3F3F1] border border-[#E6E6E3] rounded text-[10px]">
              ⌘S
            </kbd>{' '}
            手动保存；切换文档、切换工具、隐藏或退出窗口时也会自动保存，不会丢内容。
          </p>
        </div>
      </section>

      {/* ================= 编辑器代码块配色 ================= */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[#787774] uppercase tracking-wider">
          代码块高亮
        </h4>
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-[#E6E6E3] bg-[#FFFFFF]">
          <div className="flex items-start gap-2.5 min-w-0">
            <Code2 className="w-4 h-4 text-[#787774] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-[#191918]">代码语法高亮</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-[#F3F3F1] text-[#787774]">
                  {activePreset.label}
                </span>
              </div>
              <p className="text-[11px] text-[#787774] mt-0.5 leading-relaxed">
                正文代码块使用 Shiki 语法高亮引擎渲染
              </p>
            </div>
          </div>
          <Select
            value={codeTheme}
            options={CODE_THEME_OPTIONS}
            onChange={(value) => handleCodeThemeChange(value as CodeBlockThemeId)}
            className="w-44 shrink-0"
          />
        </div>
      </section>

      {/* ================= 界面布局辅助 ================= */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[#787774] uppercase tracking-wider">
          界面布局
        </h4>
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#E6E6E3] bg-[#FFFFFF]">
          <div className="flex items-start gap-2.5 min-w-0">
            <PanelLeft className="w-4 h-4 text-[#787774] mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-bold text-[#191918]">重置目录宽度</div>
              <div className="text-[11px] text-[#787774] mt-0.5 leading-relaxed">
                将二级分类与列表栏恢复为出厂默认宽度
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onResetSidebarWidth}
            className="h-7 px-3 rounded-lg text-xs font-medium text-[#191918] bg-[#F3F3F1] hover:bg-[#EAEAE7] border border-[#E6E6E3] transition-colors cursor-pointer"
          >
            重置宽度
          </button>
        </div>
      </section>

      {/* ================= 关于信息与在线更新 ================= */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-[#787774] uppercase tracking-wider">
            关于与在线更新
          </h4>
          <span className="text-[11px] text-[#787774] flex items-center gap-1 font-mono">
            <Zap size={11} className="text-amber-500" />
            <span>GitHub Release 差量更新 (Blockmap)</span>
          </span>
        </div>

        <div className="p-4 rounded-xl border border-[#E6E6E3] bg-[#FFFFFF] space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#1C1C1C] text-white flex items-center justify-center font-bold text-sm shadow-2xs shrink-0">
                D
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#191918]">devNotes 桌面工作台</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-[#F3F3F1] text-[#787774] border border-[#E6E6E3]">
                    v{version || '2.0.1'}
                  </span>
                </div>
                <p className="text-[11px] text-[#787774] mt-0.5 truncate">
                  极简暖灰阶开发者桌面工作台 · 离线优先
                </p>
              </div>
            </div>

            {/* 右侧动作按钮区 */}
            <div className="flex items-center gap-2 shrink-0">
              {updateStatus?.state === 'downloaded' ? (
                <button
                  type="button"
                  onClick={handleInstallNow}
                  className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-[#22C55E] hover:bg-emerald-600 active:scale-95 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                >
                  <Sparkles size={13} />
                  <span>立即重启并安装 (v{updateStatus.version})</span>
                </button>
              ) : updateStatus?.state === 'checking' ? (
                <div className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#F3F3F1] text-[#787774] text-xs font-medium border border-[#E6E6E3]">
                  <RefreshCw size={12} className="animate-spin text-[#191918]" />
                  <span>检查中…</span>
                </div>
              ) : updateStatus?.state === 'downloading' ? (
                <div className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium border border-blue-200">
                  <RefreshCw size={12} className="animate-spin" />
                  <span>差量下载中 {updateStatus.percent}%</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCheckUpdate}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#F3F3F1] hover:bg-[#EAEAE7] active:scale-95 text-[#191918] text-xs font-medium border border-[#E6E6E3] transition-colors cursor-pointer"
                >
                  <RefreshCw size={12} />
                  <span>检查更新</span>
                </button>
              )}
            </div>
          </div>

          {/* 状态详情卡片 */}
          {updateStatus && (
            <div className="pt-3 border-t border-[#F3F3F1] text-xs">
              {updateStatus.state === 'downloading' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] text-[#787774]">
                    <span>正在进行 Blockmap 差量更新下载…</span>
                    <span className="font-mono">{updateStatus.percent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[#F3F3F1] overflow-hidden">
                    <div
                      className="h-full bg-[#1C1C1C] transition-all duration-300"
                      style={{ width: `${updateStatus.percent}%` }}
                    />
                  </div>
                  {updateStatus.transferred && updateStatus.total ? (
                    <div className="text-[10px] text-[#787774] font-mono text-right">
                      {(updateStatus.transferred / 1024 / 1024).toFixed(1)} MB /{' '}
                      {(updateStatus.total / 1024 / 1024).toFixed(1)} MB
                    </div>
                  ) : null}
                </div>
              )}

              {updateStatus.state === 'downloaded' && (
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                    <span className="font-medium">
                      新版本 v{updateStatus.version} 差量下载完毕，重启即可生效！
                    </span>
                  </div>
                </div>
              )}

              {updateStatus.state === 'not-available' && (
                <div className="flex items-center justify-between text-[11px] text-[#787774]">
                  <div className="flex items-center gap-1.5 text-emerald-600 font-medium">
                    <CheckCircle2 size={13} />
                    <span>当前已是最新版本</span>
                  </div>
                  {lastChecked && <span>检查时间：{lastChecked}</span>}
                </div>
              )}

              {updateStatus.state === 'available' && (
                <div className="text-[11px] text-[#787774] flex items-center gap-1.5">
                  <Sparkles size={12} className="text-brand-600" />
                  <span>发现新版本 v{updateStatus.version}，正在准备差量更新…</span>
                </div>
              )}

              {updateStatus.state === 'error' && (
                <div className="flex items-center justify-between p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px]">
                  <div className="flex items-center gap-1.5 truncate">
                    <AlertCircle size={13} className="shrink-0 text-rose-500" />
                    <span className="truncate">检查失败：{updateStatus.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCheckUpdate}
                    className="text-rose-600 font-semibold hover:underline shrink-0 ml-2 cursor-pointer"
                  >
                    重试
                  </button>
                </div>
              )}

              {updateStatus.state === 'dev-mode' && (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                  <AlertCircle size={13} className="shrink-0 text-amber-600" />
                  <span>{updateStatus.message}</span>
                </div>
              )}
            </div>
          )}

          {/* 差量更新机制说明 */}
          <div className="text-[11px] text-[#787774] bg-[#FBFBFA] p-2.5 rounded-lg leading-relaxed flex items-start gap-1.5 border border-[#E6E6E3]">
            <span className="text-[#191918] font-bold shrink-0">💡 差量更新说明：</span>
            <span>
              客户端基于 GitHub Releases 托管的 Blockmap
              算法校验二进制分块，更新时仅下载有变动的数据块，流量消耗比全量安装包减少 80%
              以上。
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
