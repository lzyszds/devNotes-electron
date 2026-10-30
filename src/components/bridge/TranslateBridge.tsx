import { useEffect, useRef } from 'react'
import { dlog } from '../../utils/debugLog'
import {
  pushTranslateRequest,
  subscribeTranslateInbox,
  type TranslateRequest,
} from '../../utils/translateInbox'

/*
 * 收件箱的订阅方，挂在 App 根部。
 *
 * 它只做一件事：**有活进来就把用户带到翻译页**。
 * 不排队、不重试、不判断翻译页在不在 —— 活本身已经躺在 translateInbox 的
 * 队列里了，翻译页挂载后会自己来取，所以这里切页失败也没关系，下一次
 * 「有活」还会再切。
 *
 * 为什么要放在根部：翻译页是 lazy 加载的，没进过一次它就不存在，不能指望
 * 它自己订阅（这是之前「第一次不生效」的根因）。根部组件从应用启动就在。
 */
export interface TranslateInboxHostProps {
  onOpenTool: (toolId: string) => void
}

export function TranslateBridge({ onOpenTool }: TranslateInboxHostProps) {
  const openRef = useRef(onOpenTool)
  openRef.current = onOpenTool

  useEffect(() => {
    dlog('[bridge] 订阅收件箱')
    return subscribeTranslateInbox(() => {
      dlog('[bridge] 收到有活信号 → 切到翻译页')
      openRef.current('text-translate')
    })
  }, [])

  return null
}

/**
 * 「翻译这段文字」：供其他工具（划词、右键、外链）调用。
 * 放进收件箱后由上面的宿主负责切页，翻译页取走后填进输入框。
 */
export function requestTextTranslate(text: string, targetLang?: string): void {
  pushTranslateRequest({ kind: 'text', text, targetLang } satisfies TranslateRequest)
}
