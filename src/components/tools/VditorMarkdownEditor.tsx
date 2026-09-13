import { useEffect, useId, useRef } from 'react'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { useNotes } from '../../context/NotesContext'
import { resolveVditorCdn } from '../../utils/vditorAssets'

export type VditorEditorMode = 'ir' | 'wysiwyg'

export type VditorMarkdownEditorProps = {
  value: string
  onChange?: (markdown: string) => void
  /** 即时渲染(ir,类 Typora) / 富文本(wysiwyg,类 Word)。Vditor 不支持运行时切换内核,变化时重建实例 */
  mode: VditorEditorMode
  className?: string
  /** 内容里含 Lute 无法保真的 Cherry 专有语法时回调一次,由宿主决定怎么提示 */
  onWarning?: (message: string) => void
}

// Cherry 专有块语法(::: panel / cols / tabs / timeline …)不属于 GFM。
// Vditor 会把它当普通段落渲染,而且只要用户在这里改一个字,整篇会被 Lute 重新序列化写回,
// 这些块的结构就丢了。检测到就提示,让用户可以选择切回双栏模式编辑。
const CHERRY_ONLY_BLOCK = /^[ \t]*:::[ \t]*\w/m

// 运行时资源基址:dev 下是 /vditor,打包后是 ./vditor(asar 内的相对路径),详见 vditorAssets.ts
const CDN = resolveVditorCdn(import.meta.env.BASE_URL)

// 只保留与「所见即所得」定位相符的项;Vditor 会按当前内核自动隐藏不支持的项
const TOOLBAR = [
  'headings',
  'bold',
  'italic',
  'strike',
  '|',
  'list',
  'ordered-list',
  'check',
  '|',
  'quote',
  'line',
  'code',
  'inline-code',
  '|',
  'link',
  'table',
  '|',
  'undo',
  'redo',
  '|',
  'outline',
  'fullscreen',
  'export',
]

/** 主题跟随 documentElement 上的 dark class(全站换肤就是这么切的) */
function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

export default function VditorMarkdownEditor({
  value,
  onChange,
  mode,
  className = '',
  onWarning,
}: VditorMarkdownEditorProps) {
  const { registerInsertHandler } = useNotes()
  const reactId = useId().replace(/:/g, '')
  // mode 编进 id:切内核时容器 id 必变,配合 key 让 React 换一个全新节点,
  // 彻底避开 destroy() 复原 innerHTML 后的残留
  const containerId = `vditor-notes-${reactId}-${mode}`
  const mountRef = useRef<HTMLDivElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const onChangeRef = useRef(onChange)
  const onWarningRef = useRef(onWarning)
  // 程序化写入期间屏蔽 input 回调,防「写入 → input → onChange → setState → 再写入」回环
  const suppressChangeRef = useRef(false)
  // 只在挂载时喂给 Vditor;挂载 effect 不能依赖 value,否则每次打字都重建实例
  const latestValueRef = useRef(value)
  // lute 是异步加载的,资源就位前 getValue/setValue 都不可用
  const readyRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onWarningRef.current = onWarning
  }, [onWarning])

  useEffect(() => {
    latestValueRef.current = value
  }, [value])

  useEffect(() => {
    registerInsertHandler((prefix: string, suffix = '') => {
      const vditor = vditorRef.current
      if (!vditor || !readyRef.current) return
      try {
        // 必须用 insertMD:insertValue 走 innerHTML 解析,会把 markdown 里的换行吃掉
        vditor.insertMD(prefix + suffix)
        // insertMD 不触发 input 回调,手动同步一次
        const md = vditor.getValue()
        latestValueRef.current = md
        onChangeRef.current?.(md)
      } catch (err) {
        console.error('插入文本失败:', err)
      }
    })
  }, [registerInsertHandler])

  useEffect(() => {
    if (!mountRef.current) return

    readyRef.current = false
    const dark = isDark()

    // after 在 lute 就绪、UI 初始化完成后触发,那时才能安全调用实例方法。
    // 用闭包变量而非 ref:构造尚未返回时 after 若被同步调用,也不会拿到上一个实例
    let instance: Vditor | null = null

    const vditor = new Vditor(containerId, {
      cdn: CDN,
      mode,
      value: latestValueRef.current,
      lang: 'zh_CN',
      icon: 'ant',
      theme: dark ? 'dark' : 'classic',
      height: '100%',
      // 状态统一由 NotesContext 管,不让 Vditor 自己在 localStorage 里存一份
      cache: { enable: false },
      // 右下角已有统计胶囊,关掉内置字数
      counter: { enable: false },
      outline: { enable: false, position: 'left' },
      toolbar: TOOLBAR,
      preview: {
        theme: { current: dark ? 'dark' : 'light' },
        hljs: { style: dark ? 'github-dark' : 'github', lineNumber: true },
      },
      input: (md: string) => {
        if (suppressChangeRef.current) return
        latestValueRef.current = md
        onChangeRef.current?.(md)
      },
      after: () => {
        readyRef.current = true
        // 进模式即提示,不等用户真改了才说
        if (CHERRY_ONLY_BLOCK.test(latestValueRef.current)) {
          onWarningRef.current?.(
            '本文含 Cherry 专有语法(::: 块),该语法不属于 GFM。在当前模式下编辑会被 Lute 重新规范化并丢失这些块的结构,建议切回「双栏」编辑,或先手动替换为标准 Markdown。'
          )
        }
        // 初始化期间外部可能已改过 value,补一次同步
        if (instance && instance.getValue() !== latestValueRef.current) {
          suppressChangeRef.current = true
          try {
            instance.setValue(latestValueRef.current, true)
          } finally {
            requestAnimationFrame(() => {
              suppressChangeRef.current = false
            })
          }
        }
      },
    })

    instance = vditor
    vditorRef.current = vditor

    // 全站换肤只改 documentElement 的 class,Vditor 有三套主题要一起切
    const themeObserver = new MutationObserver(() => {
      const current = vditorRef.current
      if (!current || !readyRef.current) return
      const isDarkNow = isDark()
      current.setTheme(
        isDarkNow ? 'dark' : 'classic',
        isDarkNow ? 'dark' : 'light',
        isDarkNow ? 'github-dark' : 'github'
      )
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      themeObserver.disconnect()
      readyRef.current = false
      try {
        vditor.destroy()
      } catch {
        // ignore
      }
      vditorRef.current = null
    }
  }, [containerId, mode])

  useEffect(() => {
    const vditor = vditorRef.current
    if (!vditor || !readyRef.current) return

    // 先比较再写:用户打字引起的回流不该触发 setValue,否则光标会被重置
    if (vditor.getValue() === value) return

    suppressChangeRef.current = true
    try {
      vditor.setValue(value, true)
    } finally {
      // 给渲染一帧时间,避免把程序写入当作用户编辑
      requestAnimationFrame(() => {
        suppressChangeRef.current = false
      })
    }
  }, [value])

  return (
    <div className={`vditor-notes-editor h-full min-h-0 ${className}`}>
      <div key={containerId} id={containerId} ref={mountRef} className="h-full w-full" />
    </div>
  )
}
