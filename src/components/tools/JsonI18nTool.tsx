import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Languages,
  Copy,
  Download,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
  History,
  X,
  Settings2,
  RefreshCw,
  Globe,
  Zap,
  Check,
  Pencil,
  ArrowLeft,
  Pause,
} from "lucide-react";
import { useToolHistory } from "../../hooks/useToolHistory";
import { useHistoryContextMenu } from "../../hooks/useHistoryContextMenu";
import { resetGtxCache } from "../../utils/translateFetch";
import {
  extractStrings,
  translateMultiLang,
  DEFAULT_TEXT_CONCURRENCY,
  type LangTranslateResult,
  type TranslationAPI,
} from "../../utils/jsonI18nTranslate";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  mergeSettings,
  type JsonI18nSettings,
} from "../../utils/jsonI18nSettings";
import {
  getCachedTranslateConfig,
  isProvider,
  isProviderConfigured,
  loadTranslateConfig,
  providerLabel,
  subscribeTranslateConfig,
  type TranslateApiConfig,
} from "../../utils/translateConfig";
import { openAppSettings } from "../../utils/settingsBus";
import { LANGUAGES, langName } from "../../utils/languages";
import { BTN, Select, ToolBadge, ToolCard, ToolCardFooter, ToolCardHeader, ToolEmpty, ToolHistoryOverlay, ToolNotice, ToolShell, ToolTag, CodeEditor, iconButtonClass } from "../ui";
import Tooltip from "../ui/Tooltip";

type TranslationMode = "full" | "path" | "key-mapping";
type ProxyMode = "system" | "manual" | "direct";

interface KeyMapping {
  original: string;
  translated: string;
}

interface LangResultState extends LangTranslateResult {
  progress?: { current: number; total: number };
  translating?: boolean;
}

const PROTECTED_TERMS_STORAGE_KEY = "json-i18n-protected-terms";
const DEFAULT_PROTECTED_TERMS = ["QQlink", "QQLink"];

/** 统一控件尺寸：高度 36px、圆角、字号 —— 数值与 ui/ToolKit 里的设计令牌一致 */
const UI = {
  row: "flex flex-wrap items-center gap-2 min-h-9",
  divider: "w-px h-5 bg-slate-200 dark:bg-dark-border shrink-0 mx-0.5",
  btn: "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-[10px] border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-panel text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 shrink-0 dark:hover:border-slate-600 dark:hover:bg-dark-hover dark:hover:text-white",
  btnActive: "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-[10px] border text-xs font-semibold shrink-0 transition-colors",
  btnIcon: "inline-flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 shrink-0 dark:text-slate-500 dark:hover:bg-dark-hover dark:hover:text-slate-200",
  select: "shrink-0",
  input:
    "h-9 px-3 rounded-[10px] border border-slate-200/80 dark:border-dark-border bg-white dark:bg-dark-panel text-[13px] text-slate-800 dark:text-slate-100 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-300 dark:placeholder:text-slate-600",
  segment: "flex h-8 p-0.5 bg-slate-100 dark:bg-dark-hover rounded-[10px] shrink-0",
  segmentItem: "h-full px-3 rounded-lg text-[11px] font-semibold transition-colors",
  panel:
    "px-4 md:px-6 py-3 border-b border-slate-100 dark:border-dark-border flex items-center gap-2 flex-wrap min-h-[52px]",
  label: "text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0",
} as const;

/** 引擎名到中控条缩写标签的映射 */
const API_LABELS: Record<TranslationAPI, string> = {
  gtx: "GTX",
  mymemory: "MyMemory",
  openai: "OpenAI",
  libretranslate: "LibreTranslate",
};

const ToolbarDivider = () => <div className={UI.divider} />;

const SettingToggle = ({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <label className="flex items-start gap-2.5 cursor-pointer select-none min-w-[200px]">
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-5 w-9 rounded-full transition shrink-0 ${
        checked ? "bg-brand-600" : "bg-slate-200 dark:bg-dark-hover"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
    <span>
      <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      <span className="block text-[10px] text-slate-400 dark:text-slate-500 leading-snug mt-0.5">{desc}</span>
    </span>
  </label>
);

// Tree View
const JsonTreeView = ({ data }: { data: unknown }) => (
  <div className="font-mono text-[13px] leading-relaxed select-text">
    <TreeNode value={data} path="" isLast={true} />
  </div>
);

const TreeNode = ({
  value,
  path,
  isLast,
  label,
}: {
  value: unknown;
  path: string;
  isLast: boolean;
  label?: string;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const isEmpty =
    isObject &&
    (isArray ? value.length === 0 : Object.keys(value as object).length === 0);

  const renderValue = (val: unknown) => {
    if (val === null)
      return <span className="text-rose-500 dark:text-rose-400 font-bold italic">null</span>;
    if (typeof val === "string")
      return <span className="text-emerald-600 dark:text-emerald-400">"{val}"</span>;
    if (typeof val === "number")
      return <span className="text-sky-600 dark:text-sky-400 font-bold">{val}</span>;
    if (typeof val === "boolean")
      return (
        <span className="text-amber-600 dark:text-amber-400 font-bold">{val.toString()}</span>
      );
    return null;
  };

  if (!isObject) {
    return (
      <div className="flex items-start py-0.5">
        {label && (
          <span className="text-slate-900 dark:text-slate-100 font-bold mr-2">"{label}":</span>
        )}
        {renderValue(value)}
        {!isLast && <span className="text-slate-400 dark:text-slate-500">,</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center py-0.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-dark-hover rounded px-1 -ml-1"
        onClick={() => !isEmpty && setIsExpanded(!isExpanded)}
      >
        <div className="w-4 h-4 flex items-center justify-center mr-1 text-slate-300 dark:text-slate-600">
          {!isEmpty &&
            (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </div>
        {label && (
          <span className="text-slate-900 dark:text-slate-100 font-bold mr-2">"{label}":</span>
        )}
        <span className="text-slate-400 dark:text-slate-500 font-bold">
          {isArray ? "[" : "{"}
          {!isExpanded && !isEmpty && (
            <span className="mx-1 text-slate-300 dark:text-slate-600 text-[10px]">...</span>
          )}
          {!isExpanded && (isArray ? "]" : "}")}
        </span>
      </div>
      {isExpanded && !isEmpty && (
        <div className="ml-4 border-l border-slate-100 dark:border-dark-border pl-4">
          {isArray
            ? (value as unknown[]).map((item, i) => (
                <TreeNode
                  key={i}
                  value={item}
                  path={`${path}[${i}]`}
                  isLast={i === (value as unknown[]).length - 1}
                />
              ))
            : Object.entries(value as Record<string, unknown>).map(
                ([key, val], i, arr) => (
                  <TreeNode
                    key={key}
                    value={val}
                    label={key}
                    path={path ? `${path}.${key}` : key}
                    isLast={i === arr.length - 1}
                  />
                )
              )}
        </div>
      )}
      {isExpanded && (
        <div className="py-0.5">
          <span className="text-slate-400 dark:text-slate-500 font-bold ml-5">
            {isArray ? "]" : "}"}
            {!isLast && ","}
          </span>
        </div>
      )}
    </div>
  );
};

export default function JsonI18nTool() {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [sourceLang, setSourceLang] = useState("zh");
  const [targetLangs, setTargetLangs] = useState<string[]>(["en"]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationMode, setTranslationMode] =
    useState<TranslationMode>("full");
  const [translationApi, setTranslationApi] = useState<TranslationAPI>("gtx");
  // 用户自填的在线翻译接口配置（openai / libretranslate 两个引擎共用）
  const [translateConfig, setTranslateConfig] = useState<TranslateApiConfig>(
    getCachedTranslateConfig()
  );
  const [jsonPath, setJsonPath] = useState("");
  const [keyMappings, setKeyMappings] = useState<KeyMapping[]>([]);
  const [newMappingOriginal, setNewMappingOriginal] = useState("");
  const [newMappingTranslated, setNewMappingTranslated] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  /** 页面视图机：编辑 → （翻译中覆盖层）→ 结果列表 → 单语言详情 */
  const [view, setView] = useState<"edit" | "results" | "detail">("edit");
  const [detailLang, setDetailLang] = useState<string | null>(null);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showTargetDropdown, setShowTargetDropdown] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [textConcurrency, setTextConcurrency] = useState(
    DEFAULT_TEXT_CONCURRENCY
  );
  const [langResults, setLangResults] = useState<Record<string, LangResultState>>({});
    const [proxyMode, setProxyMode] = useState<ProxyMode>("system");
  const [proxyUrl, setProxyUrl] = useState("127.0.0.1:7890");
  const [proxyStatus, setProxyStatus] = useState("");
  const [testingProxy, setTestingProxy] = useState(false);
    const [protectedTerms, setProtectedTerms] = useState<string[]>(DEFAULT_PROTECTED_TERMS);
  const [newProtectedTerm, setNewProtectedTerm] = useState("");
    const [settings, setSettings] = useState<JsonI18nSettings>(DEFAULT_SETTINGS);
  const resultsRef = useRef<HTMLDivElement>(null);
  /** 「暂停」标记：置 true 后不再派发新的翻译请求，在跑的批次自然收尾 */
  const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);

  const { history, saveHistory, clearHistory, removeHistoryItem } = useToolHistory<string>(
    "json-i18n"
  );
  // 历史记录右键菜单
  const openHistoryMenu = useHistoryContextMenu<string>({
    onUse: (item) => {
      setInput(item.data);
      setShowHistory(false);
    },
    onRemove: removeHistoryItem,
  });

  useEffect(() => {
    window.electronAPI?.getProxyConfig?.().then((config) => {
      if (config) {
        setProxyMode(config.mode);
        if (config.url) setProxyUrl(config.url);
      }
    });
    window.electronAPI?.storeGet?.(PROTECTED_TERMS_STORAGE_KEY).then((saved) => {
      if (Array.isArray(saved) && saved.length > 0) {
        setProtectedTerms(saved);
      }
    });
    window.electronAPI?.storeGet?.(SETTINGS_STORAGE_KEY).then((saved) => {
      if (saved && typeof saved === "object") {
        setSettings(mergeSettings(saved as Partial<JsonI18nSettings>));
      }
    });
    // 自定义在线翻译接口配置：读入一次，之后靠订阅同步顶栏弹窗的保存结果
    loadTranslateConfig().then(setTranslateConfig);
    return subscribeTranslateConfig(setTranslateConfig);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<JsonI18nSettings>) => {
    setSettings((prev) => {
      const next = mergeSettings({ ...prev, ...patch });
      window.electronAPI?.storeSet?.(SETTINGS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const downloadLangData = (lang: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `i18n_${lang}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveProtectedTerms = async (terms: string[]) => {
    setProtectedTerms(terms);
    await window.electronAPI?.storeSet?.(PROTECTED_TERMS_STORAGE_KEY, terms);
  };

  const addProtectedTerm = () => {
    const term = newProtectedTerm.trim();
    if (!term || protectedTerms.includes(term)) return;
    const next = [...protectedTerms, term];
    saveProtectedTerms(next);
    setNewProtectedTerm("");
  };

  const removeProtectedTerm = (term: string) => {
    saveProtectedTerms(protectedTerms.filter((t) => t !== term));
  };

  const saveProxyConfig = async () => {
    if (!window.electronAPI?.setProxyConfig) {
      setProxyStatus("仅 Electron 环境支持代理配置");
      return;
    }
    await window.electronAPI.setProxyConfig({
      mode: proxyMode,
      url: proxyMode === "manual" ? proxyUrl : undefined,
    });
    resetGtxCache();
    setProxyStatus("代理配置已保存");
  };

  const testProxyConnection = async () => {
    const api = window.electronAPI;
    if (!api?.testProxy || !api?.setProxyConfig) {
      setProxyStatus("仅 Electron 环境支持代理测试");
      return;
    }
    setTestingProxy(true);
    setProxyStatus("正在测试...");
    try {
      await api.setProxyConfig({
        mode: proxyMode,
        url: proxyMode === "manual" ? proxyUrl : undefined,
      });
      resetGtxCache();
      const result = await api.testProxy();
      setProxyStatus(
        result.ok
          ? `连接成功 (${result.proxy})`
          : `连接失败: ${result.error || `HTTP ${result.status}`}`
      );
    } catch (err) {
      setProxyStatus("测试失败: " + (err as Error).message);
    } finally {
      setTestingProxy(false);
    }
  };

  const parsedJson = useMemo(() => {
    if (!input.trim()) return null;
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }, [input]);

  const extractedStrings = useMemo(() => {
    if (!parsedJson) return [];
    return extractStrings(parsedJson);
  }, [parsedJson]);

  const toggleTargetLang = (code: string) => {
    if (code === sourceLang) return;
    setTargetLangs((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const addKeyMapping = () => {
    if (newMappingOriginal && newMappingTranslated) {
      setKeyMappings([
        ...keyMappings,
        { original: newMappingOriginal, translated: newMappingTranslated },
      ]);
      setNewMappingOriginal("");
      setNewMappingTranslated("");
    }
  };

  const removeKeyMapping = (index: number) => {
    setKeyMappings(keyMappings.filter((_, i) => i !== index));
  };

  const collectStringsToTranslate = (parsed: unknown): ReturnType<typeof extractStrings> => {
    if (translationMode === "full") {
      return extractStrings(parsed).filter(
        (item) => typeof item.value === "string" && item.value.trim()
      );
    }
    if (translationMode === "path") {
      return extractStrings(parsed).filter(
        (item) =>
          item.path.includes(jsonPath) &&
          typeof item.value === "string" &&
          item.value.trim()
      );
    }
    return extractStrings(parsed).filter((item) => {
      const shouldTranslate = keyMappings.some(
        (m) => m.original === item.key
      );
      return shouldTranslate && typeof item.value === "string" && item.value.trim();
    });
  };

  const translateJson = async () => {
    if (!input.trim() || targetLangs.length === 0) return;

    // 自定义引擎没配好就别开跑：否则每条文本都白跑一次请求再报错
    if (isProvider(translationApi) && !isProviderConfigured(translateConfig)) {
      setError(
        `尚未配置「${providerLabel(translationApi)}」接口。\n\n` +
          "请点击上方「未配置，点此填写接口」按钮，或从顶栏进入「翻译接口」设置填写后重试。"
      );
      return;
    }

    stopRef.current = false;
    setStopping(false);
    setIsTranslating(true);
    setError("");
    setLangResults({});

    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (parseErr) {
      setError("JSON 格式错误: " + (parseErr as Error).message);
      setIsTranslating(false);
      return;
    }

    const stringsToTranslate = collectStringsToTranslate(parsed);
    if (stringsToTranslate.length === 0) {
      setError("未找到可翻译的字符串。请检查 JSON 内容或筛选条件。");
      setIsTranslating(false);
      return;
    }

    const totalWork = stringsToTranslate.length * targetLangs.length;
    setProgress({ current: 0, total: totalWork });

    // 初始化各语言状态
    const initial: Record<string, LangResultState> = {};
    targetLangs.forEach((lang) => {
      initial[lang] = {
        lang,
        data: null,
        apiUsed: "",
        translatedCount: 0,
        totalCount: stringsToTranslate.length,
        status: "done",
        translating: true,
        progress: { current: 0, total: stringsToTranslate.length },
      };
    });
    setLangResults(initial);

    try {
      const results = await translateMultiLang({
        parsed,
        stringsToTranslate,
        sourceLang,
        targetLangs,
        api: translationApi,
        providerConfig: translateConfig,
        textConcurrency,
        langConcurrency: Math.min(3, targetLangs.length),
        protectedTerms,
        shouldStop: () => stopRef.current,
        onLangStart: (lang) => {
          setLangResults((prev) => ({
            ...prev,
            [lang]: {
              ...prev[lang],
              translating: true,
              progress: { current: 0, total: stringsToTranslate.length },
            },
          }));
        },
        onLangProgress: (lang, done, total) => {
          setLangResults((prev) => ({
            ...prev,
            [lang]: {
              ...prev[lang],
              progress: { current: done, total },
            },
          }));
        },
        onLangComplete: (result) => {
          setLangResults((prev) => ({
            ...prev,
            [result.lang]: { ...result, translating: false },
          }));
        },
        onOverallProgress: (done, total) => {
          setProgress({ current: done, total });
        },
      });

      const successCount = results.filter((r) => r.translatedCount > 0).length;
      if (successCount === 0) {
        // 自定义接口的失败原因必须原样呈现：配置错误（401 / 模型名写错）不能被
        // 「换个 API 试试」这种通用文案盖过去，否则用户不知道该去改配置。
        const providerError = results.find((r) => r.error)?.error;
        setError(
          isProvider(translationApi) && providerError
            ? `「${providerLabel(translationApi)}」翻译失败。\n\n${providerError}`
            : "所有翻译 API 都未能返回有效结果。\n\n" +
              "建议：配置代理后点击「测试 Google」，或切换到 MyMemory API。"
        );
      } else {
        if (settings.autoSaveHistory) {
          saveHistory(input, `翻译: ${sourceLang} → ${targetLangs.join(",")}`);
        }
        if (settings.autoDownload) {
          results.forEach((r) => {
            if (r.data) downloadLangData(r.lang, r.data);
          });
        }
        if (settings.notifyOnComplete) {
          window.electronAPI?.showNotification?.(
            "翻译完成",
            `${successCount}/${targetLangs.length} 种语言，共 ${results.reduce((s, r) => s + r.translatedCount, 0)} 条`
          );
        }
        if (settings.scrollToResults) {
          setTimeout(() => {
            resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }, 100);
        }
        // 落定到结果页：稍作停留让用户看到进度走完，再切到结果列表
        setTimeout(() => setView("results"), 450);
      }
    } catch (err) {
      setError("翻译过程中出错: " + (err as Error).message);
    } finally {
      setIsTranslating(false);
      setStopping(false);
      stopRef.current = false;
    }
  };

  const copyLangResult = (lang: string) => {
    const result = langResults[lang];
    if (result?.data) {
      navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
    }
  };

  const downloadLangResult = (lang: string) => {
    const result = langResults[lang];
    if (!result?.data) return;
    downloadLangData(lang, result.data);
  };

  const downloadAll = () => {
    Object.keys(langResults).forEach((lang) => {
      if (langResults[lang]?.data) downloadLangResult(lang);
    });
  };

  const hasResults = Object.keys(langResults).length > 0;
  const doneLangs = Object.values(langResults).filter((r) => !r.translating);
  const totalTranslated = doneLangs.reduce(
    (sum, r) => sum + r.translatedCount,
    0
  );

  return (
    <ToolShell
      icon={Languages}
      title="JSON 多语言翻译"
      subtitle={`多语言并发 · ${textConcurrency} workers`}
      badge={
        hasResults ? (
          <ToolBadge tone="brand">
            {doneLangs.length} 种语言 · {totalTranslated} 条
          </ToolBadge>
        ) : undefined
      }
      actions={
        <>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`tool-button-secondary h-9 ${
              showHistory
                ? "ring-2 ring-brand-500/20 border-brand-200 text-brand-600 dark:border-brand-500/40 dark:text-brand-400"
                : ""
            }`}
          >
            <History size={15} />
            <span>历史</span>
          </button>
          <Tooltip content="清空工作区">
            <button
              onClick={() => {
                setInput("");
                setError("");
                setLangResults({});
                setView("edit");
                setDetailLang(null);
              }}
              className="tool-button-secondary h-9 w-9 p-0 text-rose-500 dark:text-rose-400"
            >
              <Trash2 size={15} />
            </button>
          </Tooltip>
        </>
      }
      scroll={false}
      overlay={
        <ToolHistoryOverlay
          open={showHistory}
          onClose={() => setShowHistory(false)}
          title="翻译历史"
          items={history}
          onClear={clearHistory}
          onPick={(item) => {
            setInput(item.data);
            setShowHistory(false);
            setView("edit");
            setDetailLang(null);
          }}
          onItemContextMenu={openHistoryMenu}
          renderItemTitle={(item) => item.title || "无标题"}
        />
      }
    >
      <div className="flex-1 flex flex-col min-h-0 relative">
        {/* Toolbar */}
        {/* 单行中控条：只留高频操作，其余全部收进设置弹窗 */}
        <div className="px-4 md:px-6 pt-3 shrink-0">
          <div className="bg-white dark:bg-dark-panel border border-slate-200/70 dark:border-dark-border rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.03),0_6px_16px_-4px_rgba(0,0,0,0.03)] px-3 h-12 flex items-center gap-2.5 flex-wrap overflow-hidden">
            <div className={UI.segment}>
              {(
                [
                  { id: "full", label: "全文" },
                  { id: "path", label: "JSONPath" },
                  { id: "key-mapping", label: "键名映射" },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setTranslationMode(mode.id)}
                  className={`${UI.segmentItem} ${
                    translationMode === mode.id
                      ? "bg-white dark:bg-dark-panel text-brand-600 dark:text-brand-400 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <ToolbarDivider />

            {translationMode === "path" && (
              <>
                <input
                  type="text"
                  value={jsonPath}
                  onChange={(e) => setJsonPath(e.target.value)}
                  placeholder="JSONPath"
                  className={`${UI.input} w-36 font-mono`}
                />
                <ToolbarDivider />
              </>
            )}

            <div className="relative">
              <button
                onClick={() => setShowSourceDropdown(!showSourceDropdown)}
                className={UI.btn}
              >
                <Globe size={14} className="text-slate-400" />
                {langName(sourceLang)}
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              {showSourceDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowSourceDropdown(false)} />
                  <div className="absolute top-full left-0 mt-1 bg-white dark:bg-dark-panel rounded-lg shadow-lg border border-slate-200 dark:border-dark-border py-1 z-20 w-36 max-h-60 overflow-y-auto">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setSourceLang(lang.code);
                          setTargetLangs((prev) => prev.filter((c) => c !== lang.code));
                          setShowSourceDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-dark-hover ${
                          sourceLang === lang.code
                            ? "bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 font-semibold"
                            : ""
                        }`}
                      >
                        {lang.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <span className="text-slate-300 text-xs shrink-0">→</span>

            <div className="relative">
              <button
                onClick={() => setShowTargetDropdown(!showTargetDropdown)}
                className={`${UI.btnActive} border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-500/20`}
              >
                <Languages size={14} />
                {targetLangs.length === 0 ? "选择语言" : `${targetLangs.length} 种`}
                <ChevronDown size={14} className="text-brand-400" />
              </button>
              {showTargetDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowTargetDropdown(false)} />
                  <div className="absolute top-full left-0 mt-1 bg-white dark:bg-dark-panel rounded-lg shadow-lg border border-slate-200 dark:border-dark-border py-2 z-20 w-48 max-h-72 overflow-y-auto">
                    <div className="px-3 pb-2 mb-1 border-b border-slate-100 dark:border-dark-border flex gap-2">
                      <button
                        onClick={() =>
                          setTargetLangs(LANGUAGES.map((l) => l.code).filter((c) => c !== sourceLang))
                        }
                        className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        全选
                      </button>
                      <button
                        onClick={() => setTargetLangs([])}
                        className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 hover:underline"
                      >
                        清空
                      </button>
                    </div>
                    {LANGUAGES.filter((l) => l.code !== sourceLang).map((lang) => {
                      const selected = targetLangs.includes(lang.code);
                      return (
                        <button
                          key={lang.code}
                          onClick={() => toggleTargetLang(lang.code)}
                          className={`w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-dark-hover flex items-center gap-2 ${
                            selected
                              ? "bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400"
                              : ""
                          }`}
                        >
                          <span
                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                              selected
                                ? "bg-brand-600 border-brand-600 text-white"
                                : "border-slate-300 dark:border-dark-border"
                            }`}
                          >
                            {selected && <Check size={9} />}
                          </span>
                          {lang.name}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
              {translationMode === "key-mapping" && keyMappings.length > 0 && (
                <ToolTag tone="brand">{keyMappings.length} 条映射</ToolTag>
              )}
              {isProvider(translationApi) && !isProviderConfigured(translateConfig) ? (
                <Tooltip content="打开设置填写接口">
                  <button
                    onClick={() => openAppSettings("translate-api")}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-xs font-semibold text-amber-700 dark:text-amber-300 transition hover:bg-amber-100 dark:hover:bg-amber-500/20 shrink-0"
                  >
                    <AlertTriangle size={14} />
                    未配置接口
                  </button>
                </Tooltip>
              ) : (
                <span className={UI.label}>
                  {API_LABELS[translationApi]} · {textConcurrency} workers
                </span>
              )}
              <Tooltip content="引擎、保护词、代理等设置">
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className={iconButtonClass("neutral")}
                >
                  <Settings2 size={15} />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* 视图机：编辑 / 结果列表 / 单语言详情 */}
        {view === "edit" ? (
          <div className="flex-1 min-h-0 overflow-hidden p-4 md:p-6 flex flex-col gap-3">
            {error && (
              <ToolNotice tone="warn" icon={AlertTriangle} className="shrink-0">
                <p className="whitespace-pre-line">{error}</p>
              </ToolNotice>
            )}

            {/* 第一页只有一块输入板 */}
            <ToolCard className="flex-1 min-h-0">
              <ToolCardHeader
                title="源 JSON"
                meta={
                  extractedStrings.length > 0
                    ? `${extractedStrings.length} 项 · ${targetLangs.length} 语言`
                    : undefined
                }
                actions={
                  input ? (
                    <Tooltip content="清空输入">
                      <button
                        onClick={() => {
                          setInput("")
                          setError("")
                          setLangResults({})
                        }}
                        className={iconButtonClass("danger")}
                      >
                        <Trash2 size={15} />
                      </button>
                    </Tooltip>
                  ) : undefined
                }
              />

              <CodeEditor
                value={input}
                onChange={(next) => {
                  setInput(next)
                  if (error) setError("")
                }}
                placeholder='粘贴 JSON，例如 {"name": "张三", "description": "示例"}'
              />

              <ToolCardFooter>
                <span>{input.length} 字符</span>
                <span>
                  {extractedStrings.length > 0
                    ? `可翻译 ${extractedStrings.length} 条`
                    : "等待有效 JSON"}
                </span>
              </ToolCardFooter>
            </ToolCard>
          </div>
        ) : view === "results" ? (
        <div className="flex-1 min-h-0 overflow-hidden p-4 md:p-6">
          <ToolCard className="h-full">
            <ToolCardHeader
              title="翻译结果"
              meta={`${targetLangs.length} 种语言 · 共 ${totalTranslated} 条`}
              actions={
                <>
                  <Tooltip content="回到编辑区">
                    <button
                      onClick={() => {
                        setView("edit")
                        setDetailLang(null)
                      }}
                      className={iconButtonClass("neutral")}
                    >
                      <Pencil size={15} />
                    </button>
                  </Tooltip>
                  <Tooltip content="全部下载">
                    <button onClick={downloadAll} className={iconButtonClass("brand")}>
                      <Download size={15} />
                    </button>
                  </Tooltip>
                </>
              }
            />

            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5 tool-cascade">
              {targetLangs.map((lang) => {
                const result = langResults[lang];
                if (!result) return null;
                const pct = result.progress
                  ? Math.round((result.progress.current / result.progress.total) * 100)
                  : 100;
                const done = !result.translating;

                return (
                  <button
                    key={lang}
                    onClick={() => {
                      if (!done || result.data == null) return;
                      setDetailLang(lang);
                      setView("detail");
                    }}
                    className={`w-full flex items-center gap-3 rounded-xl px-3.5 h-12 text-left transition-colors ${
                      done && result.data != null
                        ? "hover:bg-slate-50 dark:hover:bg-dark-hover cursor-pointer"
                        : "cursor-default"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        result.translating
                          ? "bg-brand-500 animate-pulse"
                          : result.translatedCount > 0
                            ? "bg-emerald-500"
                            : "bg-amber-500"
                      }`}
                    />
                    <span className="text-[13px] font-semibold text-slate-900 dark:text-white w-20 shrink-0 truncate">
                      {langName(lang)}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 shrink-0">{lang}</span>
                    <div className="flex-1 min-w-0">
                      {result.translating && result.progress ? (
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-24 h-1 bg-slate-100 dark:bg-dark-hover rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-500 transition-all duration-200"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 shrink-0">
                            {pct}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate block text-right">
                          {result.translatedCount}/{result.totalCount} 条
                          {result.apiUsed ? ` · ${result.apiUsed}` : ""}
                        </span>
                      )}
                    </div>
                    {done && result.data != null && (
                      <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </ToolCard>
        </div>
        ) : (
        <div className="flex-1 min-h-0 overflow-hidden p-4 md:p-6">
          <ToolCard className="h-full">
            <ToolCardHeader
              title={detailLang ? langName(detailLang) : ""}
              sublabel={detailLang}
              meta={
                detailLang && langResults[detailLang]
                  ? `${langResults[detailLang].translatedCount}/${langResults[detailLang].totalCount} 条`
                  : undefined
              }
              actions={
                <>
                  <Tooltip content="返回结果列表">
                    <button
                      onClick={() => setView("results")}
                      className={iconButtonClass("neutral")}
                    >
                      <ArrowLeft size={15} />
                    </button>
                  </Tooltip>
                  {detailLang && langResults[detailLang]?.data != null && (
                    <>
                      <Tooltip content="复制该语言结果">
                        <button
                          onClick={() => copyLangResult(detailLang)}
                          className={iconButtonClass("brand")}
                        >
                          <Copy size={15} />
                        </button>
                      </Tooltip>
                      <Tooltip content="下载该语言结果">
                        <button
                          onClick={() => downloadLangResult(detailLang)}
                          className={iconButtonClass("brand")}
                        >
                          <Download size={15} />
                        </button>
                      </Tooltip>
                    </>
                  )}
                </>
              }
            />

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {detailLang && langResults[detailLang]?.data != null ? (
                <JsonTreeView data={langResults[detailLang].data} />
              ) : (
                <ToolEmpty icon={Languages} title="该语言暂无结果" />
              )}
            </div>
          </ToolCard>
        </div>
        )}
        <div className="px-4 md:px-6 h-12 border-t border-slate-100 dark:border-dark-border bg-white dark:bg-dark-panel shrink-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <span className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <Zap size={12} className="text-amber-500" />
              {textConcurrency} workers · 3 语言并行
            </span>
            {hasResults && !isTranslating && (
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                共 {totalTranslated} 条
              </span>
            )}
            {isTranslating && progress.total > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-28 h-1 bg-slate-100 dark:bg-dark-hover rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-600 transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                  {progress.current}/{progress.total}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={translateJson}
            disabled={!input.trim() || isTranslating || targetLangs.length === 0}
            className="tool-button-primary h-9 px-5"
          >
            {isTranslating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                翻译中 {progress.current}/{progress.total}
              </>
            ) : view === "edit" ? (
              <>
                <Languages size={14} />
                开始翻译{targetLangs.length > 0 && ` · ${targetLangs.length} 语言`}
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                重新翻译{targetLangs.length > 0 && ` · ${targetLangs.length} 语言`}
              </>
            )}
          </button>
        </div>

        {/* 翻译中：覆盖层展示实时进度，可随时暂停 */}
        {isTranslating && (
          <div
            className="absolute inset-0 z-40 bg-white/92 dark:bg-dark-bg/95 backdrop-blur-sm flex items-center justify-center p-6"
            style={{ animation: "overlay-fade-in 200ms ease-out both" }}
          >
            <div className="w-full max-w-[440px] rounded-2xl border border-slate-200/70 dark:border-dark-border bg-white dark:bg-dark-panel shadow-[0_24px_80px_-24px_rgba(15,23,42,0.35)] p-5">
              {/* 头部：状态 + 暂停 */}
              <div className="flex items-center justify-between gap-3 mb-5">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-white">
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-1 h-3 rounded-full bg-brand-500 animate-pulse"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </span>
                  正在并发翻译
                </span>
                <button
                  onClick={() => {
                    stopRef.current = true;
                    setStopping(true);
                  }}
                  disabled={stopping}
                  className={`${UI.btn} ${stopping ? "!text-slate-400" : ""}`}
                >
                  {stopping ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      正在暂停
                    </>
                  ) : (
                    <>
                      <Pause size={13} />
                      暂停
                    </>
                  )}
                </button>
              </div>

              {/* 总进度 */}
              <div className="flex items-end justify-between gap-3 mb-2">
                <span className="text-[26px] font-bold leading-none text-slate-900 dark:text-white tabular-nums">
                  {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}
                  <span className="text-[13px] font-semibold text-slate-400 ml-0.5">%</span>
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {progress.current}/{progress.total} 条 · {textConcurrency} workers
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-dark-hover overflow-hidden mb-5">
                <div
                  className="h-full bg-brand-600 rounded-full transition-[width] duration-300 ease-out"
                  style={{
                    width: `${progress.total > 0 ? Math.max(2, (progress.current / progress.total) * 100) : 2}%`,
                  }}
                />
              </div>

              {/* 各语言进度 */}
              <div className="flex flex-col gap-2">
                {targetLangs.map((lang) => {
                  const r = langResults[lang];
                  const pct =
                    r?.progress && r.progress.total > 0
                      ? Math.round((r.progress.current / r.progress.total) * 100)
                      : 0;
                  const done = !!r && !r.translating;
                  return (
                    <div key={lang} className="flex items-center gap-2.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          done ? "bg-emerald-500" : "bg-brand-500 animate-pulse"
                        }`}
                      />
                      <span className="text-[12px] font-medium text-slate-700 dark:text-slate-200 w-16 shrink-0 truncate">
                        {langName(lang)}
                      </span>
                      <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-dark-hover overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                            done ? "bg-emerald-500" : "bg-brand-500"
                          }`}
                          style={{ width: `${done ? 100 : Math.max(2, pct)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 tabular-nums w-8 text-right shrink-0">
                        {done ? "100" : pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 专用设置弹窗：引擎与并发 / 翻译行为 / 键名映射 / 保护词 / 代理 */}
        {showSettingsModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-slate-900/30 dark:bg-black/50 backdrop-blur-[2px]"
              onClick={() => setShowSettingsModal(false)}
            />
            <div className="relative w-full max-w-[560px] max-h-[82vh] bg-white dark:bg-dark-panel rounded-2xl border border-slate-200/70 dark:border-dark-border shadow-[0_24px_80px_-24px_rgba(15,23,42,0.45)] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 h-14 border-b border-slate-100 dark:border-dark-border shrink-0">
                <span className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
                  <Settings2 size={16} className="text-brand-600 dark:text-brand-400" />
                  翻译设置
                </span>
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className={iconButtonClass("neutral")}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* 引擎与并发 */}
                <section className="space-y-2.5">
                  <p className={UI.label}>引擎与并发</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select<TranslationAPI>
                      value={translationApi}
                      onChange={setTranslationApi}
                      options={[
                        { value: "gtx", label: "GTX（免费）" },
                        { value: "mymemory", label: "MyMemory（免费）" },
                        { value: "openai", label: "OpenAI 兼容" },
                        { value: "libretranslate", label: "LibreTranslate" },
                      ]}
                    />
                    <Select
                      value={textConcurrency}
                      onChange={setTextConcurrency}
                      title="并发 Worker 数"
                      options={[6, 12, 20, 30].map((n) => ({ value: n, label: `${n} workers` }))}
                    />
                    <button onClick={() => openAppSettings("translate-api")} className={UI.btn}>
                      接口配置…
                    </button>
                  </div>
                  {isProvider(translationApi) && !isProviderConfigured(translateConfig) && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      当前引擎需要先在「接口配置」里填写密钥 / 地址，否则翻译会失败。
                    </p>
                  )}
                </section>

                {/* 翻译行为 */}
                <section className="space-y-2.5">
                  <p className={UI.label}>翻译行为</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                    <SettingToggle
                      label="自动下载"
                      desc="全部完成后自动下载所有语言 JSON"
                      checked={settings.autoDownload}
                      onChange={(v) => updateSettings({ autoDownload: v })}
                    />
                    <SettingToggle
                      label="桌面通知"
                      desc="翻译完成后弹出系统通知"
                      checked={settings.notifyOnComplete}
                      onChange={(v) => updateSettings({ notifyOnComplete: v })}
                    />
                    <SettingToggle
                      label="保存历史"
                      desc="成功后自动保存到翻译历史"
                      checked={settings.autoSaveHistory}
                      onChange={(v) => updateSettings({ autoSaveHistory: v })}
                    />
                    <SettingToggle
                      label="滚动到结果"
                      desc="完成后自动滚动到翻译结果区域"
                      checked={settings.scrollToResults}
                      onChange={(v) => updateSettings({ scrollToResults: v })}
                    />
                  </div>
                </section>

                {/* 键名映射 */}
                <section className="space-y-2.5">
                  <p className={UI.label}>键名映射（键名映射模式下生效）</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={newMappingOriginal}
                      onChange={(e) => setNewMappingOriginal(e.target.value)}
                      placeholder="原键名"
                      className={`${UI.input} w-28`}
                    />
                    <span className="text-slate-300 dark:text-slate-600 text-xs shrink-0">→</span>
                    <input
                      type="text"
                      value={newMappingTranslated}
                      onChange={(e) => setNewMappingTranslated(e.target.value)}
                      placeholder="目标键名"
                      className={`${UI.input} w-28`}
                    />
                    <button onClick={addKeyMapping} className={`${UI.btn} !bg-brand-600 !border-brand-600 !text-white hover:!bg-brand-700`}>
                      添加
                    </button>
                  </div>
                  {keyMappings.length > 0 ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {keyMappings.map((m, i) => (
                        <span
                          key={i}
                          className="h-7 inline-flex items-center gap-1 px-2 bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-300 rounded-lg text-xs font-medium"
                        >
                          {m.original} → {m.translated}
                          <Tooltip content="删除键名映射">
                            <button onClick={() => removeKeyMapping(i)} className="hover:text-rose-500">
                              <X size={12} />
                            </button>
                          </Tooltip>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      仅翻译与映射键名匹配的字段，例如 original → translated。
                    </p>
                  )}
                </section>

                {/* 保护词 */}
                <section className="space-y-2.5">
                  <p className={UI.label}>保护词（不参与翻译的原文）</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {protectedTerms.map((term) => (
                      <span
                        key={term}
                        className="h-7 inline-flex items-center gap-1 px-2 bg-white dark:bg-dark-panel border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 rounded-lg text-xs font-mono"
                      >
                        {term}
                        <Tooltip content="删除保护词">
                          <button
                            onClick={() => removeProtectedTerm(term)}
                            className="text-amber-400 hover:text-rose-500"
                          >
                            <X size={12} />
                          </button>
                        </Tooltip>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={newProtectedTerm}
                      onChange={(e) => setNewProtectedTerm(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addProtectedTerm()}
                      placeholder="品牌名"
                      className={`${UI.input} w-32 font-mono`}
                    />
                    <button
                      onClick={addProtectedTerm}
                      className={`${UI.btn} !bg-amber-600 !border-amber-600 !text-white hover:!bg-amber-700`}
                    >
                      添加
                    </button>
                  </div>
                  {protectedTerms.length === 0 && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      暂无保护词；默认留有 {DEFAULT_PROTECTED_TERMS.join("、")}。
                    </p>
                  )}
                </section>

                {/* 代理 */}
                <section className="space-y-2.5">
                  <p className={UI.label}>代理（仅 Electron 环境生效）</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(["system", "manual", "direct"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setProxyMode(mode)}
                        className={`${UI.btn} ${
                          proxyMode === mode ? "!border-brand-600 !bg-brand-600 !text-white" : ""
                        }`}
                      >
                        {mode === "system" ? "系统" : mode === "manual" ? "手动" : "直连"}
                      </button>
                    ))}
                    {proxyMode === "manual" && (
                      <input
                        type="text"
                        value={proxyUrl}
                        onChange={(e) => setProxyUrl(e.target.value)}
                        placeholder="127.0.0.1:7890"
                        className={`${UI.input} w-40 font-mono`}
                      />
                    )}
                    <button onClick={saveProxyConfig} className={`${UI.btn} !border-slate-800 dark:!border-slate-600 !bg-slate-800 dark:!bg-slate-700 !text-white`}>
                      保存
                    </button>
                    <button
                      onClick={testProxyConnection}
                      disabled={testingProxy}
                      className={`${UI.btn} !bg-brand-600 !border-brand-600 !text-white hover:!bg-brand-700 disabled:opacity-50`}
                    >
                      {testingProxy && <Loader2 size={12} className="animate-spin" />}
                      测试
                    </button>
                    {proxyStatus && (
                      <span
                        className={`text-[11px] font-medium ${
                          proxyStatus.includes("成功")
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-slate-400 dark:text-slate-500"
                        }`}
                      >
                        {proxyStatus}
                      </span>
                    )}
                  </div>
                </section>
              </div>

              <div className="px-5 py-3 border-t border-slate-100 dark:border-dark-border flex justify-end shrink-0">
                <button onClick={() => setShowSettingsModal(false)} className={BTN.primary}>
                  完成
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ToolShell>
  );
}
