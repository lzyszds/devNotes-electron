import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check } from 'lucide-react'

export type ToastTone = 'default' | 'error'

interface ToastItem {
  id: number
  text: string
  tone: ToastTone
}

interface ToastContextValue {
  showToast: (text: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_DURATION = 1600

/**
 * 轻量提示:fixed 定位在窗口右上角,完全不参与布局,不会造成任何位移。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  const showToast = useCallback((text: string, tone: ToastTone = 'default') => {
    if (!text) return
    const id = ++counterRef.current
    setToasts((prev) => [...prev, { id, text, tone }].slice(-3))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id))
    }, TOAST_DURATION)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((item) => (
            <div key={item.id} className="toast-item" data-tone={item.tone}>
              {item.tone === 'error' ? (
                <AlertCircle size={13} className="flex-shrink-0" />
              ) : (
                <Check size={13} className="flex-shrink-0" />
              )}
              <span className="truncate">{item.text}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
