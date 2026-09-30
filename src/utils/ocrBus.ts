/**
 * 「截图 → 翻译页」的事件总线。
 *
 * 链路横跨三处、彼此不相识：主进程推来图片（App 收到）→ 要切到翻译页
 * （App 决定）→ 要触发识别并把文字填进输入框（只有翻译页组件知道怎么填）。
 * 用总线把「有图要识别」这件事广播出去，翻译页自己订阅，比把状态一路
 * 提上去再传下来省事。
 */

type OcrRequestListener = (dataUrl: string) => void
const listeners = new Set<OcrRequestListener>()

/** 发布一张待识别的图片 */
export function requestOcr(dataUrl: string): void {
  listeners.forEach((listener) => listener(dataUrl))
}

export function subscribeOcrRequest(listener: OcrRequestListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
