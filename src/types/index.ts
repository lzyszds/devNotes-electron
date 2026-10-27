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

/**
 * 工具库成员：工具中心的网格、二级侧边栏的「组件工具库」列表都由它渲染。
 * 只放"随手用一下"的小工具 —— 独立模块（见下）不进这里。
 */
export const tools: Tool[] = [
  { id: 'json-toolbox', name: 'JSON 工具箱', icon: 'Braces', description: '美化/压缩/排序 · 双栏比对 · 多语言翻译，三合一', category: 'dev' },
  { id: 'url', name: 'URL 编码', icon: 'Link2', description: 'URL 编码解码', category: 'encode' },
  { id: 'websocket', name: 'WS 测试工具', icon: 'Radio', description: 'WebSocket 连接和消息测试', category: 'dev' },
  { id: 'qr-code', name: '二维码', icon: 'QrCode', description: '二维码生成，以及从图片识别解码', category: 'image' },
  { id: 'lan-transfer', name: '局域网互传', icon: 'ArrowUpFromLine', description: '手机扫一次码，图片、文件、文字双向传，文字可一键复制', category: 'productivity' },
  { id: 'image-convert', name: '图片转换', icon: 'FileImage', description: 'PNG / JPEG / WebP 互转，可调画质与尺寸', category: 'image' },
  { id: 'timestamp', name: '时间戳', icon: 'Clock', description: '时间戳与日期互转', category: 'encode' },
  { id: 'regexp', name: '正则公式', icon: 'Regex', description: '常用正则表达式', category: 'dev' },
  { id: 'signature', name: '签名工具', icon: 'ShieldCheck', description: 'HMAC-SHA256 生成与常量时间比对', category: 'dev' },
  { id: 'password', name: '密码生成', icon: 'Lock', description: '随机密码生成器', category: 'calculator' },
  { id: 'bitwise', name: '进制与位运算', icon: 'Binary', description: '2/8/10/16 进制换算、位掩码、位移、大小端与 IEEE 754 解析', category: 'calculator' },
  { id: 'port-killer', name: '端口占用排查', icon: 'Network', description: '查出谁占了端口，一键强杀腾出来', category: 'dev' },
  { id: 'file-hash', name: '文件哈希校验', icon: 'Fingerprint', description: 'MD5 / SHA 校验，支持对照期望值与两文件比对', category: 'encode' },
  { id: 'data-convert', name: '数据互转', icon: 'Shuffle', description: 'JSON / YAML / TOML / CSV / .env / URL Query 互相转换', category: 'encode' },
  { id: 'net-probe', name: '网络探测', icon: 'Activity', description: 'Ping、TCP 端口、HTTP(S) 探测，看延迟、丢包并判断卡在哪一层', category: 'dev' },
  { id: 'speed-test', name: '网络测速', icon: 'Gauge', description: '实时测速网络下载速度、上传速度、Ping 时延与网络抖动', category: 'dev' },
  { id: 'sys-inspector', name: '电脑配置检测', icon: 'Cpu', description: '电脑硬件配置检测、实时内存占用空间与各应用进程内存排行', category: 'dev' },
  { id: 'scratchpad', name: '草稿纸', icon: 'StickyNote', description: '常驻置顶小窗，随手记临时地址、Token 与待办', category: 'productivity' },
]

/**
 * 独立模块：不列入工具库，有自己的入口与专属二级侧边栏，按"模块"而不是"工具"来演进。
 * 仍复用 Tool 结构，好让使用统计、图标映射、面包屑这些按 id 查找的地方统一处理。
 */
export const standaloneModules: Tool[] = [
  { id: 'markdown-notes', name: 'Markdown 笔记', icon: 'FileText', description: '本地笔记编辑器，支持双栏与所见即所得两种模式', category: 'productivity' },
  { id: 'text-translate', name: '文本翻译', icon: 'Languages', description: '中英日韩等 20 种语言互译，支持自动检测源语言', category: 'productivity' },
  { id: 'snippets', name: '代码片段库', icon: 'FileCode2', description: '收藏常用命令与配置模板，左侧列表随时搜索复制', category: 'productivity' },
]

/** 工具库 + 独立模块。按 id 查名字/图标的地方用它，别用 tools，否则独立模块会漏掉 */
export const allModules: Tool[] = [...tools, ...standaloneModules]

/**
 * 三个 json 工具（美化/比对/翻译）合并成了 json-toolbox 一个入口。
 * 旧 id 保留为别名：快捷键、⌘K 深链接、旧统计数据都能解析到工具箱的对应子模式。
 */
export type JsonToolboxMode = 'format' | 'diff' | 'i18n'

export const jsonToolboxAliases: Record<string, JsonToolboxMode> = {
  'json-format': 'format',
  'json-diff': 'diff',
  'json-i18n': 'i18n',
}
