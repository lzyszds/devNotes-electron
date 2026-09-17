/**
 * 极简事件总线：让工具内部能打开全局设置弹窗，只传「打开哪个设置分类」。
 * 取值需与 SettingsModal 的 SettingsSection 保持一致。
 */

export type AppSettingsTopic = "general" | "cloud-sync" | "translate-api" | "speech";

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
