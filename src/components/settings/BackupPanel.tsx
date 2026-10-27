import { useState, useRef } from 'react'
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileArchive,
  FileCode2,
  FileText,
  History,
  Layers,
  Settings2,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import {
  exportOfflineBackupZip,
  importOfflineBackupZip,
  previewBackupZip,
  type BackupManifest,
} from '../../utils/offlineBackup'
import { useToast } from '../ui/Toast'
import { useNotes } from '../../context/NotesContext'

/** 全局设置 · 备份与恢复面板 */
export default function BackupPanel() {
  const { showToast } = useToast()
  const { reloadNotes } = useNotes()

  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)

  // 待导入文件与预览
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewManifest, setPreviewManifest] = useState<BackupManifest | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'overwrite'>('merge')

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 执行导出
  const handleExport = async () => {
    try {
      setExporting(true)
      const res = await exportOfflineBackupZip()
      showToast(`已成功导出备份包（包含 ${res.notesCount} 篇笔记）`, 'default')
    } catch (e) {
      console.error(e)
      showToast('导出备份失败，请重试', 'error')
    } finally {
      setExporting(false)
    }
  }

  // 选择文件后触发预读校验
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.zip')) {
      showToast('请选择 .zip 格式的备份文件', 'error')
      return
    }

    try {
      setSelectedFile(file)
      const manifest = await previewBackupZip(file)
      setPreviewManifest(manifest)
    } catch (err) {
      console.error(err)
      showToast('无法读取该 ZIP 文件，请确认是否为 devNotes 导出的备份包', 'error')
      setSelectedFile(null)
      setPreviewManifest(null)
    }
  }

  // 执行导入
  const handleImport = async () => {
    if (!selectedFile) return
    try {
      setImporting(true)
      const res = await importOfflineBackupZip(selectedFile, importMode)
      await reloadNotes()
      showToast(
        `还原完成：${res.notesCount} 篇笔记、${res.snippetsCount} 条代码片段已载入`,
        'default'
      )
      // 清空当前待导入状态
      setSelectedFile(null)
      setPreviewManifest(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e) {
      console.error(e)
      showToast('导入失败，请检查备份文件是否损坏', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6 select-none">
      {/* 顶部说明横幅 */}
      <div className="p-4 rounded-xl border border-[#E6E6E3] bg-[#FBFBFA] flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#1C1C1C] text-white flex items-center justify-center shrink-0 mt-0.5">
          <Archive size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-[#191918]">全量离线打包归档</div>
          <p className="text-[11px] text-[#787774] mt-1 leading-relaxed">
            将全部 Markdown 笔记、代码片段、工具历史记录及系统个性化偏好打包为标准
            .zip 文件。导出的笔记包含清晰的独立 .md 纯文本，任何外部编辑器均可直接阅读。
          </p>
        </div>
      </div>

      {/* ================= 一键导出 ================= */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[#787774] uppercase tracking-wider">
          数据导出
        </h4>

        <div className="p-4 rounded-xl border border-[#E6E6E3] bg-white space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#191918]">打包导出归档 (.zip)</div>
              <div className="text-[11px] text-[#787774] mt-0.5 leading-relaxed">
                包含笔记正文、文件夹树、代码片段库、10 款工具历史与快捷键配置
              </div>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-[#1C1C1C] hover:bg-neutral-800 active:scale-95 text-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 shrink-0"
            >
              <ArrowDownToLine size={13} />
              <span>{exporting ? '正在打包…' : '立即导出 ZIP'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-[#F3F3F1] text-[11px] text-[#787774]">
            <div className="flex items-center gap-1.5">
              <FileText size={12} className="text-[#191918]" />
              <span>Markdown 笔记</span>
            </div>
            <div className="flex items-center gap-1.5">
              <FileCode2 size={12} className="text-[#191918]" />
              <span>代码片段库</span>
            </div>
            <div className="flex items-center gap-1.5">
              <History size={12} className="text-[#191918]" />
              <span>各工具历史记录</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Settings2 size={12} className="text-[#191918]" />
              <span>偏好与快捷键</span>
            </div>
          </div>
        </div>
      </section>

      {/* ================= 一键导入 ================= */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[#787774] uppercase tracking-wider">
          数据恢复
        </h4>

        <div className="p-4 rounded-xl border border-[#E6E6E3] bg-white space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={handleFileChange}
            className="hidden"
          />

          {!selectedFile ? (
            /* 上传文件提示区 */
            <div
              onClick={() => fileInputRef.current?.click()}
              className="p-6 rounded-xl border-2 border-dashed border-[#E6E6E3] hover:border-[#1C1C1C] hover:bg-[#FBFBFA] transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-2 group"
            >
              <div className="w-10 h-10 rounded-xl bg-[#F3F3F1] group-hover:bg-[#EAEAE7] text-[#191918] flex items-center justify-center transition-colors">
                <Upload size={18} />
              </div>
              <div className="text-xs font-semibold text-[#191918]">
                点击或拖拽备份 .zip 文件到此处
              </div>
              <div className="text-[11px] text-[#787774]">
                支持 devNotes 导出的完整本地归档包
              </div>
            </div>
          ) : (
            /* 已选中备份包的预览信息 */
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl border border-[#E6E6E3] bg-[#FBFBFA] flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileArchive className="w-5 h-5 text-brand-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#191918] truncate">
                      {selectedFile.name}
                    </div>
                    <div className="text-[11px] text-[#787774]">
                      {(selectedFile.size / 1024).toFixed(1)} KB · 备份于{' '}
                      {previewManifest
                        ? new Date(previewManifest.createdAt).toLocaleString('zh-CN', {
                            hour12: false,
                          })
                        : '未知时间'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null)
                    setPreviewManifest(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  className="text-xs text-[#787774] hover:text-rose-600 cursor-pointer"
                >
                  更换文件
                </button>
              </div>

              {/* 备份内容计数 */}
              {previewManifest && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2.5 rounded-lg border border-[#E6E6E3] bg-white">
                    <div className="text-xs font-mono font-bold text-[#191918]">
                      {previewManifest.notesCount} 篇
                    </div>
                    <div className="text-[10px] text-[#787774] mt-0.5">Markdown 笔记</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E6E6E3] bg-white">
                    <div className="text-xs font-mono font-bold text-[#191918]">
                      {previewManifest.snippetsCount} 条
                    </div>
                    <div className="text-[10px] text-[#787774] mt-0.5">代码片段</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E6E6E3] bg-white">
                    <div className="text-xs font-mono font-bold text-[#191918]">
                      {previewManifest.historiesCount || '若干'} 项
                    </div>
                    <div className="text-[10px] text-[#787774] mt-0.5">工具历史记录</div>
                  </div>
                </div>
              )}

              {/* 导入模式选项 */}
              <div className="pt-2 border-t border-[#F3F3F1] space-y-2">
                <div className="text-xs font-semibold text-[#191918]">选择还原方式</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setImportMode('merge')}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      importMode === 'merge'
                        ? 'border-[#1C1C1C] bg-[#1C1C1C]/5 ring-1 ring-[#1C1C1C]'
                        : 'border-[#E6E6E3] hover:border-[#1C1C1C]/30 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#191918]">
                      <Layers size={13} />
                      <span>智能合并（推荐）</span>
                    </div>
                    <p className="text-[10px] text-[#787774] mt-1 leading-normal">
                      保留现有数据，合并备份包中的条目，内容较新者胜出
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportMode('overwrite')}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      importMode === 'overwrite'
                        ? 'border-rose-600 bg-rose-50/50 ring-1 ring-rose-600'
                        : 'border-[#E6E6E3] hover:border-rose-400 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-600">
                      <ShieldCheck size={13} />
                      <span>完全覆盖还原</span>
                    </div>
                    <p className="text-[10px] text-[#787774] mt-1 leading-normal">
                      以备份文件为准，覆盖替换本地数据，请谨慎操作
                    </p>
                  </button>
                </div>
              </div>

              {/* 导入确认按钮 */}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  disabled={importing}
                  onClick={handleImport}
                  className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-[#1C1C1C] hover:bg-neutral-800 active:scale-95 text-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-40"
                >
                  <ArrowUpFromLine size={13} />
                  <span>{importing ? '正在解压还原…' : '开始导入数据'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
