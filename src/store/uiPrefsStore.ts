import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { electronPersistStorage } from "./electronPersistStorage";
import {
  peekLegacyLocalJson,
  peekLegacyLocalString,
  purgeLegacyLocalKeys,
} from "./migrateLocalKey";

const PERSIST_NAME = "ui-prefs-persist-v1";

const LEGACY_KEYS = [
  "devnotes-foldertree-open",
  "devnotes-suite-sub-tool",
  "devnotes-opened-tool-tabs",
  "devnotes-last-tool-id",
  "fehelper-editor-mode",
  "fehelper-editor-view",
  "fehelper-editor-zoom",
  "fehelper-code-theme",
  "fehelper-editor-split",
  "text-translate-primary-lang",
  "fehelper-speech-settings",
  "fehelper-speedtest-history",
  "fehelper-usage-stats",
  "fehelper-theme",
] as const;

export type EditorMode = "rich" | "source" | string;
export type EditorViewMode = string;

type UiPrefsState = {
  folderTreeOpen: boolean;
  suiteSubTool: string;
  openedToolTabs: string[];
  lastToolId: string;
  editorMode: string;
  editorView: string;
  editorZoom: number;
  codeBlockTheme: string;
  editorSplit: number;
  primaryLang: string;
  speechSettings: Record<string, unknown>;
  speedtestHistory: unknown[];
  usageStats: Record<string, unknown>;
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  setFolderTreeOpen: (v: boolean) => void;
  setSuiteSubTool: (id: string) => void;
  setOpenedToolTabs: (tabs: string[]) => void;
  setLastToolId: (id: string) => void;
  setEditorMode: (mode: string) => void;
  setEditorView: (mode: string) => void;
  setEditorZoom: (zoom: number) => void;
  setCodeBlockTheme: (id: string) => void;
  setEditorSplit: (ratio: number) => void;
  setPrimaryLang: (lang: string) => void;
  setSpeechSettings: (settings: Record<string, unknown>) => void;
  setSpeedtestHistory: (history: unknown[]) => void;
  clearSpeedtestHistory: () => void;
  setUsageStats: (stats: Record<string, unknown>) => void;
};

function adoptLegacy(partial: Partial<UiPrefsState>): Partial<UiPrefsState> {
  const next = { ...partial };

  const folder = peekLegacyLocalString("devnotes-foldertree-open");
  if (folder != null) next.folderTreeOpen = folder === "true";

  const suite = peekLegacyLocalString("devnotes-suite-sub-tool");
  if (suite) next.suiteSubTool = suite;

  const tabs = peekLegacyLocalJson<string[]>("devnotes-opened-tool-tabs");
  if (Array.isArray(tabs) && tabs.length) next.openedToolTabs = tabs.slice(0, 6);

  const last = peekLegacyLocalString("devnotes-last-tool-id");
  if (last) next.lastToolId = last;

  const mode = peekLegacyLocalString("fehelper-editor-mode");
  if (mode) next.editorMode = mode;

  const view = peekLegacyLocalString("fehelper-editor-view");
  if (view) next.editorView = view;

  const zoomRaw = peekLegacyLocalString("fehelper-editor-zoom");
  if (zoomRaw != null) {
    const z = Number(zoomRaw);
    if (Number.isFinite(z) && z > 0) next.editorZoom = z;
  }

  const codeTheme = peekLegacyLocalString("fehelper-code-theme");
  if (codeTheme) next.codeBlockTheme = codeTheme;

  const splitRaw = peekLegacyLocalString("fehelper-editor-split");
  if (splitRaw != null) {
    const s = Number(splitRaw);
    // 新约定 0~1；旧 localStorage 写的是 20~80 的百分比整数
    if (Number.isFinite(s) && s > 0 && s < 1) next.editorSplit = s;
    else if (Number.isFinite(s) && s >= 20 && s <= 80) next.editorSplit = s / 100;
  }

  const lang = peekLegacyLocalString("text-translate-primary-lang");
  if (lang) next.primaryLang = lang;

  const speech = peekLegacyLocalJson<Record<string, unknown>>(
    "fehelper-speech-settings",
  );
  if (speech && typeof speech === "object") next.speechSettings = speech;

  const history = peekLegacyLocalJson<unknown[]>("fehelper-speedtest-history");
  if (Array.isArray(history)) next.speedtestHistory = history;

  const usage = peekLegacyLocalJson<Record<string, unknown>>(
    "fehelper-usage-stats",
  );
  if (usage && typeof usage === "object") next.usageStats = usage;

  purgeLegacyLocalKeys([...LEGACY_KEYS]);
  return next;
}

export const useUiPrefsStore = create<UiPrefsState>()(
  persist(
    (set) => ({
      folderTreeOpen: false,
      suiteSubTool: "sys-inspector",
      openedToolTabs: ["json-toolbox"],
      lastToolId: "json-toolbox",
      editorMode: "milkdown",
      editorView: "split",
      editorZoom: 100,
      codeBlockTheme: "one-dark-pro",
      editorSplit: 0.5,
      primaryLang: "zh",
      speechSettings: {},
      speedtestHistory: [],
      usageStats: {},
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      setFolderTreeOpen: (folderTreeOpen) => set({ folderTreeOpen }),
      setSuiteSubTool: (suiteSubTool) => set({ suiteSubTool }),
      setOpenedToolTabs: (openedToolTabs) => set({ openedToolTabs }),
      setLastToolId: (lastToolId) => set({ lastToolId }),
      setEditorMode: (editorMode) => set({ editorMode }),
      setEditorView: (editorView) => set({ editorView }),
      setEditorZoom: (editorZoom) => set({ editorZoom }),
      setCodeBlockTheme: (codeBlockTheme) => set({ codeBlockTheme }),
      setEditorSplit: (editorSplit) => set({ editorSplit }),
      setPrimaryLang: (primaryLang) => set({ primaryLang }),
      setSpeechSettings: (speechSettings) => set({ speechSettings }),
      setSpeedtestHistory: (speedtestHistory) => set({ speedtestHistory }),
      clearSpeedtestHistory: () => set({ speedtestHistory: [] }),
      setUsageStats: (usageStats) => set({ usageStats }),
    }),
    {
      name: PERSIST_NAME,
      storage: createJSONStorage(() => electronPersistStorage),
      partialize: (s) => ({
        folderTreeOpen: s.folderTreeOpen,
        suiteSubTool: s.suiteSubTool,
        openedToolTabs: s.openedToolTabs,
        lastToolId: s.lastToolId,
        editorMode: s.editorMode,
        editorView: s.editorView,
        editorZoom: s.editorZoom,
        codeBlockTheme: s.codeBlockTheme,
        editorSplit: s.editorSplit,
        primaryLang: s.primaryLang,
        speechSettings: s.speechSettings,
        speedtestHistory: s.speedtestHistory,
        usageStats: s.usageStats,
      }),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === "object"
            ? (persisted as Partial<UiPrefsState>)
            : {};
        const adopted = adoptLegacy(raw);
        return { ...current, ...adopted };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) {
          purgeLegacyLocalKeys([...LEGACY_KEYS]);
          return;
        }
        const adopted = adoptLegacy({});
        state.setHasHydrated(true);
        if (adopted.folderTreeOpen != null)
          state.setFolderTreeOpen(Boolean(adopted.folderTreeOpen));
        if (adopted.suiteSubTool) state.setSuiteSubTool(adopted.suiteSubTool);
        if (adopted.openedToolTabs)
          state.setOpenedToolTabs(adopted.openedToolTabs);
        if (adopted.lastToolId) state.setLastToolId(adopted.lastToolId);
        if (adopted.editorMode) state.setEditorMode(adopted.editorMode);
        if (adopted.editorView) state.setEditorView(adopted.editorView);
        if (adopted.editorZoom != null)
          state.setEditorZoom(adopted.editorZoom);
        if (adopted.codeBlockTheme)
          state.setCodeBlockTheme(adopted.codeBlockTheme);
        if (adopted.editorSplit != null)
          state.setEditorSplit(adopted.editorSplit);
        if (adopted.primaryLang) state.setPrimaryLang(adopted.primaryLang);
        if (adopted.speechSettings)
          state.setSpeechSettings(adopted.speechSettings);
        if (adopted.speedtestHistory)
          state.setSpeedtestHistory(adopted.speedtestHistory);
        if (adopted.usageStats) state.setUsageStats(adopted.usageStats);
      },
    },
  ),
);
