import { useCallback, useEffect, useId, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import Cherry from 'cherry-markdown'
import 'cherry-markdown/dist/cherry-markdown.css'
import { useNotes } from '../../context/NotesContext'
import { useCherryContextMenu } from '../../hooks/useCherryContextMenu'

type CherryInstance = InstanceType<typeof Cherry>

export type CherryMarkdownEditorProps = {
  value: string
  onChange?: (markdown: string) => void
  className?: string
  /** 当前笔记标题，供右键菜单的「Front Matter」「当前文档信息」使用 */
  title?: string
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export default function CherryMarkdownEditor({
  value,
  onChange,
  className = '',
  title = '',
}: CherryMarkdownEditorProps) {
  const { registerInsertHandler } = useNotes()
  const reactId = useId().replace(/:/g, '')
  const containerId = `cherry-notes-${reactId}`
  const mountRef = useRef<HTMLDivElement>(null)
  const cherryRef = useRef<CherryInstance | null>(null)
  const onChangeRef = useRef(onChange)
  const suppressChangeRef = useRef(false)
  const latestValueRef = useRef(value)

  const { onEditorContextMenu, onPreviewContextMenu } = useCherryContextMenu({
    cherryRef,
    title,
  })

  /**
   * 编辑区与预览区同在这个容器里，按事件目标分流：
   * - .cm-editor      → 可编辑菜单（真正能改文档）
   * - .cherry-previewer → 只读菜单（复制/导出）
   * 工具栏、TOC 侧栏等其它区域不接管，交给浏览器默认行为。
   */
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('.cm-editor')) {
        onEditorContextMenu(event)
        return
      }
      if (target.closest('.cherry-previewer')) {
        onPreviewContextMenu(event)
      }
    },
    [onEditorContextMenu, onPreviewContextMenu]
  )

  useEffect(() => {
    registerInsertHandler((prefix: string, suffix = '') => {
      const cherry = cherryRef.current
      if (!cherry) return
      try {
        const current = cherry.getMarkdown()
        const newMd = current + (current.endsWith('\n') ? '' : '\n') + prefix + suffix
        cherry.setMarkdown(newMd, false)
        onChangeRef.current?.(newMd)
      } catch (err) {
        console.error('Insert text failed:', err)
      }
    })
  }, [registerInsertHandler])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    latestValueRef.current = value
  }, [value])

  useEffect(() => {
    if (!mountRef.current) return

    const cherry = new Cherry({
      id: containerId,
      value: latestValueRef.current,
      locale: 'zh_CN',
      nameSpace: 'fehelper-cherry-notes',
      forceAppend: false,
      autoScrollByCursor: true,
      editor: {
        defaultModel: 'edit&preview',
        keepDocumentScrollAfterInit: true,
        showSuggestList: true,
        codemirror: {
          placeholder: '输入文本或「/」开始编辑',
        },
      },
      engine: {
        syntax: {
          panel: {
            enableJustify: true,
            enableAlign: true,
            enablePanel: true,
            enableCols: true,
            enableTabs: true,
            enableTimeline: true,
          },
        },
      },
      toolbars: {
        theme: 'light',
        showToolbar: true,
        toolbar: [
          'bold',
          'italic',
          'size',
          'color',
          '|',
          'header',
          'list',
          'panel',
          'justify',
          'checklist',
          'detail',
          '|',
          {
            insert: [
              'image',
              'link',
              'hr',
              'br',
              'code',
              'quote',
              'toc',
              'table',
              'detail',
              'timeline',
            ],
          },
          'table',
          'graph',
          'timeline',
          '|',
          'search',
          'shortcutKey',
        ],
        toolbarRight: ['switchModel', 'fullScreen', 'export'],
        bubble: [
          'bold',
          'italic',
          'underline',
          'strikethrough',
          'sub',
          'sup',
          'quote',
          '|',
          'size',
          'color',
        ],
        float: ['h1', 'h2', 'h3', '|', 'checklist', 'quote', 'table', 'code', 'timeline'],
        toc: {
          updateLocationHash: false,
          defaultModel: 'pure',
          showAutoNumber: false,
        },
      },
      fileUpload: async (file: File, callback: (url: string, params?: Record<string, unknown>) => void) => {
        try {
          const url = await fileToDataUrl(file)
          callback(url, { name: file.name })
        } catch (error) {
          console.error('笔记附件上传失败:', error)
        }
      },
      callback: {
        afterChange: (md: string) => {
          if (suppressChangeRef.current) return
          latestValueRef.current = md
          onChangeRef.current?.(md)
        },
      },
    })

    cherryRef.current = cherry

    // 容器尺寸变化时刷新编辑区，避免 Tab 切换后高度异常
    const observer = new ResizeObserver(() => {
      try {
        const view = (cherry as any)?.editor?.editor
        view?.requestMeasure?.()
      } catch {
        // ignore
      }
    })
    observer.observe(mountRef.current)

    return () => {
      observer.disconnect()
      try {
        cherry.destroy()
      } catch {
        // ignore
      }
      cherryRef.current = null
    }
  }, [containerId])

  useEffect(() => {
    const cherry = cherryRef.current
    if (!cherry) return

    const current = cherry.getMarkdown()
    if (current === value) return

    suppressChangeRef.current = true
    try {
      cherry.setMarkdown(value, false)
    } finally {
      // 给渲染一帧时间，避免把程序写入当作用户编辑
      requestAnimationFrame(() => {
        suppressChangeRef.current = false
      })
    }
  }, [value])

  return (
    <div
      className={`cherry-notes-editor h-full min-h-0 ${className}`}
      onContextMenu={handleContextMenu}
    >
      <div id={containerId} ref={mountRef} className="h-full w-full" />
    </div>
  )
}
