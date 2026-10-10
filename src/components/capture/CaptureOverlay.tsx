import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * 截图框选遮罩。
 *
 * 这个页面跑在一个独立的、铺满全屏的透明窗口里（见 electron/main.ts 的
 * createCaptureWindow）。流程：
 *   1. 主进程先抓一张全屏图，挂到本页 <img> 上作背景
 *   2. 用户拖拽画选框，松手后用 canvas 按选区裁出图片
 *   3. 结果发回主进程，由它转交给主窗口去做 OCR + 翻译
 *
 * 为什么要这么绕、不直接在遮罩窗口里 OCR：
 * 识别要加载 3.7MB 的 wasm、还要下语言包，放进一次性的遮罩窗口等于每次
 * 截图都重新初始化，好几秒起步。主窗口常驻，worker 能复用。
 */

interface Selection {
  x: number
  y: number
  w: number
  h: number
}

/** 截图数据由主进程在窗口加载后推过来 */
interface CapturePayload {
  dataUrl: string
  width: number
  height: number
  scaleFactor: number
}

export default function CaptureOverlay() {
  const [shot, setShot] = useState<CapturePayload | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [dragging, setDragging] = useState(false)
  /** 拖拽起点，用 ref 避免每帧 setState */
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const [error, setError] = useState('')

  /**
   * 关掉遮罩窗口。
   *
   * 优先走 IPC（主进程关得干净），拿不到接口时退回 window.close() ——
   * 遮罩层会盖住整个屏幕，一旦关不掉用户就卡死了，所以必须有兜底。
   */
  const close = useCallback(() => {
    const api = window.electronAPI
    if (api?.cancelCapture) void api.cancelCapture()
    else window.close()
  }, [])

  // 主进程把截图推过来（也可能是窗口打开时已经在等，见 preload 的实现）
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onCaptureReady) {
      setError('截图接口不可用')
      return
    }
    const off = api.onCaptureReady((payload) => {
      const data = payload as CapturePayload & { error?: string }
      // 主进程抓图失败时会把错误塞在这个 payload 里，别当成图去渲染
      if (data?.error) {
        setError(data.error)
        return
      }
      setShot(data)
    })

    /*
     * 挂好监听后主动拉一次。
     *
     * 主进程是在 did-finish-load 时推图的，而那是「HTML 加载完」，
     * React 可能还没渲染、这个监听还没挂上 —— 消息发出来没人接就丢了，
     * 表现为只有遮罩、没有底图。所以渲染就绪后再问一次，哪次先到用哪次。
     */
    void api.requestCaptureShot?.()

    return off
  }, [])

  // Esc 取消。用 keydown 而不是给 div 挂事件 —— 焦点未必在哪个元素上
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  const pointFromEvent = (event: React.MouseEvent) => ({
    x: event.clientX,
    y: event.clientY,
  })

  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return
    const point = pointFromEvent(event)
    originRef.current = point
    setSelection({ x: point.x, y: point.y, w: 0, h: 0 })
    setDragging(true)
  }

  const onMouseMove = (event: React.MouseEvent) => {
    const origin = originRef.current
    if (!dragging || !origin) return
    const point = pointFromEvent(event)
    // 往左上拖时宽高会算成负数，归一化成左上角 + 正尺寸
    setSelection({
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      w: Math.abs(point.x - origin.x),
      h: Math.abs(point.y - origin.y),
    })
  }

  const finish = async () => {
    if (!shot || !selection || selection.w < 4 || selection.h < 4) {
      // 只是点了一下没画出来，当作误触，回到可框选状态
      setDragging(false)
      originRef.current = null
      setSelection(null)
      return
    }
    setDragging(false)
    originRef.current = null

    try {
      const cropped = await cropSelection(shot, selection)
      await window.electronAPI?.finishCapture?.(cropped)
    } catch (e) {
      setError(e instanceof Error ? e.message : '裁剪失败')
    }
  }

  const onMouseUp = () => {
    if (!dragging) return
    void finish()
  }

  // 出错时给一块不透底的界面 + 能用的关闭按钮，绝不能让用户卡在全屏遮罩里
  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-900 text-white text-sm">
        <div className="text-center">
          <p className="mb-3">{error}</p>
          {/* 按钮直接调 close，不走 window.electronAPI —— 出错的场景里那个接口
              本身可能就不可用，再依赖它等于没给退路 */}
          <button
            onClick={close}
            className="px-4 h-8 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
          >
            关闭（Esc）
          </button>
        </div>
      </div>
    )
  }

  // 截图还没到时给个全黑底，避免闪一下桌面
  if (!shot) return <div className="fixed inset-0 bg-slate-900/80" />

  return (
    <div
      className="fixed inset-0 select-none cursor-crosshair"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {/* 全屏底图：这就是待框选的画面 */}
      <img
        src={shot.dataUrl}
        alt=""
        draggable={false}
        className="absolute inset-0 w-full h-full object-fill pointer-events-none"
      />

      {/*
        压暗层。有选区时用 clip-path 把选区挖空，让那一块露出原图；
        没选区时整体压暗。
      */}
      <div
        className="absolute inset-0 bg-slate-900/55 pointer-events-none"
        style={
          selection
            ? {
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${selection.x}px ${selection.y}px, ${selection.x}px ${selection.y + selection.h}px, ${selection.x + selection.w}px ${selection.y + selection.h}px, ${selection.x + selection.w}px ${selection.y}px, ${selection.x}px ${selection.y}px)`,
              }
            : undefined
        }
      />

      {selection && selection.w > 0 && (
        <>
          <div
            className="absolute border-2 border-brand-400 pointer-events-none"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.w,
              height: selection.h,
            }}
          />
          {/* 尺寸标签：放在选框下方，贴到屏幕底部时改放上方 */}
          <div
            className="absolute px-2 py-0.5 rounded-md bg-slate-900/85 text-white text-[11px] font-semibold tabular-nums pointer-events-none"
            style={{
              left: selection.x,
              top:
                selection.y + selection.h + 24 > window.innerHeight
                  ? Math.max(4, selection.y - 24)
                  : selection.y + selection.h + 6,
            }}
          >
            {selection.w} × {selection.h}
          </div>
        </>
      )}

      {/* 首次进入时的操作提示 */}
      {!selection && (
        <div className="absolute left-1/2 top-10 -translate-x-1/2 px-4 py-2 rounded-xl bg-slate-900/85 text-white text-[13px] pointer-events-none">
          拖拽框选要识别的区域 · Esc 取消
        </div>
      )}
    </div>
  )
}

/**
 * 按选框裁出图片。
 *
 * 选框坐标是 CSS 像素，截图是物理像素（Retina 上是两倍），所以要把比例
 * 还原回去，否则裁出来的位置和大小全错。
 */
function cropSelection(shot: CapturePayload, selection: Selection): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      // 物理像素 / CSS 像素。不能用 scaleFactor —— 窗口可能被系统缩放过，
      // 用底图实际尺寸除以逻辑尺寸最准
      const ratioX = image.naturalWidth / shot.width
      const ratioY = image.naturalHeight / shot.height

      const canvas = document.createElement('canvas')
      canvas.width = Math.round(selection.w * ratioX)
      canvas.height = Math.round(selection.h * ratioY)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('当前环境拿不到画布'))
        return
      }
      ctx.drawImage(
        image,
        selection.x * ratioX,
        selection.y * ratioY,
        selection.w * ratioX,
        selection.h * ratioY,
        0,
        0,
        canvas.width,
        canvas.height,
      )
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('截图解码失败'))
    image.src = shot.dataUrl
  })
}
