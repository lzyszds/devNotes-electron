import { useState } from 'react'
import { 
  Search, Settings, Moon, Sun, X, Minus,
  Grid3X3, Code, Shuffle, Image, Zap, Calculator
} from 'lucide-react'
import { tools, toolCategories } from '../types'
import JsonFormatTool from '../components/tools/JsonFormatTool'
import QrCodeTool from '../components/tools/QrCodeTool'
import EncodeTool from '../components/tools/EncodeTool'
import TimestampTool from '../components/tools/TimestampTool'
import RegexpTool from '../components/tools/RegexpTool'
import PasswordTool from '../components/tools/PasswordTool'

const iconMap: Record<string, React.ReactNode> = {
  'Grid3X3': <Grid3X3 className="w-4 h-4" />,
  'Code': <Code className="w-4 h-4" />,
  'Shuffle': <Shuffle className="w-4 h-4" />,
  'Image': <Image className="w-4 h-4" />,
  'Zap': <Zap className="w-4 h-4" />,
  'Calculator': <Calculator className="w-4 h-4" />,
}

const toolComponents: Record<string, React.ComponentType> = {
  'json-format': JsonFormatTool,
  'json-diff': JsonFormatTool,
  'qr-code': QrCodeTool,
  'en-decode': EncodeTool,
  'timestamp': TimestampTool,
  'regexp': RegexpTool,
  'password': PasswordTool,
  'base64': EncodeTool,
  'url': EncodeTool,
}

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [isDark, setIsDark] = useState(false)

  const filteredTools = tools.filter(tool => {
    const matchesSearch = tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         tool.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = activeCategory === 'all' || tool.category === activeCategory
    return matchesSearch && matchesCategory
  })

  const currentTool = activeTool ? tools.find(t => t.id === activeTool) : null
  const ToolComponent = activeTool ? toolComponents[activeTool] : null

  const toggleTheme = () => {
    setIsDark(!isDark)
    document.documentElement.classList.toggle('dark')
  }

  return (
    <div className={`h-screen flex ${isDark ? 'dark' : ''}`}>
      {/* 左侧面板 - 工具列表 */}
      <div className="w-80 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
        {/* 标题栏 */}
        <div className="drag-region bg-gradient-to-r from-primary-600 to-primary-700 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
              <span className="text-lg font-bold">F</span>
            </div>
            <div>
              <h1 className="font-semibold text-sm">FeHelper</h1>
              <p className="text-xs text-white/70">前端助手</p>
            </div>
          </div>
          <div className="flex items-center gap-1 no-drag">
            <button onClick={toggleTheme} className="p-1.5 hover:bg-white/20 rounded-md transition-colors">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => window.electronAPI?.minimizeWindow()} className="p-1.5 hover:bg-white/20 rounded-md transition-colors">
              <Minus className="w-4 h-4" />
            </button>
            <button onClick={() => window.electronAPI?.closeWindow()} className="p-1.5 hover:bg-white/20 rounded-md transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索工具..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm 
                         focus:outline-none focus:ring-2 focus:ring-primary-500 
                         text-gray-900 dark:text-gray-100 placeholder-gray-400"
            />
          </div>
        </div>

        {/* 分类标签 */}
        <div className="flex gap-2 p-3 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
          {toolCategories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap
                transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              {iconMap[cat.icon]}
              {cat.name}
            </button>
          ))}
        </div>

        {/* 工具列表 */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="space-y-1">
            {filteredTools.map(tool => (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all
                           ${activeTool === tool.id 
                             ? 'bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-800' 
                             : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-transparent'}`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm
                                ${activeTool === tool.id 
                                  ? 'bg-primary-500' 
                                  : 'bg-gradient-to-br from-primary-400 to-primary-600'}`}>
                  {tool.icon.length <= 3 ? tool.icon : tool.icon.charAt(0)}
                </div>
                <div className="flex-1 text-left">
                  <h3 className="font-medium text-sm text-gray-900 dark:text-gray-100">{tool.name}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{tool.description}</p>
                </div>
              </button>
            ))}
          </div>
          
          {filteredTools.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">未找到匹配的工具</p>
            </div>
          )}
        </div>
      </div>

      {/* 右侧面板 - 工具内容 */}
      <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900">
        {currentTool && ToolComponent ? (
          <>
            {/* 工具标题栏 */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center text-white">
                {currentTool.icon.length <= 3 ? currentTool.icon : currentTool.icon.charAt(0)}
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">{currentTool.name}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{currentTool.description}</p>
              </div>
            </div>
            
            {/* 工具内容 */}
            <div className="flex-1 overflow-y-auto">
              <ToolComponent />
            </div>
          </>
        ) : (
          /* 空状态 */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Grid3X3 className="w-12 h-12 text-gray-300 dark:text-gray-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">选择一个工具</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">从左侧列表中选择要使用的工具</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
