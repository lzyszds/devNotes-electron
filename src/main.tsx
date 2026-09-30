import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CaptureOverlay from './components/capture/CaptureOverlay'
import { installCapacitorBridge } from './utils/capacitorBridge'
import './index.css'

// 渲染层首帧就会读 window.electronAPI，桥必须在 render 之前装好
installCapacitorBridge()

/**
 * 截图框选页与主界面共用这个入口。
 *
 * 用 query 参数分流而不是另开一个 html：截图页要复用同一套构建与样式，
 * 单独一个入口会多出一份 Vite 配置，收益不抵。
 */
const isCaptureMode = new URLSearchParams(location.search).has('capture')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isCaptureMode ? <CaptureOverlay /> : <App />}
  </React.StrictMode>,
)
