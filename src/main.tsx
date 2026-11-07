import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { installCapacitorBridge } from './utils/capacitorBridge'
import { installClickRipple } from './utils/clickRipple'
import { loadAiChannel } from './utils/aiChannel'
import { loadTranslateConfig } from './utils/translateConfig'
import './index.css'

// 渲染层首帧就会读 window.electronAPI，桥必须在 render 之前装好
installCapacitorBridge()
// 全局按钮点击涟漪：document 级委托装一次就够，所有窗口（主界面/草稿纸/剪贴板）共用这个入口
installClickRipple()

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

/*
 * 四种窗口各自按需加载自己的入口。
 *
 * 原先四个入口静态 import 在一起，于是剪贴板面板、草稿纸、截图遮罩这三个
 * 只有几十行界面的小窗，每开一个都要把整个主界面（所有工具的共享依赖）
 * 解析执行一遍 —— 每个小窗多出几十 MB 内存和几百毫秒启动。拆成 lazy 之后
 * 它们只加载自己那一小块。
 */
const App = lazy(() => import('./App'))
const CaptureOverlay = lazy(() => import('./components/capture/CaptureOverlay'))
const ScratchpadApp = lazy(() => import('./components/scratch/ScratchpadApp'))
const ClipboardPanel = lazy(() => import('./components/clipboard/ClipboardPanel'))

// AI 渠道与翻译配置启动时即预加载进内存，打开设置弹窗时可 0ms 秒开渲染。
// 只有主界面用得到，小窗不必为它们各读一遍存储
if (!isCaptureMode && !isScratchMode && !isClipboardMode) {
  void loadAiChannel()
  void loadTranslateConfig()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}>
    {isCaptureMode ? (
      <CaptureOverlay />
    ) : isScratchMode ? (
      <ScratchpadApp />
    ) : isClipboardMode ? (
      <ClipboardPanel />
    ) : (
      <App />
    )}
    </Suspense>
  </React.StrictMode>,
)
