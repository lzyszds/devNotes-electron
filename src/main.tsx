import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CaptureOverlay from './components/capture/CaptureOverlay'
import ScratchpadApp from './components/scratch/ScratchpadApp'
import ClipboardPanel from './components/clipboard/ClipboardPanel'
import { installCapacitorBridge } from './utils/capacitorBridge'
import { installClickRipple } from './utils/clickRipple'
import { loadAiChannel } from './utils/aiChannel'
import { loadTranslateConfig } from './utils/translateConfig'
import './index.css'

// 渲染层首帧就会读 window.electronAPI，桥必须在 render 之前装好
installCapacitorBridge()
// 全局按钮点击涟漪：document 级委托装一次就够，所有窗口（主界面/草稿纸/剪贴板）共用这个入口
installClickRipple()
// AI 渠道与翻译配置启动时即预加载进内存，打开设置弹窗时可 0ms 秒开渲染
void loadAiChannel()
void loadTranslateConfig()

/**
 * 截图框选页、草稿纸小窗、剪贴板面板与主界面共用这个入口。
 *
 * 用 query 参数分流而不是各开一个 html：它们要复用同一套构建与样式，
 * 单独入口会多出几份 Vite 配置，收益不抵。
 */
const params = new URLSearchParams(location.search)
const isCaptureMode = params.has('capture')
const isScratchMode = params.has('scratch')
const isClipboardMode = params.has('clipboard')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isCaptureMode ? (
      <CaptureOverlay />
    ) : isScratchMode ? (
      <ScratchpadApp />
    ) : isClipboardMode ? (
      <ClipboardPanel />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
