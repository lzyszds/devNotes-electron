import { useEffect, useState } from "react";
import {
  Bot,
  Cloud,
  Keyboard,
  Languages,
  PanelLeft,
  Settings2,
  Volume2,
  X,
} from "lucide-react";
import type { ComponentType } from "react";
import { usePresence } from "../../hooks/usePresence";
import GeneralPanel from "../settings/GeneralPanel";
import ShortcutSettingsPanel from "../settings/ShortcutSettingsPanel";
import CloudflareSyncPanel from "../settings/CloudflareSyncPanel";
import TranslateApiPanel from "../settings/TranslateApiPanel";
import AiChannelPanel from "../settings/AiChannelPanel";
import SpeechPanel from "../settings/SpeechPanel";
import InterfacePanel from "../settings/InterfacePanel";
import Tooltip from "../ui/Tooltip";

export type SettingsSection =
  | "general"
  | "interface"
  | "shortcuts"
  | "cloud-sync"
  | "ai-channel"
  | "translate-api"
  | "speech";

export interface SettingsModalProps {
  open: boolean;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onResetSidebarWidth: () => void;
}

interface SectionMeta {
  id: SettingsSection;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}

/** 设置分区元数据：⌘K 搜索也要按分区直达，导出共用 */
export const SETTINGS_SECTIONS: SectionMeta[] = [
  { id: "general", label: "通用", hint: "笔记保存与关于信息", icon: Settings2 },
  {
    id: "interface",
    label: "界面",
    hint: "左侧菜单栏与布局",
    icon: PanelLeft,
  },
  {
    id: "shortcuts",
    label: "快捷键",
    hint: "全局与应用内键位自定义",
    icon: Keyboard,
  },
  {
    id: "cloud-sync",
    label: "云同步",
    hint: "私有服务器与多端数据同步",
    icon: Cloud,
  },
  {
    id: "ai-channel",
    label: "AI 渠道",
    hint: "项目 AI 的服务商、Key 与模型",
    icon: Bot,
  },
  {
    id: "translate-api",
    label: "AI 与翻译",
    hint: "在线翻译接口与模型配置",
    icon: Languages,
  },
  {
    id: "speech",
    label: "语音朗读",
    hint: "朗读音色、语速与音量",
    icon: Volume2,
  },
];

export default function SettingsModal({
  open,
  section,
  onSectionChange,
  onClose,
  onResetSidebarWidth,
}: SettingsModalProps) {
  const { mounted, state } = usePresence(open, 180);

  // 记录已经访问过的 section 集合
  const [visitedSections, setVisitedSections] = useState<Set<SettingsSection>>(
    () => new Set<SettingsSection>([section]),
  );

  useEffect(() => {
    if (open) {
      setVisitedSections((prev) => {
        if (prev.has(section)) return prev;
        const next = new Set(prev);
        next.add(section);
        return next;
      });
    }
  }, [open, section]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  const activeMeta =
    SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-state={state}
      className="fe-fade fixed inset-0 z-[60] flex items-center justify-center p-3 md:p-6 bg-black/40 backdrop-blur-2xs select-none"
    >
      <div
        data-state={state}
        className="fe-modal w-full max-w-4xl h-[92vh] max-h-[720px] bg-white rounded-2xl shadow-2xl border border-[#E6E6E3] flex flex-col overflow-hidden"
      >
        {/* 顶部标题栏 */}
        <div className="h-12 border-b border-[#E6E6E3] bg-[#F3F3F1] px-4 md:px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[#191918]">系统设置</span>
            <span className="text-[#E6E6E3]">/</span>
            <span className="text-xs text-[#787774] font-medium">
              {activeMeta.label}
            </span>
          </div>

          <Tooltip content="关闭设置（Esc）">
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-white hover:bg-[#EAEAE7] border border-[#E6E6E3] flex items-center justify-center text-[#787774] hover:text-[#191918] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>

        {/* 主体分栏 */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 bg-white">
          {/* 左侧分类导航 */}
          <nav className="w-full md:w-56 bg-[#F3F3F1] border-b md:border-b-0 md:border-r border-[#E6E6E3] p-2.5 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto flex-shrink-0">
            {SETTINGS_SECTIONS.map((item) => {
              const active = section === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSectionChange(item.id)}
                  className={`flex-shrink-0 md:w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left whitespace-nowrap transition-all cursor-pointer ${
                    active
                      ? "bg-[#1C1C1C] text-white shadow-xs"
                      : "text-[#191918] hover:bg-[#EAEAE7]"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 flex-shrink-0 ${
                      active ? "text-white" : "text-[#787774]"
                    }`}
                  />
                  <span className="flex-1 min-w-0">
                    <span
                      className={`block text-xs truncate ${
                        active
                          ? "font-bold text-white"
                          : "font-medium text-[#191918]"
                      }`}
                    >
                      {item.label}
                    </span>
                    <span
                      className={`hidden md:block text-[10px] truncate ${
                        active ? "text-[#D4D4D0]" : "text-[#787774]"
                      }`}
                    >
                      {item.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* 右侧面板内容 */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 min-w-0 bg-[#FFFFFF]">
            {visitedSections.has("general") && (
              <div className={section === "general" ? "block" : "hidden"}>
                <GeneralPanel onResetSidebarWidth={onResetSidebarWidth} />
              </div>
            )}
            {visitedSections.has("interface") && (
              <div className={section === "interface" ? "block" : "hidden"}>
                <InterfacePanel />
              </div>
            )}
            {visitedSections.has("shortcuts") && (
              <div className={section === "shortcuts" ? "block" : "hidden"}>
                <ShortcutSettingsPanel />
              </div>
            )}
            {visitedSections.has("cloud-sync") && (
              <div className={section === "cloud-sync" ? "block" : "hidden"}>
                <CloudflareSyncPanel />
              </div>
            )}
            {visitedSections.has("ai-channel") && (
              <div className={section === "ai-channel" ? "block" : "hidden"}>
                <AiChannelPanel />
              </div>
            )}
            {visitedSections.has("translate-api") && (
              <div className={section === "translate-api" ? "block" : "hidden"}>
                <TranslateApiPanel />
              </div>
            )}
            {visitedSections.has("speech") && (
              <div className={section === "speech" ? "block" : "hidden"}>
                <SpeechPanel />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
