import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import Tooltip from '../../ui/Tooltip'
import {
  getZoom,
  resetZoom,
  stepZoom,
  subscribeZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from '../../../utils/editorZoom'

/**
 * 画面缩放控件：`− 100% +`。
 *
 * 放在笔记页顶部那条里 —— 工具栏是纯图标按钮，塞一个百分比进去会破坏节奏。
 * 中间的百分比本身就是「复位」按钮：这个位置用户最自然会去点。
 */
export default function EditorZoom() {
  const [zoom, setLocalZoom] = useState(getZoom)

  useEffect(() => subscribeZoom(setLocalZoom), [])

  const atMin = zoom <= ZOOM_MIN
  const atMax = zoom >= ZOOM_MAX

  return (
    <div className="flex flex-shrink-0 items-center gap-0.5 rounded-lg border border-slate-200/70 bg-white/70 p-0.5 dark:border-dark-border dark:bg-dark-panel/60">
      <Tooltip content={`缩小 (⌘-)`}>
        <button
          type="button"
          onClick={() => stepZoom(-ZOOM_STEP)}
          disabled={atMin}
          aria-label="缩小"
          className="flex h-5 w-5 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-35 dark:hover:bg-dark-hover dark:hover:text-slate-200"
        >
          <Minus className="h-3 w-3" />
        </button>
      </Tooltip>

      <Tooltip content="恢复 100% (⌘0)">
        <button
          type="button"
          onClick={resetZoom}
          aria-label={`当前缩放 ${zoom}%，点击恢复 100%`}
          className={`w-9 rounded-md py-0.5 text-center font-mono text-[10.5px] tabular-nums transition-colors hover:bg-slate-100 dark:hover:bg-dark-hover ${
            zoom === 100
              ? 'text-slate-400 dark:text-slate-500'
              : 'font-semibold text-brand-600 dark:text-brand-400'
          }`}
        >
          {zoom}%
        </button>
      </Tooltip>

      <Tooltip content={`放大 (⌘=)`}>
        <button
          type="button"
          onClick={() => stepZoom(ZOOM_STEP)}
          disabled={atMax}
          aria-label="放大"
          className="flex h-5 w-5 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-35 dark:hover:bg-dark-hover dark:hover:text-slate-200"
        >
          <Plus className="h-3 w-3" />
        </button>
      </Tooltip>
    </div>
  )
}
