/** 极简事件总线：让工具内部能打开顶栏的全局设置弹窗，只传「打开哪个设置」 */

export type AppSettingsTopic = "translate-api";

type Listener = (topic: AppSettingsTopic) => void;

const listeners = new Set<Listener>();

export function openAppSettings(topic: AppSettingsTopic): void {
  listeners.forEach((listener) => listener(topic));
}

export function subscribeAppSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
