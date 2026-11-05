import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { computerSuiteTools, type ComputerSuiteToolId } from '../../../types'
import DevToolboxLoader from '../../ui/DevToolboxLoader'

/*
 * 电脑配置大模块的主画布容器。
 *
 * 这个模块不在工具库（tools）里，而是和 Markdown 笔记、代码片段库并列的
 * 一级路由：左栏有独立入口，DashboardLayout 专属一个二级侧边栏（子工具
 * 列表），本组件只负责主画布内的子工具切换。
 *
 * 子工具沿用 ToolPage 的 Keep-Alive 模式：进入过的组件用 display:none
 * 隐藏而不是卸载（网速历史、进程扫描结果、探测任务进度都不丢）。
 * 子工具页都已按 isActive 驱动自己的后台轮询，隐藏即暂停。
 */
const SystemInspectorTool = lazy(() => import('../../tools/SystemInspectorTool'))
const DiskAnalyzerTool = lazy(() => import('../../tools/DiskAnalyzerTool'))
const DeveloperEnvironmentTool = lazy(() => import('../../tools/DeveloperEnvironmentTool'))
const SpeedTestTool    = lazy(() => import('../../tools/SpeedTestTool'))
const NetProbeTool     = lazy(() => import('../../tools/NetProbeTool'))
const PortKillerTool   = lazy(() => import('../../tools/PortKillerTool'))

const subToolComponents: Record<ComputerSuiteToolId, React.ComponentType<any>> = {
  'sys-inspector': SystemInspectorTool,
  'disk-analyzer': DiskAnalyzerTool,
  'dev-environment': DeveloperEnvironmentTool,
  'speed-test':    SpeedTestTool,
  'net-probe':     NetProbeTool,
  'port-killer':   PortKillerTool,
}

function SubToolLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <DevToolboxLoader title="正在加载…" subtitle="首次进入该子工具时按需加载" />
    </div>
  )
}

export interface ComputerSuiteProps {
  /** 当前子工具（受控：状态提升到 DashboardLayout，二级侧边栏与旧 id 深链接都要改它） */
  subTool: ComputerSuiteToolId
}

export default function ComputerSuite({ subTool }: ComputerSuiteProps) {
  /*
   * visited 集合：进过的子工具保持挂载。列表迭代 computerSuiteTools 而不是
   * visited，保证挂载顺序稳定（key 不变才不会因切页而卸载重建）。
   */
  const visitedRef = useRef<Set<ComputerSuiteToolId>>(new Set([subTool]))
  const [visited, setVisited] = useState<ComputerSuiteToolId[]>([subTool])

  useEffect(() => {
    if (visitedRef.current.has(subTool)) return
    visitedRef.current.add(subTool)
    setVisited((prev) => (prev.includes(subTool) ? prev : [...prev, subTool]))
  }, [subTool])

  return (
    <div className="h-full w-full bg-white flex flex-col overflow-hidden relative">
      {computerSuiteTools.map((tool) => {
        const id = tool.id as ComputerSuiteToolId
        const Sub = subToolComponents[id]
        if (!Sub || !visited.includes(id)) return null
        const isActive = id === subTool
        return (
          <div
            key={id}
            className={`absolute inset-0 flex flex-col overflow-hidden ${isActive ? 'visible z-10' : 'hidden'}`}
            aria-hidden={!isActive}
          >
            <Suspense fallback={<SubToolLoading />}>
              <Sub isActive={isActive} />
            </Suspense>
          </div>
        )
      })}
    </div>
  )
}
