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

/**
 * 阅读位置：编辑器 → 笔记页外壳。
 *
 * 数据握在编辑器手里（滚动容器在它内部，两个内核各有一套），而消费方在外壳 ——
 * 书签按钮要知道「现在读到哪」才能记下来，状态栏要显示当前所在章节。
 * 与大纲开关同理，隔着好几层，用总线比一路提 state 再往下传省事。
 */
export interface ReadingPosition {
  /**
   * 这份上报属于哪篇笔记。
   *
   * 编辑器是 `key={note.id}` 重建的，切笔记后新编辑器要过一帧才第一次上报；
   * 这中间外壳若拿着上一篇的滚动容器，书签校验与「记下当前位置」都会错位，
   * 所以每份上报都自报家门，外壳只认与当前笔记 id 相符的那份。
   */
  noteId: string;
  /** 当前读到的标题下标，-1 表示还没进入正文 */
  activeIndex: number;
  /** 已读百分比 0~100 */
  percent: number;
  /** 现在所在标题的文本，供状态栏显示 */
  heading: string;
  /**
   * 当前内核的正文滚动容器。书签的抓取与还原都要拿它算坐标，
   * 而它只存在于编辑器内部 —— 外壳直接引用它即可，不必再回编辑器绕一圈。
   */
  container: HTMLElement | null;
}

type ReadingPositionListener = (position: ReadingPosition) => void;
const readingPositionListeners = new Set<ReadingPositionListener>();

export function publishReadingPosition(position: ReadingPosition): void {
  readingPositionListeners.forEach((listener) => listener(position));
}

export function subscribeReadingPosition(listener: ReadingPositionListener): () => void {
  readingPositionListeners.add(listener);
  return () => {
    readingPositionListeners.delete(listener);
  };
}

/** 外壳 → 编辑器：滚到某条书签记下的位置 */
type ReadingJumpListener = (target: ReadingJumpTarget) => void;

export interface ReadingJumpTarget {
  /** 目标章节标题，用于认领 DOM 里的标题元素 */
  heading: string;
  /** 章节内偏移比例 0~1 */
  offset: number;
}

const readingJumpListeners = new Set<ReadingJumpListener>();

export function requestReadingJump(target: ReadingJumpTarget): void {
  readingJumpListeners.forEach((listener) => listener(target));
}

export function subscribeReadingJump(listener: ReadingJumpListener): () => void {
  readingJumpListeners.add(listener);
  return () => {
    readingJumpListeners.delete(listener);
  };
}

/**
 * 外壳 → 编辑器：跳到某一节（大纲目录点条目走这条）。
 *
 * Cherry 没有自己的跳转实现，Milkdown 那套自绘的也不在编辑器外部 ——
 * 统一由总线递给当前挂载的内核，各自用自己最稳的方式滚过去。
 */
type OutlineJumpListener = (index: number) => void;
const outlineJumpListeners = new Set<OutlineJumpListener>();

export function requestOutlineJump(index: number): void {
  outlineJumpListeners.forEach((listener) => listener(index));
}

export function subscribeOutlineJump(listener: OutlineJumpListener): () => void {
  outlineJumpListeners.add(listener);
  return () => {
    outlineJumpListeners.delete(listener);
  };
}
