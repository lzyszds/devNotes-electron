/*
 * 工具的「工作中」绿点状态。
 *
 * 原来还有一套工具标签（useToolTabs / openToolTab / closeToolTab / keepToolTabs），
 * 是旧版多入口时代给 ToolTabTray 用的；现在工具切换由 DashboardLayout 自己的
 * openedToolTabs 负责，那套标签状态全仓库无人消费，已删除 —— 只留这里真正
 * 在用的「忙」标志。
 *
 * 不落盘：重启后自然清空，避免上次崩溃留下的绿点骗人。
 */

const busyIds = new Set<string>()
const listeners = new Set<() => void>()

export function setToolBusy(id: string, isBusy: boolean) {
  if (busyIds.has(id) === isBusy) return
  if (isBusy) busyIds.add(id)
  else busyIds.delete(id)
  listeners.forEach((listener) => listener())
}
