export interface Tool {
  id: string
  name: string
  icon: string
  description: string
  category: string
}

export interface ToolCategory {
  id: string
  name: string
  icon: string
}

export const toolCategories: ToolCategory[] = [
  { id: 'all', name: '全部', icon: 'Grid3X3' },
  { id: 'dev', name: '开发工具', icon: 'Code' },
  { id: 'encode', name: '编解码', icon: 'Shuffle' },
  { id: 'image', name: '图像工具', icon: 'Image' },
  { id: 'productivity', name: '效率工具', icon: 'Zap' },
  { id: 'calculator', name: '计算器', icon: 'Calculator' },
]

export const tools: Tool[] = [
  { id: 'markdown-notes', name: 'Markdown 笔记', icon: 'MD', description: '本地笔记编辑器，支持双栏与所见即所得两种模式', category: 'productivity' },
  { id: 'json-format', name: 'JSON 美化', icon: '{ }', description: 'JSON 格式化、排序、压缩', category: 'dev' },
  { id: 'json-diff', name: 'JSON 比对', icon: 'GitCompare', description: 'JSON 结构化比较', category: 'dev' },
  { id: 'json-i18n', name: 'JSON 翻译', icon: 'Lang', description: 'JSON 多语言翻译，支持 JSONPath 和键名映射', category: 'dev' },
  { id: 'text-translate', name: '文本翻译', icon: '译', description: '中英日韩等 20 种语言互译，支持自动检测源语言', category: 'productivity' },
  { id: 'websocket', name: 'WS 测试工具', icon: 'WS', description: 'WebSocket 连接和消息测试', category: 'dev' },
  { id: 'qr-code', name: '二维码', icon: 'QrCode', description: '二维码生成和解码', category: 'image' },
  { id: 'en-decode', name: '编码转换', icon: 'ArrowLeftRight', description: 'Base64/URL/Unicode/MD5', category: 'encode' },
  { id: 'timestamp', name: '时间戳', icon: 'Clock', description: '时间戳与日期互转', category: 'encode' },
  { id: 'regexp', name: '正则公式', icon: 'Search', description: '常用正则表达式', category: 'dev' },
  { id: 'password', name: '密码生成', icon: 'Lock', description: '随机密码生成器', category: 'calculator' },
  { id: 'base64', name: 'Base64', icon: 'FileCode', description: 'Base64 编码解码', category: 'encode' },
  { id: 'url', name: 'URL 编码', icon: 'Link', description: 'URL 编码解码', category: 'encode' },
]
