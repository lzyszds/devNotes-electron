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
  CheckCircle2,
  History,
  X,
  Settings2,
  Globe,
  Zap,
  Check,
  Shield,
  SlidersHorizontal,
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
  AUTO_EXPAND_OPTIONS,
  mergeSettings,
  type JsonI18nSettings,
  type AutoExpandMode,
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
import { Select } from "../ui";
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

/** 统一控件尺寸：高度 36px、圆角、字号 */
const UI = {
  row: "flex items-center gap-2 min-h-9",
  divider: "w-px h-5 bg-slate-200 shrink-0 mx-0.5",
  btn: "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:border-slate-300 shrink-0",
  btnActive: "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-semibold shrink-0",
  btnIcon: "inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:border-slate-300 shrink-0",
  select: "shrink-0",
  input: "h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10",
  segment: "flex h-9 p-0.5 bg-slate-100 rounded-lg shrink-0",
  segmentItem: "h-full px-3 rounded-md text-xs font-semibold transition-all",
  panel: "px-6 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap min-h-[52px]",
  label: "text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0",
} as const;

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
        checked ? "bg-indigo-600" : "bg-slate-200"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
    <span>
      <span className="block text-xs font-semibold text-slate-700">{label}</span>
      <span className="block text-[10px] text-slate-400 leading-snug mt-0.5">{desc}</span>
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
      return <span className="text-rose-500 font-bold italic">null</span>;
    if (typeof val === "string")
      return <span className="text-emerald-600">"{val}"</span>;
    if (typeof val === "number")
      return <span className="text-sky-600 font-bold">{val}</span>;
    if (typeof val === "boolean")
      return (
        <span className="text-amber-600 font-bold">{val.toString()}</span>
      );
    return null;
  };

  if (!isObject) {
    return (
      <div className="flex items-start py-0.5">
        {label && (
          <span className="text-slate-900 font-bold mr-2">"{label}":</span>
        )}
        {renderValue(value)}
        {!isLast && <span className="text-slate-400">,</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center py-0.5 cursor-pointer hover:bg-slate-50 rounded px-1 -ml-1"
        onClick={() => !isEmpty && setIsExpanded(!isExpanded)}
      >
        <div className="w-4 h-4 flex items-center justify-center mr-1 text-slate-300">
          {!isEmpty &&
            (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </div>
        {label && (
          <span className="text-slate-900 font-bold mr-2">"{label}":</span>
        )}
        <span className="text-slate-400 font-bold">
          {isArray ? "[" : "{"}
          {!isExpanded && !isEmpty && (
            <span className="mx-1 text-slate-300 text-[10px]">...</span>
          )}
          {!isExpanded && (isArray ? "]" : "}")}
        </span>
      </div>
      {isExpanded && !isEmpty && (
        <div className="ml-4 border-l border-slate-100 pl-4">
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
          <span className="text-slate-400 font-bold ml-5">
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
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showTargetDropdown, setShowTargetDropdown] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [textConcurrency, setTextConcurrency] = useState(
    DEFAULT_TEXT_CONCURRENCY
  );
  const [langResults, setLangResults] = useState<Record<string, LangResultState>>({});
  const [expandedLangs, setExpandedLangs] = useState<Set<string>>(new Set());
  const [showProxyPanel, setShowProxyPanel] = useState(false);
  const [proxyMode, setProxyMode] = useState<ProxyMode>("system");
  const [proxyUrl, setProxyUrl] = useState("127.0.0.1:7890");
  const [proxyStatus, setProxyStatus] = useState("");
  const [testingProxy, setTestingProxy] = useState(false);
  const [showProtectedPanel, setShowProtectedPanel] = useState(false);
  const [protectedTerms, setProtectedTerms] = useState<string[]>(DEFAULT_PROTECTED_TERMS);
  const [newProtectedTerm, setNewProtectedTerm] = useState("");
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settings, setSettings] = useState<JsonI18nSettings>(DEFAULT_SETTINGS);
  const resultsRef = useRef<HTMLDivElement>(null);

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

  const toggleExpanded = (lang: string) => {
    setExpandedLangs((prev) => {
      if (settings.exclusiveExpand) {
        return prev.has(lang) ? new Set<string>() : new Set([lang]);
      }
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang);
      else next.add(lang);
      return next;
    });
  };

  const applyAutoExpandOnComplete = (
    mode: AutoExpandMode,
    langs: string[],
    completedLang?: string
  ) => {
    if (mode === "none") return;
    if (mode === "each" && completedLang) {
      setExpandedLangs((prev) =>
        settings.exclusiveExpand
          ? new Set([completedLang])
          : new Set([...prev, completedLang])
      );
      return;
    }
    if (mode === "first" && langs.length > 0) {
      setExpandedLangs(new Set([langs[0]]));
      return;
    }
    if (mode === "allWhenDone") {
      setExpandedLangs(new Set(langs));
    }
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

    setIsTranslating(true);
    setError("");
    setLangResults({});
    setExpandedLangs(new Set());

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
          if (settings.autoExpand === "each") {
            applyAutoExpandOnComplete("each", targetLangs, result.lang);
          }
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
        if (settings.autoExpand === "first" || settings.autoExpand === "allWhenDone") {
          applyAutoExpandOnComplete(settings.autoExpand, targetLangs);
        }
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
      }
    } catch (err) {
      setError("翻译过程中出错: " + (err as Error).message);
    } finally {
      setIsTranslating(false);
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
    <div className="relative flex h-full bg-white overflow-hidden text-slate-900">
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Header */}
        <div className="px-6 h-16 flex items-center justify-between border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-100">
              <Languages size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 leading-tight">
                JSON 多语言翻译
              </h2>
              <p className="text-[10px] font-medium text-slate-400">
                多语言并发 · {textConcurrency} workers
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`${UI.btn} ${showHistory ? "!border-indigo-200 !bg-indigo-50 !text-indigo-600" : ""}`}
            >
              <History size={14} />
              历史
            </button>
            <Tooltip content="清空工作区">
              <button
                onClick={() => {
                  setInput("");
                  setError("");
                  setLangResults({});
                  setExpandedLangs(new Set());
                }}
                className={`${UI.btnIcon} !text-rose-500 hover:!bg-rose-50 hover:!border-rose-200`}
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-6 border-b border-slate-100 bg-slate-50/40 shrink-0">
          {/* 第一行：模式 + 语言 */}
          <div className={`${UI.panel} !border-b-0 !py-3`}>
            <div className={UI.segment}>
              {(
                [
                  { id: "full", label: "全文翻译" },
                  { id: "path", label: "JSONPath" },
                  { id: "key-mapping", label: "键名映射" },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setTranslationMode(mode.id)}
                  className={`${UI.segmentItem} ${
                    translationMode === mode.id
                      ? "bg-white text-indigo-600 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <ToolbarDivider />

            <span className={UI.label}>源语言</span>
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
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20 w-36 max-h-60 overflow-y-auto">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setSourceLang(lang.code);
                          setTargetLangs((prev) => prev.filter((c) => c !== lang.code));
                          setShowSourceDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${
                          sourceLang === lang.code ? "bg-indigo-50 text-indigo-600 font-semibold" : ""
                        }`}
                      >
                        {lang.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <span className="text-slate-300 text-sm">→</span>

            <span className={UI.label}>目标</span>
            <div className="relative">
              <button
                onClick={() => setShowTargetDropdown(!showTargetDropdown)}
                className={`${UI.btnActive} border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
              >
                <Languages size={14} />
                {targetLangs.length === 0 ? "选择语言" : `${targetLangs.length} 种`}
                <ChevronDown size={14} className="text-indigo-400" />
              </button>
              {showTargetDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowTargetDropdown(false)} />
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-2 z-20 w-48 max-h-72 overflow-y-auto">
                    <div className="px-3 pb-2 mb-1 border-b border-slate-100 flex gap-2">
                      <button
                        onClick={() =>
                          setTargetLangs(LANGUAGES.map((l) => l.code).filter((c) => c !== sourceLang))
                        }
                        className="text-[10px] font-bold text-indigo-600 hover:underline"
                      >
                        全选
                      </button>
                      <button
                        onClick={() => setTargetLangs([])}
                        className="text-[10px] font-bold text-slate-400 hover:underline"
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
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2 ${
                            selected ? "bg-indigo-50 text-indigo-600" : ""
                          }`}
                        >
                          <span
                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                              selected ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300"
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

            {translationMode === "path" && (
              <>
                <ToolbarDivider />
                <input
                  type="text"
                  value={jsonPath}
                  onChange={(e) => setJsonPath(e.target.value)}
                  placeholder="JSONPath"
                  className={`${UI.input} w-40 font-mono`}
                />
              </>
            )}
          </div>

          {/* 第二行：API / 并发 / 设置 */}
          <div className={`${UI.panel} !pt-0`}>
            <span className={UI.label}>API</span>
            <Select<TranslationAPI>
              value={translationApi}
              onChange={setTranslationApi}
              className={UI.select}
              options={[
                { value: "gtx", label: "GTX" },
                { value: "mymemory", label: "MyMemory" },
                { value: "openai", label: "OpenAI 兼容" },
                { value: "libretranslate", label: "LibreTranslate" },
              ]}
            />

            {/* 选中自定义引擎但没填配置时给出明确出口，而不是等翻译时才失败 */}
            {isProvider(translationApi) &&
              !isProviderConfigured(translateConfig) && (
                <Tooltip content="打开顶栏的翻译接口设置">
                  <button
                    onClick={() => openAppSettings("translate-api")}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-amber-300 bg-amber-50 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 shrink-0"
                  >
                    <AlertTriangle size={14} />
                    未配置，点此填写接口
                  </button>
                </Tooltip>
              )}

            <Select
              value={textConcurrency}
              onChange={setTextConcurrency}
              className={UI.select}
              title="并发 Worker 数"
              options={[6, 12, 20, 30].map((n) => ({
                value: n,
                label: `${n} workers`,
              }))}
            />

            <ToolbarDivider />

            <button
              onClick={() => setShowSettingsPanel(!showSettingsPanel)}
              className={`${UI.btn} ${
                showSettingsPanel ? "!border-violet-300 !bg-violet-50 !text-violet-700" : ""
              }`}
            >
              <SlidersHorizontal size={14} />
              设置
            </button>

            <button
              onClick={() => setShowProtectedPanel(!showProtectedPanel)}
              className={`${UI.btn} ${
                showProtectedPanel ? "!border-amber-300 !bg-amber-50 !text-amber-700" : ""
              }`}
            >
              <Shield size={14} />
              保护词
              {protectedTerms.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-[10px] font-bold">
                  {protectedTerms.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setShowProxyPanel(!showProxyPanel)}
              className={`${UI.btn} ${
                showProxyPanel ? "!border-indigo-300 !bg-indigo-50 !text-indigo-600" : ""
              }`}
            >
              <Settings2 size={14} />
              代理
            </button>

            {targetLangs.length > 0 && (
              <div className="ml-auto flex items-center gap-1 flex-wrap justify-end">
                {targetLangs.slice(0, 8).map((code) => (
                  <span
                    key={code}
                    className="h-6 px-2 inline-flex items-center bg-white border border-slate-200 text-slate-500 rounded text-[10px] font-semibold"
                  >
                    {langName(code)}
                  </span>
                ))}
                {targetLangs.length > 8 && (
                  <span className="text-[10px] text-slate-400 font-medium">
                    +{targetLangs.length - 8}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Settings panel */}
        {showSettingsPanel && (
          <div className={`${UI.panel} bg-violet-50/40 flex-col !items-start gap-4`}>
            <div className="flex items-center gap-4 flex-wrap w-full">
              <SlidersHorizontal size={14} className="text-violet-600 shrink-0" />
              <span className={`${UI.label} !text-violet-600`}>翻译设置</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">完成后展开</span>
                <Select
                  value={settings.autoExpand}
                  onChange={(v) => updateSettings({ autoExpand: v })}
                  className={UI.select}
                  menuMinWidth={140}
                  options={AUTO_EXPAND_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                  }))}
                />
                <span className="text-[10px] text-slate-400">
                  {AUTO_EXPAND_OPTIONS.find((o) => o.value === settings.autoExpand)?.desc}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-6 flex-wrap w-full pl-6">
              <SettingToggle
                label="手风琴互斥"
                desc="同时只展开一种语言的 JSON"
                checked={settings.exclusiveExpand}
                onChange={(v) => updateSettings({ exclusiveExpand: v })}
              />
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
          </div>
        )}

        {/* Protected terms */}
        {showProtectedPanel && (
          <div className={`${UI.panel} bg-amber-50/50`}>
            <Shield size={14} className="text-amber-600 shrink-0" />
            <span className={`${UI.label} !text-amber-600`}>保护词</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {protectedTerms.map((term) => (
                <span
                  key={term}
                  className="h-7 inline-flex items-center gap-1 px-2 bg-white border border-amber-200 text-amber-800 rounded-lg text-xs font-mono"
                >
                  {term}
                  <Tooltip content="删除保护词">
                    <button onClick={() => removeProtectedTerm(term)} className="text-amber-400 hover:text-rose-500">
                      <X size={12} />
                    </button>
                  </Tooltip>
                </span>
              ))}
            </div>
            <input
              type="text"
              value={newProtectedTerm}
              onChange={(e) => setNewProtectedTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addProtectedTerm()}
              placeholder="品牌名"
              className={`${UI.input} w-32 font-mono !border-amber-200`}
            />
            <button
              onClick={addProtectedTerm}
              className="h-9 px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700"
            >
              添加
            </button>
          </div>
        )}

        {/* Proxy panel */}
        {showProxyPanel && (
          <div className={`${UI.panel} bg-slate-50`}>
            <Globe size={14} className="text-slate-400 shrink-0" />
            <span className={UI.label}>代理</span>
            {(["system", "manual", "direct"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setProxyMode(mode)}
                className={`${UI.btn} ${
                  proxyMode === mode ? "!border-indigo-600 !bg-indigo-600 !text-white" : ""
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
            <button
              onClick={saveProxyConfig}
              className="h-9 px-3 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900"
            >
              保存
            </button>
            <button
              onClick={testProxyConnection}
              disabled={testingProxy}
              className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {testingProxy && <Loader2 size={12} className="animate-spin" />}
              测试
            </button>
            {proxyStatus && (
              <span className={`text-xs font-medium ${proxyStatus.includes("成功") ? "text-emerald-600" : "text-slate-400"}`}>
                {proxyStatus}
              </span>
            )}
          </div>
        )}

        {/* Key mapping */}
        {translationMode === "key-mapping" && (
          <div className={UI.panel}>
            <Settings2 size={14} className="text-slate-400 shrink-0" />
            <span className={UI.label}>映射</span>
            <input
              type="text"
              value={newMappingOriginal}
              onChange={(e) => setNewMappingOriginal(e.target.value)}
              placeholder="原键名"
              className={`${UI.input} w-28`}
            />
            <span className="text-slate-300 text-xs">→</span>
            <input
              type="text"
              value={newMappingTranslated}
              onChange={(e) => setNewMappingTranslated(e.target.value)}
              placeholder="目标键名"
              className={`${UI.input} w-28`}
            />
            <button
              onClick={addKeyMapping}
              className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
            >
              添加
            </button>
            {keyMappings.map((m, i) => (
              <span key={i} className="h-7 inline-flex items-center gap-1 px-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-medium">
                {m.original} → {m.translated}
                <Tooltip content="删除键名映射">
                  <button onClick={() => removeKeyMapping(i)} className="hover:text-rose-500">
                    <X size={12} />
                  </button>
                </Tooltip>
              </span>
            ))}
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 overflow-hidden p-6 bg-slate-50/30">
          <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
            <div className="flex flex-col gap-2 min-w-0 h-full overflow-hidden">
              <div className="flex items-center justify-between h-6 shrink-0">
                <label className="tool-label mb-0">JSON 输入</label>
                <span className="text-[10px] font-medium text-slate-400">
                  {extractedStrings.length} 项
                  {targetLangs.length > 0 && ` × ${targetLangs.length} 语言`}
                </span>
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder='{"name": "张三", "description": "这是一个示例"}'
                className="tool-textarea flex-1 border-slate-200 shadow-sm"
              />
            </div>

            <div ref={resultsRef} className="flex flex-col gap-2 min-w-0 h-full overflow-hidden">
              <div className="flex items-center justify-between h-6 shrink-0">
                <label className="tool-label mb-0">翻译结果</label>
                {hasResults && (
                  <button onClick={downloadAll} className={`${UI.btn} !h-7 !px-2`}>
                    <Download size={12} />
                    全部下载
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5">
                {error ? (
                  <div className="status-note border-amber-100 bg-amber-50/30 text-amber-700 p-6 rounded-xl">
                    <div className="flex items-center gap-2 mb-3 text-amber-600">
                      <AlertTriangle size={18} />
                      <span className="text-xs font-black uppercase">翻译遇到问题</span>
                    </div>
                    <p className="text-sm whitespace-pre-line">{error}</p>
                  </div>
                ) : hasResults ? (
                  targetLangs.map((lang) => {
                    const result = langResults[lang];
                    if (!result) return null;
                    const expanded = expandedLangs.has(lang);
                    const pct = result.progress
                      ? Math.round((result.progress.current / result.progress.total) * 100)
                      : 100;

                    return (
                      <div
                        key={lang}
                        className="rounded-lg border border-slate-200 bg-white overflow-hidden"
                      >
                        <button
                          onClick={() => toggleExpanded(lang)}
                          className="w-full flex items-center gap-2.5 h-11 px-3 hover:bg-slate-50 transition text-left"
                        >
                          {expanded ? (
                            <ChevronDown size={14} className="text-slate-400 shrink-0" />
                          ) : (
                            <ChevronRight size={14} className="text-slate-400 shrink-0" />
                          )}
                          <span className="text-xs font-semibold text-slate-800 w-14 shrink-0">
                            {langName(lang)}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            {lang}
                          </span>
                          {result.translating ? (
                            <Loader2 size={12} className="animate-spin text-indigo-500 shrink-0" />
                          ) : result.translatedCount > 0 ? (
                            <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                          ) : (
                            <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            {result.translating && result.progress ? (
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden max-w-[120px]">
                                  <div
                                    className="h-full bg-indigo-500 transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {result.progress.current}/{result.progress.total}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400 truncate block">
                                {result.translatedCount}/{result.totalCount}
                                {result.apiUsed && ` · ${result.apiUsed}`}
                              </span>
                            )}
                          </div>
                          {!result.translating && result.data != null ? (
                            <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <Tooltip content="复制该语言的翻译结果">
                                <button onClick={() => copyLangResult(lang)} className={UI.btnIcon}>
                                  <Copy size={12} />
                                </button>
                              </Tooltip>
                              <Tooltip content="下载该语言的翻译结果">
                                <button onClick={() => downloadLangResult(lang)} className={UI.btnIcon}>
                                  <Download size={12} />
                                </button>
                              </Tooltip>
                            </div>
                          ) : null}
                        </button>
                        {expanded && result.data != null ? (
                          <div className="border-t border-slate-100 p-3 max-h-56 overflow-y-auto bg-slate-50/50">
                            <JsonTreeView data={result.data} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="h-full rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 gap-3">
                    <Languages size={24} className="opacity-20" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">
                      选择目标语言后开始翻译
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="px-6 h-14 border-t border-slate-100 bg-white shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1.5">
              <Zap size={12} className="text-amber-500" />
              {textConcurrency} workers · 3 语言并行
            </span>
            {hasResults && !isTranslating && (
              <span className="text-[10px] font-semibold text-emerald-600">
                共 {totalTranslated} 条
              </span>
            )}
            {isTranslating && progress.total > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-28 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {progress.current}/{progress.total}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={translateJson}
            disabled={!input.trim() || isTranslating || targetLangs.length === 0}
            className="tool-button-primary h-9 px-5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {isTranslating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                翻译中 {progress.current}/{progress.total}
              </>
            ) : (
              <>
                <Languages size={14} />
                开始翻译{targetLangs.length > 0 && ` · ${targetLangs.length} 语言`}
              </>
            )}
          </button>
        </div>
      </div>

      {/* History */}
      {showHistory && (
        <div className="history-overlay">
          <button
            type="button"
            aria-label="关闭历史记录"
            className="history-overlay-backdrop"
            onClick={() => setShowHistory(false)}
          />
          <div className="history-overlay-panel" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200/70 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <History size={18} className="text-indigo-600" />
                <p className="text-[11px] font-black uppercase">翻译历史</p>
              </div>
              <div className="flex gap-2">
                <button onClick={clearHistory} className="text-[10px] text-slate-400 hover:text-rose-500">
                  清空
                </button>
                <Tooltip content="关闭历史记录">
                  <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-100 rounded-xl">
                    <X size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {history.length === 0 ? (
                <p className="text-center text-slate-300 text-[10px] py-20">暂无记录</p>
              ) : (
                history.map((item) => (
                  <button
                    key={item.id}
                  onContextMenu={(e) => openHistoryMenu(e, item)}
                    onClick={() => {
                      setInput(item.data);
                      setShowHistory(false);
                    }}
                    className="w-full text-left p-4 rounded-2xl bg-white border border-slate-200 hover:border-indigo-500 transition"
                  >
                    <span className="text-[9px] text-slate-300 font-mono">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                    <p className="text-[11px] font-bold text-slate-700 truncate mt-1">
                      {item.title || "无标题"}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
