import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ScratchpadApp from './components/scratch/ScratchpadApp'
import ClipboardPanel from './components/clipboard/ClipboardPanel'
import { installCapacitorBridge } from './utils/capacitorBridge'
import './index.css'

// 渲染层首帧就会读 window.electronAPI，桥必须在 render 之前装好
installCapacitorBridge()

/**
 * 草稿纸小窗、剪贴板面板与主界面共用这个入口。
 *
 * 用 query 参数分流而不是各开一个 html：它们要复用同一套构建与样式，
 * 单独入口会多出几份 Vite 配置，收益不抵。
 */
const params = new URLSearchParams(location.search)
const isScratchMode = params.has('scratch')
const isClipboardMode = params.has('clipboard')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isScratchMode ? (
      <ScratchpadApp />
    ) : isClipboardMode ? (
      <ClipboardPanel />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
