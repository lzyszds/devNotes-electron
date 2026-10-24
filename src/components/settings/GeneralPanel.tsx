import { useEffect, useState } from 'react'
import {
  Code2,
  PanelLeft,
  ShieldCheck,
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
  }, [])

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

      {/* ================= 关于信息 ================= */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[#787774] uppercase tracking-wider">
          关于软件
        </h4>
        <div className="p-3.5 rounded-xl border border-[#E6E6E3] bg-[#FFFFFF] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1C1C1C] text-white flex items-center justify-center font-bold text-sm shadow-2xs">
              D
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#191918]">devNotes 桌面工作台</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono bg-[#F3F3F1] text-[#787774] border border-[#E6E6E3]">
                  v{version || '1.0.8'}
                </span>
              </div>
              <p className="text-[11px] text-[#787774] mt-0.5">
                极简暖灰阶桌面工作台 · 离线优先与端到端加密同步
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[#22C55E] bg-[#22C55E]/10 px-2.5 py-1 rounded-full font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>最新版本</span>
          </div>
        </div>
      </section>
    </div>
  )
}
