/**
 * 自绘窗口控制按钮（macOS 风格红绿灯）。
 *
 * 窗口改成无边框之后，系统标题栏连同它自带的三个按钮一起没了，这里就是最小化 /
 * 最大化 / 关闭的唯一入口。三个视图各有一条自己的顶栏（DashboardLayout 的常驻顶栏、
 * Stats 的统计顶栏、Home 的叠加层），所以抽出来共用；Home 那条是刻意做淡的叠加层设计、
 * 另外还带一组图标按钮，样式不同，仍单独保留。
 */
interface WindowControlsProps {
  className?: string
}

export default function WindowControls({ className = '' }: WindowControlsProps) {
  return (
    <div className={`no-drag flex items-center gap-1.5 ${className}`}>
      <div
        onClick={() => window.electronAPI?.closeWindow()}
        className="w-3 h-3 rounded-full bg-rose-500/80 hover:brightness-110 cursor-pointer transition-transform active:scale-90"
        title="关闭窗口"
      />
      <div
        onClick={() => window.electronAPI?.minimizeWindow()}
        className="w-3 h-3 rounded-full bg-amber-500/80 hover:brightness-110 cursor-pointer transition-transform active:scale-90"
        title="最小化"
      />
      <div
        onClick={() => window.electronAPI?.maximizeWindow()}
        className="w-3 h-3 rounded-full bg-emerald-500/80 hover:brightness-110 cursor-pointer transition-transform active:scale-90"
        title="最大化 / 还原"
      />
    </div>
  )
}
