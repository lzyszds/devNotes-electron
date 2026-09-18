/** 并发执行池：最多 concurrency 个任务同时运行；shouldStop 返回 true 时不再取新任务 */
export async function runPool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  const runNext = async (): Promise<void> => {
    while (nextIndex < items.length) {
      // 收到停止信号后不再派发新任务，已在跑的请求自然收尾
      if (shouldStop?.()) break;
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
      completed++;
      onProgress?.(completed, items.length);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runNext()
  );
  await Promise.all(workers);
  return results;
}
