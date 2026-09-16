import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installCapacitorBridge } from './utils/capacitorBridge'
import './index.css'

// 渲染层首帧就会读 window.electronAPI，桥必须在 render 之前装好
installCapacitorBridge()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
