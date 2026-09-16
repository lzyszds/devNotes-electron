/**
 * 「编辑器 → 外壳」的极简事件总线。
 *
 * 两个信号都握在编辑器手里，却要在顶栏消费：
 * - 大纲开关：条目由 MilkdownMarkdownEditor 解析（需要编辑器的滚动容器），按钮在顶栏
 * - 文档字数：随输入实时变化，只有编辑器手上的 content 是最新的
 *
 * 都隔着好几层组件，用总线比把状态一路提到 DashboardLayout 再传下去更省事。
 */

type OutlineListener = (open: boolean) => void;
const outlineListeners = new Set<OutlineListener>();

export function requestOutline(open: boolean): void {
  outlineListeners.forEach((listener) => listener(open));
}

export function subscribeOutline(listener: OutlineListener): () => void {
  outlineListeners.add(listener);
  return () => {
    outlineListeners.delete(listener);
  };
}

type DocStatsListener = (charCount: number) => void;
const docStatsListeners = new Set<DocStatsListener>();

export function publishDocStats(charCount: number): void {
  docStatsListeners.forEach((listener) => listener(charCount));
}

export function subscribeDocStats(listener: DocStatsListener): () => void {
  docStatsListeners.add(listener);
  return () => {
    docStatsListeners.delete(listener);
  };
}
