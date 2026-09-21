import { useMemo } from 'react'
import { ArrowRightLeft, History, Languages, Trash2 } from 'lucide-react'
import Select from '../../ui/Select'
import Tooltip from '../../ui/Tooltip'
import { useHistoryContextMenu } from '../../../hooks/useHistoryContextMenu'
import { AUTO_LANG, LANGUAGES } from '../../../utils/languages'
import { AUTO_TARGET, useTranslate } from '../../../context/TranslateContext'

/** 历史条目的时间戳：当天只给时分，跨天补上日期 */
function formatHistoryTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  if (date.toDateString() === now.toDateString()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 「文本翻译」模块的专属二级侧边栏。
 *
 * 它替掉了工具库那套「组件工具库」列表 —— 翻译页要的不是一排别的工具，
 * 而是当前语言方向与历史记录。数据全部来自 TranslateContext，
 * 与翻译页共用一份，侧边栏里改语言方向，页面上的选择器会跟着变。
 */
export default function TranslateSidebar() {
  const {
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    primaryLang,
    setPrimaryLang,
    swapLanguages,
    history,
    clearHistory,
    removeHistoryItem,
    useHistoryItem,
    isTranslating,
  } = useTranslate()

  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => useHistoryItem(item.data),
    onRemove: removeHistoryItem,
    useLabel: '填入输入框',
  })

  const sourceOptions = useMemo(
    () => [
      { value: AUTO_LANG, label: '自动检测' },
      ...LANGUAGES.map((lang) => ({ value: lang.code, label: lang.name })),
    ],
    []
  )

  // 目标语言不能和源语言撞上，自动检测时则全部可选
  const targetOptions = useMemo(
    () => [
      { value: AUTO_TARGET, label: '自动双向' },
      ...LANGUAGES.filter((lang) => lang.code !== sourceLang).map((lang) => ({
        value: lang.code,
        label: lang.name,
      })),
    ],
    [sourceLang]
  )

  return (
    <>
      <div className="p-3 border-b border-slate-100 dark:border-dark-border space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tracking-tight">
            翻译方向
          </span>
          <Tooltip content="交换语言，译文回填到输入框">
            <button
              onClick={swapLanguages}
              className="p-1 rounded-lg text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>

        <Select
          value={sourceLang}
          onChange={setSourceLang}
          options={sourceOptions}
          size="sm"
          className="w-full"
          title="源语言"
        />
        <Select
          value={targetLang}
          onChange={setTargetLang}
          options={targetOptions}
          size="sm"
          className="w-full"
          title="目标语言"
        />

        {/* 「我的语言」只服务于自动判方向，手动选定了语言时它没有作用，就不占位置 */}
        {targetLang === AUTO_TARGET && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">
              我的语言
            </span>
            <Select
              value={primaryLang}
              onChange={setPrimaryLang}
              options={LANGUAGES.map((lang) => ({ value: lang.code, label: lang.name }))}
              size="sm"
              className="flex-1"
              title="自动双向时，译回哪一种语言"
            />
          </div>
        )}
      </div>

      <div className="p-3 border-b border-slate-100 dark:border-dark-border flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tracking-tight">
            翻译历史
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-dark-hover text-slate-500 dark:text-slate-400">
            {history.length}
          </span>
          {isTranslating && (
            <span className="text-[10px] text-brand-600 dark:text-brand-400 animate-pulse">
              翻译中
            </span>
          )}
        </div>
        {history.length > 0 && (
          <Tooltip content="清空全部历史">
            <button
              onClick={clearHistory}
              className="p-1 rounded-lg text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {history.map((item) => (
          <div
            key={item.id}
            onClick={() => useHistoryItem(item.data)}
            onContextMenu={(event) => openHistoryMenu(event, item)}
            className="group px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-slate-100/80 dark:hover:bg-dark-hover/70 text-slate-700 dark:text-slate-300"
          >
            <div className="flex items-center justify-between gap-1.5 mb-1">
              <h4 className="flex-1 min-w-0 truncate text-[13px] font-medium text-slate-800 dark:text-slate-200">
                {item.title || '未命名记录'}
              </h4>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono shrink-0 select-none">
                {formatHistoryTime(item.timestamp)}
              </span>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 line-clamp-1 leading-snug">
              {item.data}
            </p>
          </div>
        ))}

        {history.length === 0 && (
          <div className="h-40 flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400">
            <History className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2 stroke-[1.5]" />
            <p className="font-medium text-slate-500 dark:text-slate-400">暂无翻译记录</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              <Languages className="w-3 h-3 inline-block align-[-2px]" /> 翻译成功后自动留存
            </p>
          </div>
        )}
      </div>
    </>
  )
}
