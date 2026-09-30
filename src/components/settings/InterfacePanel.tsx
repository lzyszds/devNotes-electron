import SidebarLayoutPanel from './SidebarLayoutPanel'

/**
 * 设置 · 界面：与「界面长什么样」有关的偏好。
 *
 * 从「通用」里拆出来的 —— 那边原先塞了外观主题、代码块主题、界面偏好、
 * 左侧菜单栏和关于信息五大块，一屏滚不到底。拆开之后每个分类只回答一件事，
 * 后续再有界面类设置（比如紧凑模式、字号）也往这里放。
 */
export default function InterfacePanel() {
  return (
    <div className="space-y-6">
      <SidebarLayoutPanel />
    </div>
  )
}
