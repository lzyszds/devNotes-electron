import React from 'react'
import {
  FileText,
  Braces,
  GitCompare,
  Languages,
  Radio,
  QrCode,
  ArrowLeftRight,
  Clock,
  Regex,
  Lock,
  FileCode,
  Link2,
  Wrench,
  type LucideProps,
} from 'lucide-react'

export interface ToolIconProps extends LucideProps {
  toolId: string
}

const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  'markdown-notes': FileText,
  'json-format': Braces,
  'json-diff': GitCompare,
  'json-i18n': Languages,
  'text-translate': Languages,
  'websocket': Radio,
  'qr-code': QrCode,
  'en-decode': ArrowLeftRight,
  'timestamp': Clock,
  'regexp': Regex,
  'password': Lock,
  'base64': FileCode,
  'url': Link2,
}

/**
 * 统一的工具专属图标渲染组件，告别原先字符串/字面量截取的粗糙表现。
 */
export default function ToolIcon({ toolId, className = 'w-4 h-4', ...rest }: ToolIconProps) {
  const IconComponent = ICON_MAP[toolId] || Wrench
  return <IconComponent className={className} {...rest} />
}
