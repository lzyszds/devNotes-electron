import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CaptureOverlay from './components/capture/CaptureOverlay'
import ScratchpadApp from './components/scratch/ScratchpadApp'
import { installCapacitorBridge } from './utils/capacitorBridge'
import './index.css'

// 渲染层首帧就会读 window.electronAPI，桥必须在 render 之前装好
installCapacitorBridge()

/**
 * 截图框选页、草稿纸小窗与主界面共用这个入口。
 *
 * 用 query 参数分流而不是各开一个 html：它们要复用同一套构建与样式，
 * 单独入口会多出几份 Vite 配置，收益不抵。
 */
const params = new URLSearchParams(location.search)
const isCaptureMode = params.has('capture')
const isScratchMode = params.has('scratch')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isCaptureMode ? (
      <CaptureOverlay />
    ) : isScratchMode ? (
      <ScratchpadApp />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
