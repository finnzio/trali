import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  register,
  unregisterAll,
} from "@tauri-apps/plugin-global-shortcut";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  GripVerticalIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
  MoonIcon,
  MonitorIcon,
  PencilIcon,
  PinIcon,
  SunIcon,
  SquareIcon,
  Trash2Icon,
  Volume2Icon,
} from "lucide-react";
import {
  WindowControls,
  WindowDragRegion,
} from "@/components/window-chrome";
import { TransferStatusIcon } from "@/components/transfer-status-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ShortcutKeys } from "@/components/ui/kbd";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  isLocale,
  localeNativeNames,
  locales,
  useI18n,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";
import {
  useTheme,
  type RadiusPreset,
  type Theme,
  type ThemeColor,
} from "@/lib/theme";
import {
  downloadText,
} from "@/lib/transfer";
import { APP_NAME, APP_VERSION } from "@/lib/app-meta";
import {
  defaultLanguagePairs,
  formatLanguagePairLabel,
  LANGUAGE_PAIR_LIMIT,
  nextLanguagePairDraft,
  sanitizeLanguagePairs,
  type LanguagePair,
  type PairLanguageCode,
} from "@/lib/language-pairs";
import { normalizeProofreadOutput } from "@/lib/proofread";
import {
  cancelGeneration,
  createGenerationChannel,
  deleteProviderApiKey,
  exportBackendGlossary,
  exportBackendSettings,
  fetchBackendProviderModels,
  generate,
  getSpeechCapabilities,
  importBackendGlossary,
  importBackendSettings,
  loadBackendSnapshot,
  migrateLegacyData,
  saveBackendGlossary,
  saveBackendSettings,
  saveProviderApiKey,
  speakText,
  stopSpeech,
  testBackendProviderConnection,
  type AppSettings,
  type GenerationEvent,
  type GlossaryData,
  type ProviderConfig,
  type ProviderType,
  type SpeechState,
  type StyleConfig,
} from "@/lib/backend";
import "./App.css";

const DEFAULT_TARGET_KEY = "translator.defaultTargetLanguage";
const PROVIDERS_KEY = "translator.providers";
const STYLES_KEY = "translator.styles";
const SELECTED_STYLES_KEY = "translator.selectedStyles";
const GLOSSARY_KEY = "translator.glossary";
const SHORTCUT_KEY = "translator.toggleShortcut";
const CLOSE_BEHAVIOR_KEY = "translator.closeBehavior";
const ALWAYS_ON_TOP_KEY = "translator.alwaysOnTop";
const WORK_MODE_KEY = "translator.workMode";
const DEFAULT_TOGGLE_SHORTCUT = "CommandOrControl+Shift+Space";
const TRANSLATION_DEBOUNCE_MS = 500;
const MAIN_PANEL_MIN_HEIGHT = 128;
const PANEL_DIVIDER_KEYBOARD_STEP = 16;
const PANEL_DIVIDER_SNAP_DISTANCE = 20;
const PANEL_DIVIDER_SNAP_RATIOS = [1 / 3, 1 / 2, 2 / 3] as const;
const IS_LINUX = navigator.userAgent.toLowerCase().includes("linux");
const IS_MACOS = /Macintosh|Mac OS X/u.test(navigator.userAgent);

const languages = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "es",
  "de",
  "fr",
  "pt-BR",
  "ru",
  "hi",
  "id",
  "vi",
  "th",
  "tr",
  "it",
  "pl",
  "uk",
  "nl",
  "ms",
] as const;

type LanguageCode = (typeof languages)[number];

/** Language picker order: alphabetical by code. */
const sortedLanguages = [...languages].sort((a, b) =>
  a.localeCompare(b, "en", { sensitivity: "base" }),
) as LanguageCode[];

/** Dropdown list label: name first, code at the end. Closed trigger uses name only. */
function formatLanguageOption(code: string, name: string) {
  return `${name} · ${code}`;
}
type SettingsTab = "provider" | "styles" | "glossary" | "preferences";
const radiusPresets: RadiusPreset[] = [
  "square",
  "compact",
  "default",
  "rounded",
  "soft",
];
type CloseBehavior = "quit" | "tray";
type WorkMode = "translate" | "proofread";
type StyleDropPosition = "before" | "after";

type ProofreadView = {
  noIssues: boolean;
  issuesText: string | null;
  correctedText: string | null;
  styleSuggestionsText: string | null;
  polishedText: string | null;
  fallbackText: string | null;
  usedFallback: boolean;
};

type GenerationResult = {
  text: string;
  status: "idle" | "streaming" | "completed" | "error";
  error?: string;
  speakableText?: string;
  proofread?: ProofreadView;
};

function isReusableGenerationResult(
  result: GenerationResult | undefined,
): boolean {
  return (
    result != null &&
    result.status === "completed" &&
    result.text.trim().length > 0
  );
}

function readProviders(): ProviderConfig[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(PROVIDERS_KEY) ?? "[]",
    );
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function readStyles(): StyleConfig[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STYLES_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.map((style) => ({
          ...style,
          providerId: style.providerId ?? null,
        }))
      : [];
  } catch {
    return [];
  }
}

function readGlossary(): GlossaryData {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(GLOSSARY_KEY) ?? "{}",
    ) as Partial<GlossaryData>;
    return {
      languages: Array.isArray(stored.languages)
        ? stored.languages.map(String)
        : [],
      concepts: Array.isArray(stored.concepts) ? stored.concepts : [],
    };
  } catch {
    return { languages: [], concepts: [] };
  }
}

function shortcutFromKeyboardEvent(
  event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
) {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return null;
  const parts: string[] = [];
  const isMac = /Macintosh|Mac OS X/u.test(navigator.userAgent);
  if (isMac) {
    if (event.metaKey) parts.push("CommandOrControl");
    if (event.ctrlKey) parts.push("Control");
  } else {
    if (event.ctrlKey) parts.push("CommandOrControl");
    if (event.metaKey) parts.push("Super");
  }
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  const key =
    event.key === " "
      ? "Space"
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key;
  return [...parts, key].join("+");
}

function inferLanguage(text: string): LanguageCode | null {
  const sample = text.trim();
  if (!sample) return null;
  if (/[\u3040-\u30ff]/u.test(sample)) return "ja";
  if (/[\uac00-\ud7af]/u.test(sample)) return "ko";
  if (/[\u0e00-\u0e7f]/u.test(sample)) return "th";
  if (/[\u0900-\u097f]/u.test(sample)) return "hi";
  // Ukrainian-specific letters before general Cyrillic → Russian.
  if (/[іїєґІЇЄҐ]/u.test(sample)) return "uk";
  if (/[\u0400-\u04ff]/u.test(sample)) return "ru";
  if (/[\u3400-\u9fff]/u.test(sample)) return "zh-CN";
  if (/[ăâêôơưđ]/iu.test(sample)) return "vi";
  if (/[ğış]/iu.test(sample) || /[ĞİŞ]/.test(sample)) return "tr";
  if (/[äöüß]/iu.test(sample)) return "de";
  if (/[ãõ]/iu.test(sample) || /ção|ções|não|você/iu.test(sample)) {
    return "pt-BR";
  }
  if (/[éèêàçùœ]/iu.test(sample)) return "fr";
  if (/[áéíóúñ¿¡]/iu.test(sample)) return "es";
  return "en";
}

function readDefaultTarget(): LanguageCode {
  const stored = window.localStorage.getItem(DEFAULT_TARGET_KEY);
  return languages.some((language) => language === stored)
    ? (stored as LanguageCode)
    : "en";
}

function LanguageSelect({
  value,
  onValueChange,
  includeAuto = false,
  autoLabel,
  autoValueLabel,
  languageName,
  triggerClassName,
  languagePairs,
  languagePairsLabel,
  onLanguagePairSelect,
}: {
  value: string;
  onValueChange: (value: string) => void;
  includeAuto?: boolean;
  /** Label for the "auto" option inside the dropdown list. */
  autoLabel?: string;
  /** Closed-state trigger text when "auto" is selected (e.g. with detected language). */
  autoValueLabel?: string;
  languageName: (code: string) => string;
  triggerClassName?: string;
  /** Quick-select pairs shown inside this dropdown (source language menu). */
  languagePairs?: LanguagePair[];
  languagePairsLabel?: string;
  onLanguagePairSelect?: (pair: LanguagePair) => void;
}) {
  const autoOptionLabel = autoLabel ?? "Detect language";
  const pairs = languagePairs ?? [];

  return (
    <Select
      // Always bind the concrete language code so source and target triggers
      // look the same (never stick on pair:* values that widen the control).
      value={value}
      onValueChange={(next) => {
        const raw = String(next);
        if (raw.startsWith("pair:")) {
          const pair = pairs.find((item) => item.id === raw.slice(5));
          if (pair) onLanguagePairSelect?.(pair);
          return;
        }
        onValueChange(raw);
      }}
    >
      <SelectTrigger
        className={
          triggerClassName ??
          "min-w-0 max-w-40 border-0 bg-transparent shadow-none"
        }
      >
        <SelectValue>
          {value === "auto"
            ? (autoValueLabel ?? autoOptionLabel)
            : languageName(value)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {includeAuto && (
          <SelectItem value="auto">{autoOptionLabel}</SelectItem>
        )}
        {pairs.length > 0 && (
          <>
            {includeAuto ? <SelectSeparator /> : null}
            <SelectGroup>
              {languagePairsLabel ? (
                <SelectLabel>{languagePairsLabel}</SelectLabel>
              ) : null}
              {pairs.map((pair) => (
                <SelectItem key={pair.id} value={`pair:${pair.id}`}>
                  {formatLanguagePairLabel(
                    pair.source,
                    pair.target,
                    languageName,
                  )}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
          </>
        )}
        {sortedLanguages.map((language) => (
          <SelectItem key={language} value={language}>
            {formatLanguageOption(language, languageName(language))}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function App() {
  const { locale, setLocale, t } = useI18n();
  const {
    theme,
    setTheme,
    themeColor,
    setThemeColor,
    radius,
    setRadius,
  } = useTheme();
  const [sourceText, setSourceText] = useState("");
  const [workMode, setWorkMode] = useState<WorkMode>(
    () =>
      window.localStorage.getItem(WORK_MODE_KEY) === "proofread"
        ? "proofread"
        : "translate",
  );
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [defaultTarget, setDefaultTarget] = useState(readDefaultTarget);
  const [targetLanguage, setTargetLanguage] = useState(defaultTarget);
  const [settingsTarget, setSettingsTarget] = useState(defaultTarget);
  const [settingsLocale, setSettingsLocale] = useState<Locale>(locale);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("provider");
  const [providers, setProviders] = useState<ProviderConfig[]>(readProviders);
  const [styles, setStyles] = useState<StyleConfig[]>(readStyles);
  const [languagePairs, setLanguagePairs] = useState<LanguagePair[]>(
    defaultLanguagePairs,
  );
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(
    () => readProviders()[0]?.id ?? null,
  );
  const [providerKeyStatuses, setProviderKeyStatuses] = useState<
    Record<string, boolean>
  >({});
  const [providerKeyDrafts, setProviderKeyDrafts] = useState<
    Record<string, string>
  >({});
  const [savingProviderKeyId, setSavingProviderKeyId] = useState<string | null>(
    null,
  );
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(SELECTED_STYLES_KEY) ?? "[]",
      );
      const selected = Array.isArray(stored) ? stored.map(String) : [];
      return selected.length > 0 ? selected : ["default"];
    } catch {
      return ["default"];
    }
  });
  const [glossary, setGlossary] = useState<GlossaryData>(readGlossary);
  const [fetchingProviderId, setFetchingProviderId] = useState<string | null>(
    null,
  );
  const [providerModels, setProviderModels] = useState<
    Record<string, string[]>
  >({});
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  );
  const [providerConnectionStatus, setProviderConnectionStatus] = useState<
    Record<string, "success" | "error">
  >({});
  const [providerPendingDelete, setProviderPendingDelete] =
    useState<ProviderConfig | null>(null);
  const [stylePendingDelete, setStylePendingDelete] =
    useState<StyleConfig | null>(null);
  const [draggedStyleId, setDraggedStyleId] = useState<string | null>(null);
  const draggedStyleIdRef = useRef<string | null>(null);
  const [styleDropTarget, setStyleDropTarget] = useState<{
    id: string;
    position: StyleDropPosition;
  } | null>(null);
  const [glossaryLanguagePendingDelete, setGlossaryLanguagePendingDelete] =
    useState<string | null>(null);
  const [glossaryConceptPendingDelete, setGlossaryConceptPendingDelete] =
    useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [toggleShortcut, setToggleShortcut] = useState(
    () =>
      window.localStorage.getItem(SHORTCUT_KEY) ?? DEFAULT_TOGGLE_SHORTCUT,
  );
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>(
    () =>
      window.localStorage.getItem(CLOSE_BEHAVIOR_KEY) === "quit"
        ? "quit"
        : "tray",
  );
  const settingsImportRef = useRef<HTMLInputElement>(null);
  const glossaryImportRef = useRef<HTMLInputElement>(null);
  const [copiedVersionId, setCopiedVersionId] = useState<string | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(
    () => window.localStorage.getItem(ALWAYS_ON_TOP_KEY) === "true",
  );
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartReady, setAutostartReady] = useState(false);
  const [autostartUpdating, setAutostartUpdating] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [generationResults, setGenerationResults] = useState<
    Record<string, GenerationResult>
  >({});
  const generationResultsRef = useRef(generationResults);
  generationResultsRef.current = generationResults;
  const [generationRefreshNonce, setGenerationRefreshNonce] = useState(0);
  /** Fingerprint of inputs that invalidate cached per-style results. */
  const generationContextRef = useRef<string | null>(null);
  const activeGenerationIdsRef = useRef(new Set<string>());
  const skipNextGenerationRef = useRef(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speakingVariantId, setSpeakingVariantId] = useState<string | null>(
    null,
  );
  const mainPanelLayoutRef = useRef<HTMLElement>(null);
  const mainPanelDividerRef = useRef<HTMLDivElement>(null);
  const activePanelDividerPointerIdRef = useRef<number | null>(null);
  const [sourcePanelRatio, setSourcePanelRatio] = useState(1 / 2);
  const [isPanelDividerDragging, setIsPanelDividerDragging] = useState(false);

  const detectedLanguage = useMemo(
    () => inferLanguage(sourceText),
    [sourceText],
  );
  const languageName = (code: string) =>
    languages.some((language) => language === code)
      ? t(`language.${code}` as TranslationKey)
      : code;
  const closeToTrayLabel = t(
    IS_MACOS
      ? "closeToTrayMacos"
      : IS_LINUX
        ? "closeToTrayLinux"
        : "closeToTrayWindows",
  );
  const glossaryBaseLanguage = locale as LanguageCode;
  const glossaryLanguages = [
    glossaryBaseLanguage,
    ...glossary.languages.filter(
      (language): language is LanguageCode =>
        language !== glossaryBaseLanguage &&
        languages.includes(language as LanguageCode),
    ),
  ];
  const sourceAutoValueLabel =
    sourceLanguage === "auto" && detectedLanguage
      ? t("autoDetectWithLanguage", {
          language: languageName(detectedLanguage),
        })
      : t("autoDetect");
  const selectedStyles = styles.filter((style) =>
    selectedStyleIds.includes(style.id),
  );
  const translationVersions = [
    ...(selectedStyleIds.includes("default")
      ? [
          {
            id: "default",
            name: t("defaultStyle"),
            ...(generationResults.default ?? {
              text: "",
              status: "idle" as const,
            }),
          },
        ]
      : []),
    ...selectedStyles.map((style) => ({
          id: style.id,
          name: style.name || t("unnamedStyle"),
          ...(generationResults[style.id] ?? {
            text: "",
            status: "idle" as const,
          }),
        })),
  ];
  // Only show loading while a request is in flight — not during debounce wait.
  const isGenerating = Object.values(generationResults).some(
    ({ status }) => status === "streaming",
  );
  const swapVersion =
    workMode === "translate" ? translationVersions[0] : undefined;
  const hasResolvedSourceLanguage =
    sourceLanguage !== "auto" || detectedLanguage !== null;
  const canSwapTranslation =
    !isGenerating && swapVersion !== undefined && hasResolvedSourceLanguage;

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    void loadBackendSnapshot()
      .then(async (snapshot) => {
        if (snapshot.needsMigration) {
          await migrateLegacyData(buildBackendSettings(), glossary);
          [
            DEFAULT_TARGET_KEY,
            PROVIDERS_KEY,
            STYLES_KEY,
            SELECTED_STYLES_KEY,
            GLOSSARY_KEY,
            SHORTCUT_KEY,
            CLOSE_BEHAVIOR_KEY,
            ALWAYS_ON_TOP_KEY,
            WORK_MODE_KEY,
            "translator.interfaceLanguage",
            "translator.theme",
            "translator.themeColor",
            "translator.radius",
          ].forEach((key) => window.localStorage.removeItem(key));
        } else {
          applyBackendSettings(snapshot.settings);
          setGlossary(snapshot.glossary);
        }
        if (!cancelled) {
          setProviderKeyStatuses(snapshot.providerKeyStatuses);
          setBackendReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setBackendReady(false);
      });

    return () => {
      cancelled = true;
    };
    // The first snapshot deliberately uses the initial legacy state for migration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!backendReady || !isTauri()) return;
    const timeout = window.setTimeout(() => {
      void saveBackendSettings(buildBackendSettings());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [
    alwaysOnTop,
    backendReady,
    closeBehavior,
    defaultProviderId,
    defaultTarget,
    languagePairs,
    locale,
    providers,
    radius,
    selectedStyleIds,
    styles,
    theme,
    themeColor,
    toggleShortcut,
    workMode,
  ]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getSpeechCapabilities()
      .then((capabilities) => setSpeechSupported(capabilities.supported))
      .catch(() => setSpeechSupported(false));
    void listen<SpeechState>("speech-state", (event) => {
      setSpeakingVariantId(
        event.payload.status === "playing"
          ? event.payload.variantId
          : null,
      );
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => {
      unlisten?.();
      void stopSpeech().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void getCurrentWindow().setAlwaysOnTop(alwaysOnTop).catch(() => {
      // Browser preview does not expose Tauri window APIs.
    });
  }, [alwaysOnTop]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void isAutostartEnabled()
      .then((enabled) => {
        if (!cancelled) {
          setAutostartEnabled(enabled);
          setAutostartReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setAutostartReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedStyleIds((current) => {
      const next = current.filter(
        (id) => id === "default" || styles.some((style) => style.id === id),
      );
      if (next.length === 0) next.push("default");
      if (
        next.length !== current.length ||
        next.some((id, index) => id !== current[index])
      ) {
        if (!isTauri()) {
          window.localStorage.setItem(
            SELECTED_STYLES_KEY,
            JSON.stringify(next),
          );
        }
        return next;
      }
      return current;
    });
  }, [styles]);

  useEffect(() => {
    void invoke("set_close_to_tray", {
      enabled: closeBehavior === "tray",
    }).catch(() => {
      // Browser preview does not expose Tauri commands.
    });
  }, [closeBehavior]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void unregisterAll()
        .then(() =>
          register(toggleShortcut, (event) => {
            if (event.state === "Pressed") {
              void invoke("toggle_window");
            }
          }),
        )
        .catch(() => {
          // The browser preview does not expose Tauri's global shortcut API.
        });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [toggleShortcut]);

  useEffect(() => {
    const text = sourceText.trim();
    const resolvedSourceLanguage =
      sourceLanguage === "auto"
        ? (detectedLanguage ?? "auto")
        : sourceLanguage;
    const contextKey = JSON.stringify({
      text,
      workMode,
      sourceLanguage: resolvedSourceLanguage,
      targetLanguage,
      locale,
      defaultProviderId,
      providers: providers.map((provider) => ({
        id: provider.id,
        type: provider.type,
        endpoint: provider.endpoint,
        model: provider.model,
      })),
      styles: styles.map((style) => ({
        id: style.id,
        name: style.name,
        prompt: style.prompt,
        providerId: style.providerId,
      })),
    });

    if (skipNextGenerationRef.current) {
      skipNextGenerationRef.current = false;
      generationContextRef.current = contextKey;
      return;
    }

    const cancelAllGenerations = () => {
      for (const requestId of activeGenerationIdsRef.current) {
        void cancelGeneration(requestId).catch(() => {});
      }
      activeGenerationIdsRef.current.clear();
    };

    if (
      !text ||
      !backendReady ||
      !defaultProviderId ||
      selectedStyleIds.length === 0 ||
      !isTauri()
    ) {
      cancelAllGenerations();
      generationContextRef.current = null;
      setGenerationResults({});
      return;
    }

    const contextChanged = generationContextRef.current !== contextKey;

    // Content/settings changed: drop in-flight work. Style-only toggles keep
    // completed results and any still-running requests for other styles.
    if (contextChanged) {
      cancelAllGenerations();
      setGenerationResults((current) => {
        let changed = false;
        const next = Object.fromEntries(
          Object.entries(current).map(([id, value]) => {
            if (value.status === "streaming" || value.status === "idle") {
              changed = true;
              return [id, { ...value, status: "completed" as const }];
            }
            return [id, value];
          }),
        );
        return changed ? next : current;
      });
    }

    const timeout = window.setTimeout(() => {
      const cached = generationResultsRef.current;
      const idsToGenerate = contextChanged
        ? [...selectedStyleIds]
        : selectedStyleIds.filter(
            (id) => !isReusableGenerationResult(cached[id]),
          );

      if (idsToGenerate.length === 0) {
        generationContextRef.current = contextKey;
        return;
      }

      // Loading only for styles that actually need a request.
      setGenerationResults((current) => {
        if (contextChanged) {
          return Object.fromEntries(
            selectedStyleIds.map((id) => [
              id,
              idsToGenerate.includes(id)
                ? { text: "", status: "streaming" as const }
                : current[id] ?? { text: "", status: "idle" as const },
            ]),
          );
        }
        const next = { ...current };
        for (const id of idsToGenerate) {
          next[id] = { text: "", status: "streaming" };
        }
        return next;
      });

      const requestId = window.crypto.randomUUID();
      activeGenerationIdsRef.current.add(requestId);
      generationContextRef.current = contextKey;

      const onEvent = createGenerationChannel((event: GenerationEvent) => {
        if (!activeGenerationIdsRef.current.has(event.requestId)) return;
        if (event.type === "allCompleted") {
          activeGenerationIdsRef.current.delete(event.requestId);
          return;
        }
        setGenerationResults((current) => {
          const previous = current[event.variantId] ?? {
            text: "",
            status: "idle" as const,
          };
          if (event.type === "started") {
            return {
              ...current,
              [event.variantId]: { ...previous, status: "streaming" },
            };
          }
          if (event.type === "delta") {
            return {
              ...current,
              [event.variantId]: {
                ...previous,
                status: "streaming",
                text: previous.text + event.text,
              },
            };
          }
          if (event.type === "completed") {
            if (workMode === "proofread") {
              const normalized = normalizeProofreadOutput(previous.text, {
                hasStyle: event.variantId !== "default",
                sourceText: text,
                emptyResult: t("proofreadEmptyResult"),
                unexpectedFormat: t("proofreadUnexpectedFormat"),
              });
              return {
                ...current,
                [event.variantId]: {
                  ...previous,
                  status: "completed",
                  text:
                    normalized.correctedText ??
                    normalized.polishedText ??
                    normalized.fallbackText ??
                    previous.text,
                  speakableText:
                    normalized.speakableText ??
                    event.speakableText ??
                    undefined,
                  proofread: {
                    noIssues: normalized.noIssues,
                    issuesText: normalized.issuesText,
                    correctedText: normalized.correctedText,
                    styleSuggestionsText: normalized.styleSuggestionsText,
                    polishedText: normalized.polishedText,
                    fallbackText: normalized.fallbackText,
                    usedFallback: normalized.usedFallback,
                  },
                },
              };
            }
            return {
              ...current,
              [event.variantId]: {
                ...previous,
                status: "completed",
                speakableText: event.speakableText ?? undefined,
              },
            };
          }
          return {
            ...current,
            [event.variantId]: {
              ...previous,
              status: "error",
              error: event.message,
            },
          };
        });
      });

      void generate(
        {
          requestId,
          mode: workMode,
          sourceText: text,
          sourceLanguage: resolvedSourceLanguage,
          targetLanguage,
          responseLanguage: locale,
          variants: idsToGenerate.map((id) => ({
            id,
            styleId: id === "default" ? null : id,
          })),
        },
        onEvent,
      ).catch((error: unknown) => {
        if (!activeGenerationIdsRef.current.has(requestId)) return;
        activeGenerationIdsRef.current.delete(requestId);
        const message =
          typeof error === "object" &&
          error !== null &&
          "message" in error
            ? String(error.message)
            : String(error);
        setGenerationResults((current) => {
          const next = { ...current };
          for (const id of idsToGenerate) {
            const value = next[id];
            if (
              value &&
              (value.status === "idle" || value.status === "streaming")
            ) {
              next[id] = { ...value, status: "error", error: message };
            }
          }
          return next;
        });
      });
    }, TRANSLATION_DEBOUNCE_MS);

    return () => {
      // Only clear the debounce timer. In-flight requests are cancelled when
      // the generation context changes, not when styles are toggled.
      window.clearTimeout(timeout);
    };
  }, [
    backendReady,
    defaultProviderId,
    detectedLanguage,
    generationRefreshNonce,
    locale,
    providers,
    selectedStyleIds,
    sourceLanguage,
    sourceText,
    styles,
    targetLanguage,
    workMode,
  ]);

  function buildBackendSettings(): AppSettings {
    return {
      version: 2,
      interfaceLanguage: locale,
      theme,
      themeColor,
      radius,
      shortcut: toggleShortcut,
      defaultTargetLanguage: defaultTarget,
      closeBehavior,
      alwaysOnTop,
      workMode,
      selectedStyleIds,
      defaultProviderId,
      providers,
      styles,
      languagePairs,
    };
  }

  function applyBackendSettings(settings: AppSettings) {
    const nextLocale: Locale = isLocale(settings.interfaceLanguage)
      ? settings.interfaceLanguage
      : "en";
    const nextTheme: Theme =
      settings.theme === "light" || settings.theme === "dark"
        ? settings.theme
        : "auto";
    const nextThemeColor: ThemeColor = (
      ["neutral", "blue", "green", "violet", "orange"] as ThemeColor[]
    ).includes(settings.themeColor as ThemeColor)
      ? (settings.themeColor as ThemeColor)
      : "green";
    const nextRadius: RadiusPreset = radiusPresets.includes(
      settings.radius as RadiusPreset,
    )
      ? (settings.radius as RadiusPreset)
      : "default";
    const nextTarget = languages.includes(
      settings.defaultTargetLanguage as LanguageCode,
    )
      ? (settings.defaultTargetLanguage as LanguageCode)
      : "en";
    const nextProviders = settings.providers ?? [];
    const providerIds = new Set(nextProviders.map((provider) => provider.id));
    const nextStyles = (settings.styles ?? []).map((style) => ({
      ...style,
      providerId:
        style.providerId && providerIds.has(style.providerId)
          ? style.providerId
          : null,
    }));

    setLocale(nextLocale);
    setSettingsLocale(nextLocale);
    setTheme(nextTheme);
    setThemeColor(nextThemeColor);
    setRadius(nextRadius);
    setToggleShortcut(
      settings.shortcut.trim() || DEFAULT_TOGGLE_SHORTCUT,
    );
    setDefaultTarget(nextTarget);
    setSettingsTarget(nextTarget);
    setTargetLanguage(nextTarget);
    setCloseBehavior(settings.closeBehavior === "quit" ? "quit" : "tray");
    setAlwaysOnTop(Boolean(settings.alwaysOnTop));
    setWorkMode(
      settings.workMode === "proofread" ? "proofread" : "translate",
    );
    setProviders(nextProviders);
    setStyles(nextStyles);
    setDefaultProviderId(
      settings.defaultProviderId &&
        providerIds.has(settings.defaultProviderId)
        ? settings.defaultProviderId
        : (nextProviders[0]?.id ?? null),
    );
    setSelectedStyleIds(
      settings.selectedStyleIds?.length
        ? settings.selectedStyleIds
        : ["default"],
    );
    setLanguagePairs(sanitizeLanguagePairs(settings.languagePairs));
  }

  function openSettings() {
    setSettingsTarget(defaultTarget);
    setSettingsLocale(locale);
    setSettingsOpen(true);
  }

  function saveProviders(nextProviders: ProviderConfig[]) {
    setProviders(nextProviders);
    if (!isTauri()) {
      window.localStorage.setItem(PROVIDERS_KEY, JSON.stringify(nextProviders));
    }
  }

  function addProvider() {
    const id = window.crypto.randomUUID();
    saveProviders([
      ...providers,
      {
        id,
        name: `${t("providerDefaultName")} ${providers.length + 1}`,
        type: "openai-compatible",
        endpoint: "",
        model: "",
      },
    ]);
    if (!defaultProviderId) setDefaultProviderId(id);
  }

  function updateProvider(
    id: string,
    field: keyof Omit<ProviderConfig, "id">,
    value: string,
  ) {
    if (field === "endpoint") {
      setProviderConnectionStatus((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setProviderModels((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    saveProviders(
      providers.map((provider) =>
        provider.id === id ? { ...provider, [field]: value } : provider,
      ),
    );
  }

  function removeProvider(id: string) {
    const nextProviders = providers.filter((provider) => provider.id !== id);
    saveProviders(nextProviders);
    saveStyles(
      styles.map((style) =>
        style.providerId === id ? { ...style, providerId: null } : style,
      ),
    );
    if (defaultProviderId === id) {
      setDefaultProviderId(nextProviders[0]?.id ?? null);
    }
    setProviderKeyStatuses((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    void deleteProviderApiKey(id).catch(() => {});
    setProviderPendingDelete(null);
  }

  function saveStyles(nextStyles: StyleConfig[]) {
    setStyles(nextStyles);
    if (!isTauri()) {
      window.localStorage.setItem(STYLES_KEY, JSON.stringify(nextStyles));
    }
  }

  function addStyle() {
    saveStyles([
      ...styles,
      {
        id: window.crypto.randomUUID(),
        name: `${t("styleDefaultName")} ${styles.length + 1}`,
        prompt: "",
        providerId: null,
      },
    ]);
  }

  function updateStyle<K extends keyof Omit<StyleConfig, "id">>(
    id: string,
    field: K,
    value: StyleConfig[K],
  ) {
    saveStyles(
      styles.map((style) =>
        style.id === id ? { ...style, [field]: value } : style,
      ),
    );
  }

  function reorderStyle(
    draggedId: string,
    targetId: string,
    position: StyleDropPosition,
  ) {
    if (draggedId === targetId) return;
    const nextStyles = [...styles];
    const draggedIndex = nextStyles.findIndex(
      (style) => style.id === draggedId,
    );
    if (draggedIndex < 0) return;
    const [draggedStyle] = nextStyles.splice(draggedIndex, 1);
    const targetIndex = nextStyles.findIndex((style) => style.id === targetId);
    if (!draggedStyle || targetIndex < 0) return;
    nextStyles.splice(
      position === "after" ? targetIndex + 1 : targetIndex,
      0,
      draggedStyle,
    );
    saveStyles(nextStyles);
  }

  function getStyleDropTarget(
    clientX: number,
    clientY: number,
  ): { id: string; position: StyleDropPosition } | null {
    const element = document.elementFromPoint(clientX, clientY);
    const card = element?.closest<HTMLElement>("[data-style-id]");
    const id = card?.dataset.styleId;
    if (!card || !id) return null;
    const rect = card.getBoundingClientRect();
    return {
      id,
      position:
        clientY < rect.top + rect.height / 2 ? "before" : "after",
    };
  }

  function moveStyleByOffset(styleId: string, offset: -1 | 1) {
    const currentIndex = styles.findIndex((style) => style.id === styleId);
    const target = styles[currentIndex + offset];
    if (currentIndex < 0 || !target) return;
    reorderStyle(
      styleId,
      target.id,
      offset < 0 ? "before" : "after",
    );
  }

  function removeStyle(id: string) {
    saveStyles(styles.filter((style) => style.id !== id));
    setStylePendingDelete(null);
  }

  function saveGlossary(nextGlossary: GlossaryData) {
    const normalized: GlossaryData = {
      languages: nextGlossary.languages.filter((language) =>
        languages.includes(language as LanguageCode),
      ),
      concepts: nextGlossary.concepts.map((concept) => {
        const terms: Record<string, string> = {};
        for (const [language, term] of Object.entries(concept.terms)) {
          if (
            language === glossaryBaseLanguage ||
            languages.includes(language as LanguageCode)
          ) {
            terms[language] = term;
          }
        }
        return { ...concept, terms };
      }),
    };
    setGlossary(normalized);
    if (backendReady && isTauri()) {
      void saveBackendGlossary(normalized);
    } else if (!isTauri()) {
      window.localStorage.setItem(GLOSSARY_KEY, JSON.stringify(normalized));
    }
  }

  function addGlossaryLanguage(language: LanguageCode) {
    if (!languages.includes(language)) return;
    if (glossaryLanguages.includes(language)) return;
    saveGlossary({
      ...glossary,
      languages: [...glossary.languages, language],
    });
  }

  function removeGlossaryLanguage(language: string) {
    if (language === glossaryBaseLanguage) return;
    saveGlossary({
      languages: glossary.languages.filter((item) => item !== language),
      concepts: glossary.concepts.map((concept) => {
        const terms = { ...concept.terms };
        delete terms[language];
        return { ...concept, terms };
      }),
    });
    setGlossaryLanguagePendingDelete(null);
  }

  function addGlossaryConcept() {
    saveGlossary({
      ...glossary,
      concepts: [
        ...glossary.concepts,
        { id: window.crypto.randomUUID(), terms: {} },
      ],
    });
  }

  function updateGlossaryTerm(
    id: string,
    language: string,
    term: string,
  ) {
    saveGlossary({
      languages: glossary.languages.includes(language)
        ? glossary.languages
        : [...glossary.languages, language],
      concepts: glossary.concepts.map((item) =>
        item.id === id
          ? { ...item, terms: { ...item.terms, [language]: term } }
          : item,
      ),
    });
  }

  function removeGlossaryConcept(id: string) {
    saveGlossary({
      ...glossary,
      concepts: glossary.concepts.filter((item) => item.id !== id),
    });
    setGlossaryConceptPendingDelete(null);
  }

  async function fetchProviderModels(provider: ProviderConfig) {
    if (!provider.endpoint.trim()) return;

    setFetchingProviderId(provider.id);
    try {
      await saveBackendSettings(buildBackendSettings());
      const models = await fetchBackendProviderModels(provider.id);
      setProviderModels((current) => ({
        ...current,
        [provider.id]: models,
      }));
    } catch {
      setProviderModels((current) => ({
        ...current,
        [provider.id]: [],
      }));
    } finally {
      setFetchingProviderId(null);
    }
  }

  async function testProviderConnection(provider: ProviderConfig) {
    if (!provider.endpoint.trim()) return;

    setTestingProviderId(provider.id);
    try {
      await saveBackendSettings(buildBackendSettings());
      await testBackendProviderConnection(provider.id);
      setProviderConnectionStatus((current) => ({
        ...current,
        [provider.id]: "success",
      }));
    } catch {
      setProviderConnectionStatus((current) => ({
        ...current,
        [provider.id]: "error",
      }));
    } finally {
      setTestingProviderId(null);
    }
  }

  async function commitProviderApiKey(providerId: string) {
    const apiKey = providerKeyDrafts[providerId]?.trim() ?? "";
    if (!apiKey || savingProviderKeyId === providerId) return;
    setSavingProviderKeyId(providerId);
    try {
      await saveProviderApiKey(providerId, apiKey);
      setProviderKeyStatuses((current) => ({
        ...current,
        [providerId]: true,
      }));
      setProviderKeyDrafts((current) => ({
        ...current,
        [providerId]: "",
      }));
      setProviderConnectionStatus((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
    } catch {
      setProviderConnectionStatus((current) => ({
        ...current,
        [providerId]: "error",
      }));
    } finally {
      setSavingProviderKeyId(null);
    }
  }

  async function clearProviderApiKey(providerId: string) {
    try {
      await deleteProviderApiKey(providerId);
      setProviderKeyStatuses((current) => ({
        ...current,
        [providerId]: false,
      }));
    } catch {
      setProviderConnectionStatus((current) => ({
        ...current,
        [providerId]: "error",
      }));
    }
  }

  async function exportSettings() {
    await saveBackendSettings(buildBackendSettings());
    downloadText(
      "settings.toml",
      await exportBackendSettings(),
      "application/toml;charset=utf-8",
    );
  }

  async function importSettings(file: File) {
    const imported = await importBackendSettings(await file.text());
    applyBackendSettings(imported);
    setProviderKeyStatuses((current) =>
      Object.fromEntries(
        imported.providers.map((provider) => [
          provider.id,
          current[provider.id] ?? false,
        ]),
      ),
    );
  }

  async function exportGlossary() {
    const normalized = {
      languages: glossaryLanguages,
      concepts: glossary.concepts,
    };
    await saveBackendGlossary(normalized);
    downloadText(
      "glossary.csv",
      await exportBackendGlossary(),
      "text/csv;charset=utf-8",
    );
  }

  async function importGlossary(file: File) {
    const imported = await importBackendGlossary(await file.text());
    const normalized = {
      languages: [
        glossaryBaseLanguage,
        ...imported.languages.filter(
          (language) => language !== glossaryBaseLanguage,
        ),
      ],
      concepts: imported.concepts,
    };
    await saveBackendGlossary(normalized);
    setGlossary(normalized);
  }

  function toggleSelectedStyle(styleId: string) {
    setSelectedStyleIds((current) => {
      const next = current.includes(styleId)
        ? current.filter((id) => id !== styleId)
        : [...current, styleId];
      if (next.length === 0) next.push("default");
      if (!isTauri()) {
        window.localStorage.setItem(SELECTED_STYLES_KEY, JSON.stringify(next));
      }
      return next;
    });
  }

  /** Source and target must differ; choosing the other side's language swaps them. */
  function changeSourceLanguage(next: string) {
    if (next !== "auto" && next === targetLanguage) {
      const previousSource = sourceLanguage;
      setSourceLanguage(next);
      if (
        previousSource !== "auto" &&
        languages.includes(previousSource as LanguageCode)
      ) {
        setTargetLanguage(previousSource as LanguageCode);
      } else {
        setTargetLanguage(next === "en" ? "zh-CN" : "en");
      }
      return;
    }
    setSourceLanguage(next);
  }

  function changeTargetLanguage(next: LanguageCode) {
    if (sourceLanguage !== "auto" && next === sourceLanguage) {
      const previousTarget = targetLanguage;
      setTargetLanguage(next);
      setSourceLanguage(previousTarget);
      return;
    }
    setTargetLanguage(next);
  }

  function applyLanguagePair(pair: LanguagePair) {
    setSourceLanguage(pair.source);
    setTargetLanguage(pair.target);
  }

  function addLanguagePair() {
    if (languagePairs.length >= LANGUAGE_PAIR_LIMIT) return;
    const draft = nextLanguagePairDraft(languagePairs);
    setLanguagePairs((current) => [
      ...current,
      {
        id: window.crypto.randomUUID(),
        source: draft.source,
        target: draft.target,
      },
    ]);
  }

  function updateLanguagePair(
    id: string,
    field: "source" | "target",
    value: PairLanguageCode,
  ) {
    setLanguagePairs((current) =>
      current.map((pair) => {
        if (pair.id !== id) return pair;
        if (field === "source") {
          if (value === pair.target) {
            return { ...pair, source: value, target: pair.source };
          }
          return { ...pair, source: value };
        }
        if (value === pair.source) {
          return { ...pair, target: value, source: pair.target };
        }
        return { ...pair, target: value };
      }),
    );
  }

  function removeLanguagePair(id: string) {
    setLanguagePairs((current) => current.filter((pair) => pair.id !== id));
  }

  async function copyTranslation(versionId: string, text: string) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedVersionId(versionId);
    window.setTimeout(() => setCopiedVersionId(null), 1500);
  }

  function regenerateResult(versionId: string) {
    if (isGenerating) return;
    setGenerationResults((current) => ({
      ...current,
      [versionId]: { text: "", status: "idle" },
    }));
    setGenerationRefreshNonce((current) => current + 1);
  }

  async function updateAutostart(enabled: boolean) {
    if (!isTauri() || autostartUpdating) return;
    setAutostartUpdating(true);
    try {
      if (enabled) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
      setAutostartEnabled(await isAutostartEnabled());
    } catch {
      try {
        setAutostartEnabled(await isAutostartEnabled());
      } catch {
        // Keep the last confirmed state when the operating system is unavailable.
      }
    } finally {
      setAutostartUpdating(false);
    }
  }

  function swapSourceAndTranslation() {
    if (!canSwapTranslation || !swapVersion) return;

    const previousSourceLanguage =
      sourceLanguage === "auto"
        ? detectedLanguage
        : languages.includes(sourceLanguage as LanguageCode)
          ? (sourceLanguage as LanguageCode)
          : null;
    if (!previousSourceLanguage) return;

    const previousSourceText = sourceText;
    skipNextGenerationRef.current = true;
    setSourceText(swapVersion.text);
    setSourceLanguage(targetLanguage);
    setTargetLanguage(previousSourceLanguage);
    setGenerationResults(
      Object.fromEntries(
        translationVersions.map(({ id }) => [
          id,
          {
            text: previousSourceText,
            status: "completed" as const,
            speakableText: previousSourceText,
          },
        ]),
      ),
    );
  }

  function getMainPanelLayoutMetrics() {
    const layout = mainPanelLayoutRef.current;
    if (!layout) return null;

    const bounds = layout.getBoundingClientRect();
    const dividerHeight =
      mainPanelDividerRef.current?.getBoundingClientRect().height ?? 0;
    const availableHeight = Math.max(0, bounds.height - dividerHeight);
    if (availableHeight === 0) return null;

    const minimumRatio = Math.min(
      MAIN_PANEL_MIN_HEIGHT / availableHeight,
      1 / 2,
    );
    return { bounds, dividerHeight, availableHeight, minimumRatio };
  }

  function constrainMainPanelRatio(nextRatio: number, snap: boolean) {
    const metrics = getMainPanelLayoutMetrics();
    if (!metrics) return sourcePanelRatio;

    const { availableHeight, minimumRatio } = metrics;
    const maximumRatio = 1 - minimumRatio;
    const clampedRatio = Math.min(
      maximumRatio,
      Math.max(minimumRatio, nextRatio),
    );

    if (!snap) return clampedRatio;

    const snapRatio = PANEL_DIVIDER_SNAP_RATIOS.find(
      (ratio) =>
        ratio >= minimumRatio &&
        ratio <= maximumRatio &&
        Math.abs(ratio - clampedRatio) * availableHeight <=
          PANEL_DIVIDER_SNAP_DISTANCE,
    );
    return snapRatio ?? clampedRatio;
  }

  function updateMainPanelDivider(clientY: number) {
    const metrics = getMainPanelLayoutMetrics();
    if (!metrics) return;

    const { bounds, dividerHeight, availableHeight } = metrics;
    const sourceHeight = clientY - bounds.top - dividerHeight / 2;
    setSourcePanelRatio(
      constrainMainPanelRatio(sourceHeight / availableHeight, true),
    );
  }

  function handlePanelDividerPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    activePanelDividerPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanelDividerDragging(true);
    updateMainPanelDivider(event.clientY);
  }

  function handlePanelDividerPointerMove(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (activePanelDividerPointerIdRef.current !== event.pointerId) return;
    updateMainPanelDivider(event.clientY);
  }

  function handlePanelDividerPointerEnd(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (activePanelDividerPointerIdRef.current !== event.pointerId) return;

    const divider = mainPanelDividerRef.current;
    if (divider?.hasPointerCapture(event.pointerId)) {
      divider.releasePointerCapture(event.pointerId);
    }
    activePanelDividerPointerIdRef.current = null;
    setIsPanelDividerDragging(false);
  }

  function handlePanelDividerKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const metrics = getMainPanelLayoutMetrics();
    if (!metrics) return;

    const step =
      (event.shiftKey
        ? PANEL_DIVIDER_KEYBOARD_STEP * 3
        : PANEL_DIVIDER_KEYBOARD_STEP) /
      metrics.availableHeight;
    let nextRatio: number | null = null;

    if (event.key === "ArrowUp") nextRatio = sourcePanelRatio - step;
    if (event.key === "ArrowDown") nextRatio = sourcePanelRatio + step;
    if (event.key === "Home") nextRatio = metrics.minimumRatio;
    if (event.key === "End") nextRatio = 1 - metrics.minimumRatio;
    if (nextRatio === null) return;

    event.preventDefault();
    setSourcePanelRatio(constrainMainPanelRatio(nextRatio, false));
  }

  async function toggleSpeech(versionId: string, text: string) {
    if (speakingVariantId === versionId) {
      await stopSpeech();
      return;
    }
    await speakText(
      versionId,
      text,
      workMode === "translate"
        ? targetLanguage
        : sourceLanguage === "auto"
          ? (detectedLanguage ?? locale)
          : sourceLanguage,
    );
  }

  if (settingsOpen) {
    const tabs: Array<{ value: SettingsTab; label: string }> = [
      { value: "provider", label: t("settingsTabProvider") },
      { value: "styles", label: t("settingsTabStyles") },
      { value: "glossary", label: t("settingsTabGlossary") },
      { value: "preferences", label: t("settingsTabPreferences") },
    ];
    const settingsTabIndex = tabs.findIndex(
      (tab) => tab.value === settingsTab,
    );

    return (
      <main className="h-svh overflow-auto bg-muted/30">
        <div className="mx-auto w-full max-w-2xl px-3 py-2 sm:px-4">
          <header className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(false)}
              aria-label={t("backToTranslator")}
              className="h-auto shrink-0 gap-1 px-1 py-1 font-semibold"
            >
              <ArrowLeftIcon className="size-4" />
              <span>{t("settingsTitle")}</span>
            </Button>
            <WindowDragRegion />
            <WindowControls />
          </header>

          <div
            className="relative mt-2 grid w-fit grid-cols-4 rounded-md bg-muted p-0.5"
            role="tablist"
            aria-label={t("settingsSections")}
          >
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(25%-1px)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${
                settingsTabIndex === 1
                  ? "translate-x-full"
                  : settingsTabIndex === 2
                    ? "translate-x-[200%]"
                    : settingsTabIndex === 3
                      ? "translate-x-[300%]"
                      : "translate-x-0"
              }`}
            />
            {tabs.map((tab) => (
              <Button
                key={tab.value}
                variant="ghost"
                role="tab"
                aria-selected={settingsTab === tab.value}
                onClick={() => setSettingsTab(tab.value)}
                className={`relative z-10 h-8 rounded-md bg-transparent px-3 text-sm font-medium transition-colors duration-200 hover:bg-transparent ${
                  settingsTab === tab.value
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <section
            className="mt-3 rounded-xl border bg-card p-4"
            role="tabpanel"
          >
            {settingsTab === "provider" && (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{t("providerTitle")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("providerDescription")}
                    </p>
                  </div>
                  <Button size="sm" onClick={addProvider}>
                    <PlusIcon />
                    {t("addProvider")}
                  </Button>
                </div>

                {providers.length === 0 && (
                  <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("providerEmpty")}
                  </div>
                )}

                {providers.map((provider) => (
                  <div
                    key={provider.id}
                    className="grid gap-3 rounded-lg border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-1">
                        {editingTitle === `provider:${provider.id}` ? (
                          <Input
                            value={provider.name}
                            autoFocus
                            className="h-7 max-w-56"
                            onChange={(event) =>
                              updateProvider(
                                provider.id,
                                "name",
                                event.currentTarget.value,
                              )
                            }
                            onBlur={() => setEditingTitle(null)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        ) : (
                          <>
                            <p className="truncate text-sm font-medium">
                              {provider.name || t("unnamedProvider")}
                            </p>
                            {defaultProviderId === provider.id && (
                              <Badge variant="secondary">
                                {t("defaultProvider")}
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                setEditingTitle(`provider:${provider.id}`)
                              }
                              aria-label={t("editName")}
                            >
                              <PencilIcon />
                            </Button>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {defaultProviderId !== provider.id && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setDefaultProviderId(provider.id)}
                          >
                            {t("setDefaultProvider")}
                          </Button>
                        )}
                        {providerConnectionStatus[provider.id] ===
                          "success" && (
                          <CircleCheckIcon className="size-4 text-emerald-600" />
                        )}
                        {providerConnectionStatus[provider.id] === "error" && (
                          <CircleXIcon className="size-4 text-destructive" />
                        )}
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={
                            !provider.endpoint.trim() ||
                            testingProviderId === provider.id
                          }
                          onClick={() =>
                            void testProviderConnection(provider)
                          }
                        >
                          <RefreshCwIcon
                            className={
                              testingProviderId === provider.id
                                ? "animate-spin"
                                : undefined
                            }
                          />
                          {testingProviderId === provider.id
                            ? t("testingConnection")
                            : t("testConnection")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setProviderPendingDelete(provider)}
                          aria-label={t("removeProvider")}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label>{t("providerType")}</Label>
                        <Select
                          value={provider.type}
                          onValueChange={(value) =>
                            updateProvider(
                              provider.id,
                              "type",
                              String(value) as ProviderType,
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {provider.type === "openai-compatible"
                                ? "OpenAI-compatible"
                                : "Anthropic-compatible"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent align="start">
                            <SelectItem value="openai-compatible">
                              OpenAI-compatible
                            </SelectItem>
                            <SelectItem value="anthropic-compatible">
                              Anthropic-compatible
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label>{t("providerEndpoint")}</Label>
                        <Input
                          value={provider.endpoint}
                          placeholder="https://api.example.com/v1"
                          onChange={(event) =>
                            updateProvider(
                              provider.id,
                              "endpoint",
                              event.currentTarget.value,
                            )
                          }
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={`provider-key-${provider.id}`}>
                            {t("providerApiKey")}
                          </Label>
                          <div className="flex items-center gap-1">
                            {providerKeyStatuses[provider.id] && (
                              <Badge variant="secondary">
                                {t("apiKeySaved")}
                              </Badge>
                            )}
                            {providerKeyStatuses[provider.id] && (
                              <Button
                                variant="ghost"
                                size="xs"
                                onMouseDown={(event) =>
                                  event.preventDefault()
                                }
                                onClick={() =>
                                  void clearProviderApiKey(provider.id)
                                }
                              >
                                {t("removeApiKey")}
                              </Button>
                            )}
                          </div>
                        </div>
                        <Input
                          id={`provider-key-${provider.id}`}
                          type="password"
                          autoComplete="off"
                          value={providerKeyDrafts[provider.id] ?? ""}
                          placeholder={
                            providerKeyStatuses[provider.id]
                              ? t("apiKeySaved")
                              : t("providerApiKey")
                          }
                          disabled={savingProviderKeyId === provider.id}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setProviderKeyDrafts((current) => ({
                              ...current,
                              [provider.id]: value,
                            }));
                          }}
                          onBlur={() =>
                            void commitProviderApiKey(provider.id)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label>{t("providerModel")}</Label>
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={
                              !provider.endpoint.trim() ||
                              fetchingProviderId === provider.id
                            }
                            onClick={() => void fetchProviderModels(provider)}
                          >
                            <RefreshCwIcon
                              className={
                                fetchingProviderId === provider.id
                                  ? "animate-spin"
                                  : undefined
                              }
                            />
                            {t("fetchModels")}
                          </Button>
                        </div>
                        {providerModels[provider.id]?.length ? (
                          <Select
                            value={provider.model}
                            onValueChange={(value) =>
                              updateProvider(
                                provider.id,
                                "model",
                                String(value),
                              )
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue>
                                {provider.model || t("selectModel")}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent align="start">
                              {providerModels[provider.id].map((model) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            value={provider.model}
                            placeholder="model-name"
                            onChange={(event) =>
                              updateProvider(
                                provider.id,
                                "model",
                                event.currentTarget.value,
                              )
                            }
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {settingsTab === "styles" && (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{t("stylesTitle")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("stylesDescription")}
                    </p>
                  </div>
                  <Button size="sm" onClick={addStyle}>
                    <PlusIcon />
                    {t("addStyle")}
                  </Button>
                </div>

                {styles.length === 0 && (
                  <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("styleEmpty")}
                  </div>
                )}

                {styles.map((style) => (
                  <div
                    key={style.id}
                    data-style-id={style.id}
                    className="relative grid gap-3 rounded-lg border p-3"
                  >
                    {styleDropTarget?.id === style.id && (
                      <span
                        aria-hidden
                        className={`pointer-events-none absolute right-1 left-1 z-10 h-0.5 rounded-full bg-primary ${
                          styleDropTarget.position === "before"
                            ? "-top-1.5"
                            : "-bottom-1.5"
                        }`}
                      />
                    )}
                    <div className="flex items-center gap-3">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={`shrink-0 touch-none select-none text-muted-foreground ${
                          draggedStyleId === style.id
                            ? "cursor-grabbing"
                            : "cursor-grab"
                        }`}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          draggedStyleIdRef.current = style.id;
                          setDraggedStyleId(style.id);

                          const handleMouseMove = (
                            moveEvent: MouseEvent,
                          ) => {
                            const target = getStyleDropTarget(
                              moveEvent.clientX,
                              moveEvent.clientY,
                            );
                            setStyleDropTarget(
                              target?.id === style.id ? null : target,
                            );
                          };
                          const handleMouseUp = (upEvent: MouseEvent) => {
                            const target = getStyleDropTarget(
                              upEvent.clientX,
                              upEvent.clientY,
                            );
                            if (
                              draggedStyleIdRef.current === style.id &&
                              target &&
                              target.id !== style.id
                            ) {
                              reorderStyle(
                                style.id,
                                target.id,
                                target.position,
                              );
                            }
                            window.removeEventListener(
                              "mousemove",
                              handleMouseMove,
                            );
                            draggedStyleIdRef.current = null;
                            setDraggedStyleId(null);
                            setStyleDropTarget(null);
                          };

                          window.addEventListener(
                            "mousemove",
                            handleMouseMove,
                          );
                          window.addEventListener(
                            "mouseup",
                            handleMouseUp,
                            { once: true },
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            moveStyleByOffset(style.id, -1);
                          } else if (event.key === "ArrowDown") {
                            event.preventDefault();
                            moveStyleByOffset(style.id, 1);
                          }
                        }}
                        aria-label={t("reorderStyle")}
                        aria-keyshortcuts="ArrowUp ArrowDown"
                      >
                        <GripVerticalIcon />
                      </Button>
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        {editingTitle === `style:${style.id}` ? (
                          <Input
                            value={style.name}
                            autoFocus
                            className="h-7 max-w-56"
                            onChange={(event) =>
                              updateStyle(
                                style.id,
                                "name",
                                event.currentTarget.value,
                              )
                            }
                            onBlur={() => setEditingTitle(null)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        ) : (
                          <>
                            <p className="truncate text-sm font-medium">
                              {style.name || t("unnamedStyle")}
                            </p>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                setEditingTitle(`style:${style.id}`)
                              }
                              aria-label={t("editName")}
                            >
                              <PencilIcon />
                            </Button>
                          </>
                        )}
                      </div>
                      <Select
                        value={style.providerId ?? "default"}
                        onValueChange={(value) =>
                          updateStyle(
                            style.id,
                            "providerId",
                            String(value) === "default"
                              ? null
                              : String(value),
                          )
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-44 shrink-0"
                          aria-label={t("styleProvider")}
                        >
                          <SelectValue>
                            {style.providerId
                              ? (providers.find(
                                  (provider) =>
                                    provider.id === style.providerId,
                                )?.name ?? t("defaultProvider"))
                              : t("inheritDefaultProvider")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="end">
                          <SelectItem value="default">
                            {t("inheritDefaultProvider")}
                          </SelectItem>
                          {providers.map((provider) => (
                            <SelectItem
                              key={provider.id}
                              value={provider.id}
                            >
                              {provider.name || t("unnamedProvider")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setStylePendingDelete(style)}
                        aria-label={t("removeStyle")}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>{t("stylePrompt")}</Label>
                      <Textarea
                        value={style.prompt}
                        placeholder={t("stylePromptPlaceholder")}
                        onChange={(event) =>
                          updateStyle(
                            style.id,
                            "prompt",
                            event.currentTarget.value,
                          )
                        }
                        className="min-h-28 resize-y"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {settingsTab === "preferences" && (
              <div className="grid max-w-xl gap-3">
                <div className="order-1 grid grid-cols-[7rem_1fr] items-center gap-3">
                  <Label>{t("interfaceLanguage")}</Label>
                  <Select
                    value={settingsLocale}
                    onValueChange={(value) => {
                      const nextLocale = String(value) as Locale;
                      setSettingsLocale(nextLocale);
                      setLocale(nextLocale);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {localeNativeNames[settingsLocale]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {locales.map((code) => (
                        <SelectItem key={code} value={code}>
                          {localeNativeNames[code]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="order-3 grid grid-cols-[7rem_1fr] items-center gap-3">
                    <Label>{t("theme")}</Label>
                    <div className="grid grid-cols-3 rounded-lg bg-muted p-0.5">
                    {(["auto", "light", "dark"] as Theme[]).map((option) => (
                      <Button
                        key={option}
                        variant="ghost"
                        size="sm"
                        onClick={() => setTheme(option)}
                        className={
                          theme === option
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground"
                        }
                      >
                        {option === "auto" ? (
                          <MonitorIcon />
                        ) : option === "light" ? (
                          <SunIcon />
                        ) : (
                          <MoonIcon />
                        )}
                        {option === "auto"
                          ? t("themeAuto")
                          : option === "light"
                            ? t("themeLight")
                            : t("themeDark")}
                      </Button>
                    ))}
                    </div>
                </div>

                <div className="order-4 grid grid-cols-[7rem_1fr] items-center gap-3">
                    <Label>{t("themeColor")}</Label>
                    <div className="flex gap-2">
                    {(
                      [
                        ["neutral", "bg-zinc-800"],
                        ["blue", "bg-blue-600"],
                        ["green", "bg-green-600"],
                        ["violet", "bg-violet-600"],
                        ["orange", "bg-orange-600"],
                      ] as Array<[ThemeColor, string]>
                    ).map(([color, swatchClass]) => (
                      <Button
                        key={color}
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setThemeColor(color)}
                        aria-label={t(`themeColor${color[0].toUpperCase()}${color.slice(1)}` as TranslationKey)}
                        aria-pressed={themeColor === color}
                        className={
                          themeColor === color
                            ? "ring-2 ring-primary/40"
                            : undefined
                        }
                      >
                        <span
                          className={`flex size-4 items-center justify-center rounded-full ${swatchClass}`}
                        >
                          {themeColor === color && (
                            <CheckIcon className="size-3 text-white" />
                          )}
                        </span>
                      </Button>
                    ))}
                    </div>
                </div>

                <div className="order-5 grid grid-cols-[7rem_1fr] items-center gap-3">
                    <Label>{t("cornerRadius")}</Label>
                    <div className="grid gap-0.5">
                      <Slider
                        min={0}
                        max={4}
                        step={1}
                        value={radiusPresets.indexOf(radius)}
                        onValueChange={(value) =>
                          setRadius(radiusPresets[value] ?? "default")
                        }
                        aria-label={t("cornerRadius")}
                      />
                      <div className="flex justify-between px-1">
                        {radiusPresets.map((preset) => (
                          <span
                            key={preset}
                            className={`size-1 rounded-full ${
                              preset === radius ? "bg-primary" : "bg-border"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                </div>

                <div className="order-2 grid grid-cols-[7rem_1fr] items-center gap-3">
                  <Label>{t("defaultTargetLanguage")}</Label>
                  <LanguageSelect
                    value={settingsTarget}
                    onValueChange={(value) => {
                      const nextTarget = value as LanguageCode;
                      setSettingsTarget(nextTarget);
                      setDefaultTarget(nextTarget);
                      changeTargetLanguage(nextTarget);
                    }}
                    languageName={languageName}
                    triggerClassName="w-full"
                  />
                </div>

                <div className="order-3 grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>{t("languagePairs")}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t("languagePairsDescription")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={addLanguagePair}
                      disabled={languagePairs.length >= LANGUAGE_PAIR_LIMIT}
                    >
                      <PlusIcon />
                      {t("addLanguagePair")}
                    </Button>
                  </div>
                  {languagePairs.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                      {t("languagePairsEmpty")}
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {languagePairs.map((pair) => (
                        <div
                          key={pair.id}
                          className="flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5"
                        >
                          <LanguageSelect
                            value={pair.source}
                            onValueChange={(value) =>
                              updateLanguagePair(
                                pair.id,
                                "source",
                                value as PairLanguageCode,
                              )
                            }
                            languageName={languageName}
                            triggerClassName="min-w-0 flex-1"
                          />
                          <span className="shrink-0 text-muted-foreground">
                            →
                          </span>
                          <LanguageSelect
                            value={pair.target}
                            onValueChange={(value) =>
                              updateLanguagePair(
                                pair.id,
                                "target",
                                value as PairLanguageCode,
                              )
                            }
                            languageName={languageName}
                            triggerClassName="min-w-0 flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeLanguagePair(pair.id)}
                            aria-label={t("removeLanguagePair")}
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="order-6 grid grid-cols-[7rem_1fr] items-center gap-3">
                  <Label>{t("toggleShortcut")}</Label>
                  <div className="flex items-center justify-between gap-3 rounded-lg border px-2 py-1">
                    <ShortcutKeys shortcut={toggleShortcut} />
                    <Button
                      variant={recordingShortcut ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setRecordingShortcut(true)}
                      onBlur={() => setRecordingShortcut(false)}
                      onKeyDown={(event) => {
                        if (!recordingShortcut) return;
                        event.preventDefault();
                        if (event.key === "Escape") {
                          setRecordingShortcut(false);
                          return;
                        }
                        const value = shortcutFromKeyboardEvent(event);
                        if (!value) return;
                        setToggleShortcut(value);
                        setRecordingShortcut(false);
                      }}
                    >
                      {recordingShortcut ? (
                        t("recordingShortcut")
                      ) : (
                        <>
                          <PencilIcon />
                          {t("editShortcut")}
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="order-7 grid grid-cols-[7rem_1fr] items-center gap-3">
                  <Label>{t("closeBehavior")}</Label>
                  <Select
                    value={closeBehavior}
                    onValueChange={(value) => {
                      const nextBehavior = String(value) as CloseBehavior;
                      setCloseBehavior(nextBehavior);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {closeBehavior === "quit"
                          ? t("closeCompletely")
                          : closeToTrayLabel}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="quit">
                        {t("closeCompletely")}
                      </SelectItem>
                      <SelectItem value="tray">{closeToTrayLabel}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="order-8 grid grid-cols-[7rem_1fr] items-center gap-3">
                  <Label htmlFor="launch-at-startup">
                    {t("launchAtStartup")}
                  </Label>
                  <div className="flex items-center">
                    <Switch
                      id="launch-at-startup"
                      checked={autostartEnabled}
                      disabled={!autostartReady || autostartUpdating}
                      onCheckedChange={(checked) =>
                        void updateAutostart(checked)
                      }
                      aria-busy={autostartUpdating}
                    />
                  </div>
                </div>

                <div className="order-9 grid grid-cols-[7rem_1fr] items-center gap-3">
                  <Label>{t("settingsTransfer")}</Label>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={exportSettings}>
                      {t("exportSettings")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => settingsImportRef.current?.click()}
                    >
                      {t("importSettings")}
                    </Button>
                    <Input
                      ref={settingsImportRef}
                      type="file"
                      accept=".toml,application/toml,text/plain"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void importSettings(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {settingsTab === "glossary" && (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{t("glossaryTitle")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("glossaryDescription")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportGlossary}
                    >
                      {t("exportGlossary")}
                    </Button>
                    <div className="group relative">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => glossaryImportRef.current?.click()}
                      >
                        {t("importGlossary")}
                      </Button>
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute right-0 bottom-full z-20 mb-2 w-max max-w-64 rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground opacity-0 shadow-md ring-1 ring-foreground/10 transition-opacity group-hover:opacity-100"
                      >
                        {t("importGlossaryHint")}
                      </div>
                    </div>
                    <Input
                      ref={glossaryImportRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void importGlossary(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg">
                  <div
                    className="grid w-max min-w-max overflow-hidden rounded-lg border"
                    style={{
                      gridTemplateColumns: `repeat(${glossaryLanguages.length}, 9rem) 3.5rem`,
                    }}
                  >
                    {glossaryLanguages.map((language, index) => (
                      <div
                        key={language}
                        className="flex items-center justify-between gap-2 border-r border-b bg-muted/50 px-3 py-2"
                      >
                        <span className="text-xs font-medium">
                          {formatLanguageOption(
                            language,
                            languageName(language),
                          )}
                        </span>
                        {index > 0 && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() =>
                              setGlossaryLanguagePendingDelete(language)
                            }
                            aria-label={t("removeLanguage")}
                          >
                            <Trash2Icon />
                          </Button>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center justify-center border-b bg-muted/50">
                      <Select
                        value={null}
                        onValueChange={(value) => {
                          if (value == null || value === "") return;
                          const next = String(value);
                          if (
                            !languages.includes(next as LanguageCode)
                          ) {
                            return;
                          }
                          addGlossaryLanguage(next as LanguageCode);
                        }}
                      >
                        <SelectTrigger
                          disabled={
                            glossaryLanguages.length === languages.length
                          }
                          aria-label={t("addLanguage")}
                          className="h-8 w-10 min-w-0 border-0 bg-transparent p-0 shadow-none [&>svg:last-child]:hidden"
                        >
                          <SelectValue>
                            <PlusIcon className="mx-auto size-4" />
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="end">
                          {sortedLanguages
                            .filter(
                              (language) =>
                                !glossaryLanguages.includes(language),
                            )
                            .map((language) => (
                              <SelectItem key={language} value={language}>
                                {formatLanguageOption(
                                  language,
                                  languageName(language),
                                )}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {glossary.concepts.map((concept) => (
                      <Fragment key={concept.id}>
                        {glossaryLanguages.map((language) => (
                          <div
                            key={language}
                            className="border-r border-b p-2"
                          >
                            <Input
                              value={
                                concept.terms[language] ?? ""
                              }
                              className="h-7"
                              placeholder={t("termPlaceholder")}
                              onChange={(event) =>
                                updateGlossaryTerm(
                                  concept.id,
                                  language,
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </div>
                        ))}
                        <div className="flex items-center justify-center border-b">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              setGlossaryConceptPendingDelete(concept.id)
                            }
                            aria-label={t("removeConcept")}
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </Fragment>
                    ))}

                    <Button
                      variant="ghost"
                      onClick={addGlossaryConcept}
                      aria-label={t("addConcept")}
                      className="h-auto rounded-none border-r px-3 py-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    >
                      <PlusIcon className="size-4" />
                    </Button>
                    {glossaryLanguages.slice(1).map((language) => (
                      <div key={language} className="border-r" />
                    ))}
                    <div />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
        <Dialog
          open={providerPendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setProviderPendingDelete(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteProviderTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteProviderDescription", {
                  name:
                    providerPendingDelete?.name || t("unnamedProvider"),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setProviderPendingDelete(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (providerPendingDelete) {
                    removeProvider(providerPendingDelete.id);
                  }
                }}
              >
                {t("confirmDelete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={stylePendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setStylePendingDelete(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteStyleTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteStyleDescription", {
                  name: stylePendingDelete?.name || t("unnamedStyle"),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStylePendingDelete(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (stylePendingDelete) {
                    removeStyle(stylePendingDelete.id);
                  }
                }}
              >
                {t("confirmDelete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={glossaryLanguagePendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setGlossaryLanguagePendingDelete(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteLanguageTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteLanguageDescription", {
                  language: glossaryLanguagePendingDelete
                    ? languageName(glossaryLanguagePendingDelete)
                    : "",
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setGlossaryLanguagePendingDelete(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (glossaryLanguagePendingDelete) {
                    removeGlossaryLanguage(glossaryLanguagePendingDelete);
                  }
                }}
              >
                {t("confirmDelete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={glossaryConceptPendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setGlossaryConceptPendingDelete(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteConceptTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteConceptDescription", {
                  name: (() => {
                    const concept = glossary.concepts.find(
                      (item) => item.id === glossaryConceptPendingDelete,
                    );
                    if (!concept) return t("concept");
                    const label =
                      concept.terms[glossaryBaseLanguage]?.trim() ||
                      glossaryLanguages
                        .map((language) => concept.terms[language]?.trim())
                        .find(Boolean);
                    return label || t("concept");
                  })(),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setGlossaryConceptPendingDelete(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (glossaryConceptPendingDelete) {
                    removeGlossaryConcept(glossaryConceptPendingDelete);
                  }
                }}
              >
                {t("confirmDelete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    );
  }

  return (
    <main className="h-svh overflow-hidden bg-card">
      <div className="h-full w-full">
        <section
          ref={mainPanelLayoutRef}
          className="grid h-full overflow-hidden bg-card"
          style={{
            gridTemplateRows: `minmax(${MAIN_PANEL_MIN_HEIGHT}px, ${sourcePanelRatio}fr) auto minmax(${MAIN_PANEL_MIN_HEIGHT}px, ${1 - sourcePanelRatio}fr)`,
          }}
          onPointerMove={handlePanelDividerPointerMove}
          onPointerUp={handlePanelDividerPointerEnd}
          onPointerCancel={handlePanelDividerPointerEnd}
        >
          <div className="grid min-h-0 grid-rows-[auto_1fr]">
            <div className="flex items-center gap-2 px-3 py-2.5 pl-3">
              <div className="flex shrink-0 items-center gap-2">
                <div
                  className="relative grid grid-cols-2 rounded-lg bg-muted p-0.5"
                  role="tablist"
                >
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${
                      workMode === "proofread"
                        ? "translate-x-full"
                        : "translate-x-0"
                    }`}
                  />
                  {(["translate", "proofread"] as WorkMode[]).map((mode) => (
                    <Button
                      key={mode}
                      variant="ghost"
                      size="sm"
                      className={`relative z-10 h-7 bg-transparent px-2.5 transition-colors duration-200 hover:bg-transparent ${
                        workMode === mode
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                      onClick={() => {
                        setWorkMode(mode);
                      }}
                      role="tab"
                      aria-selected={workMode === mode}
                    >
                      {mode === "translate"
                        ? t("translateMode")
                        : t("proofreadMode")}
                    </Button>
                  ))}
                </div>
                <LanguageSelect
                  value={sourceLanguage}
                  onValueChange={changeSourceLanguage}
                  includeAuto
                  autoLabel={t("autoDetect")}
                  autoValueLabel={sourceAutoValueLabel}
                  languageName={languageName}
                  triggerClassName="min-w-0 max-w-64 border-0 bg-transparent shadow-none"
                  languagePairs={
                    workMode === "translate" ? languagePairs : undefined
                  }
                  languagePairsLabel={t("languagePairsHome")}
                  onLanguagePairSelect={applyLanguagePair}
                />
              </div>
              <WindowDragRegion className="flex items-center justify-end pr-1">
                <Badge
                  variant="secondary"
                  className="pointer-events-none select-none font-normal tabular-nums"
                >
                  {APP_NAME} {APP_VERSION}
                </Badge>
              </WindowDragRegion>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant={alwaysOnTop ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => {
                    const nextValue = !alwaysOnTop;
                    setAlwaysOnTop(nextValue);
                  }}
                  aria-label={
                    alwaysOnTop ? t("unpinWindow") : t("pinWindow")
                  }
                  aria-pressed={alwaysOnTop}
                >
                  <PinIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={openSettings}
                  aria-label={t("openSettings")}
                >
                  <Settings2Icon />
                </Button>
                <WindowControls />
              </div>
            </div>
            <Textarea
              value={sourceText}
              onChange={(event) => {
                setSourceText(event.currentTarget.value);
              }}
              placeholder={t("sourcePlaceholder")}
              className="h-full min-h-0 resize-none rounded-none border-0 px-4 py-4 text-base shadow-none focus-visible:ring-0"
              autoFocus
            />
          </div>

          <div
            ref={mainPanelDividerRef}
            className="group relative z-10 h-2 cursor-row-resize touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-dragging={isPanelDividerDragging}
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={Math.round(sourcePanelRatio * 100)}
            tabIndex={0}
            onPointerDown={handlePanelDividerPointerDown}
            onLostPointerCapture={() => {
              activePanelDividerPointerIdRef.current = null;
              setIsPanelDividerDragging(false);
            }}
            onKeyDown={handlePanelDividerKeyDown}
          >
            <Separator
              aria-hidden
              role="presentation"
              className="pointer-events-none absolute top-1/2 transition-colors group-hover:bg-primary/60 group-data-[dragging=true]:bg-primary"
            />
            <Button
              variant="outline"
              size="icon-sm"
              type="button"
              className="transfer-button absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-card p-0 text-primary shadow-xs hover:bg-card"
              data-swappable={canSwapTranslation}
              aria-disabled={!canSwapTranslation}
              aria-label={t("swapSourceAndTranslation")}
              tabIndex={canSwapTranslation ? 0 : -1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={swapSourceAndTranslation}
            >
              <TransferStatusIcon
                className="transfer-status-icon size-4"
                loading={isGenerating}
              />
              <ArrowUpDownIcon className="transfer-swap-icon absolute size-4" />
            </Button>
          </div>

          <div className="grid min-h-0 grid-rows-[auto_1fr] bg-muted/20">
            <div className="flex min-w-0 items-center gap-3 px-4 py-2.5">
              <div className="flex h-8 shrink-0 items-center">
                {workMode === "translate" ? (
                  <LanguageSelect
                    value={targetLanguage}
                    onValueChange={(value) =>
                      changeTargetLanguage(value as LanguageCode)
                    }
                    languageName={languageName}
                    triggerClassName="min-w-0 max-w-40 border-0 bg-transparent pl-0 shadow-none"
                  />
                ) : null}
              </div>
              <div
                className="flex h-7 min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                aria-label={t("selectStyles")}
              >
                  <Button
                    variant={
                      selectedStyleIds.includes("default")
                        ? "secondary"
                        : "ghost"
                    }
                    size="sm"
                    className={
                      selectedStyleIds.includes("default")
                        ? "h-7 shrink-0 gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 text-primary hover:bg-primary/15"
                        : "h-7 shrink-0 gap-1 rounded-full px-2.5 text-muted-foreground"
                    }
                    onClick={() => {
                      setSelectedStyleIds((current) => {
                        const next = current.includes("default")
                          ? current.length > 1
                            ? current.filter((id) => id !== "default")
                            : current
                          : ["default", ...current];
                        if (!isTauri()) {
                          window.localStorage.setItem(
                            SELECTED_STYLES_KEY,
                            JSON.stringify(next),
                          );
                        }
                        return next;
                      });
                    }}
                    aria-pressed={selectedStyleIds.includes("default")}
                  >
                    <CheckIcon
                      className={
                        selectedStyleIds.includes("default")
                          ? "size-3"
                          : "size-3 opacity-0"
                      }
                      aria-hidden
                    />
                    {t("defaultStyle")}
                  </Button>
                  {styles.map((style) => {
                    const checked = selectedStyleIds.includes(style.id);
                    const label = style.name || t("unnamedStyle");
                    return (
                      <Button
                        key={style.id}
                        variant={checked ? "secondary" : "ghost"}
                        size="sm"
                        className={
                          checked
                            ? "h-7 shrink-0 gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 text-primary hover:bg-primary/15"
                            : "h-7 shrink-0 gap-1 rounded-full px-2.5 text-muted-foreground"
                        }
                        onClick={() => toggleSelectedStyle(style.id)}
                        aria-pressed={checked}
                      >
                        <CheckIcon
                          className={
                            checked ? "size-3" : "size-3 opacity-0"
                          }
                          aria-hidden
                        />
                        {label}
                      </Button>
                    );
                  })}
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto">
              <div
                className={
                  translationVersions.length > 1
                    ? "grid gap-2 p-3"
                    : "h-full"
                }
              >
                {translationVersions.map((version) => (
                  <div
                    key={version.id}
                    className={
                      translationVersions.length > 1
                        ? "grid overflow-hidden rounded-lg border bg-card"
                        : "relative"
                    }
                  >
                    {translationVersions.length > 1 && (
                      <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
                        {version.name}
                      </div>
                    )}
                    <div className="relative">
                      {version.error ? (
                        <div className="whitespace-pre-wrap px-4 py-4 pr-24 text-base text-destructive">
                          {version.error}
                        </div>
                      ) : workMode === "proofread" &&
                        version.status === "completed" &&
                        version.proofread ? (
                        <div className="grid gap-3 px-4 py-4 pr-24">
                          {version.proofread.fallbackText ? (
                            <div className="whitespace-pre-wrap text-base md:text-sm">
                              {version.proofread.fallbackText}
                            </div>
                          ) : (
                            <>
                              <section className="grid gap-1.5">
                                <h3>
                                  <Badge
                                    variant="secondary"
                                    className="bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300"
                                  >
                                    {t("proofreadIssuesHeading")}
                                  </Badge>
                                </h3>
                                <div className="whitespace-pre-wrap text-base md:text-sm">
                                  {version.proofread.noIssues
                                    ? t("proofreadNoIssues")
                                    : version.proofread.issuesText || (
                                        <span className="text-muted-foreground">
                                          {t("proofreadNoIssues")}
                                        </span>
                                      )}
                                </div>
                              </section>
                              <section className="grid gap-1.5">
                                <h3>
                                  <Badge
                                    variant="secondary"
                                    className="bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300"
                                  >
                                    {t("proofreadCorrectedHeading")}
                                  </Badge>
                                </h3>
                                <div className="whitespace-pre-wrap text-base md:text-sm">
                                  {version.proofread.correctedText || (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </div>
                              </section>
                              {version.proofread.styleSuggestionsText ? (
                                <section className="grid gap-1.5">
                                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground">
                                    {t("proofreadStyleSuggestionsHeading")}
                                  </h3>
                                  <div className="whitespace-pre-wrap text-base md:text-sm">
                                    {version.proofread.styleSuggestionsText}
                                  </div>
                                </section>
                              ) : null}
                              {version.proofread.polishedText ? (
                                <section className="grid gap-1.5">
                                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground">
                                    {t("proofreadPolishedHeading")}
                                  </h3>
                                  <div className="whitespace-pre-wrap text-base md:text-sm">
                                    {version.proofread.polishedText}
                                  </div>
                                </section>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : version.text ? (
                        <div className="whitespace-pre-wrap px-4 py-4 pr-24 text-base md:text-sm">
                          {version.text}
                        </div>
                      ) : (
                        <div className="px-4 py-4 pr-24 text-base text-muted-foreground md:text-sm">
                          {workMode === "proofread"
                            ? t("proofreadPreview")
                            : t("translationPlaceholder")}
                        </div>
                      )}
                      <div className="absolute top-3 right-4 flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => regenerateResult(version.id)}
                          disabled={
                            isGenerating ||
                            (version.status !== "completed" &&
                              version.status !== "error")
                          }
                          aria-label={
                            workMode === "proofread"
                              ? t("regenerateProofread")
                              : t("regenerateTranslation")
                          }
                        >
                          <RefreshCwIcon />
                        </Button>
                        {speechSupported && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              void toggleSpeech(
                                version.id,
                                version.speakableText ?? "",
                              )
                            }
                            disabled={
                              version.status !== "completed" ||
                              !version.speakableText
                            }
                            aria-label={
                              speakingVariantId === version.id
                                ? t("stopSpeaking")
                                : t("speakTranslation")
                            }
                          >
                            {speakingVariantId === version.id ? (
                              <SquareIcon />
                            ) : (
                              <Volume2Icon />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            void copyTranslation(
                              version.id,
                              version.speakableText ??
                                version.proofread?.correctedText ??
                                version.text,
                            )
                          }
                          disabled={
                            !(
                              version.speakableText ||
                              version.proofread?.correctedText ||
                              version.text
                            )
                          }
                          aria-label={t("copyTranslation")}
                        >
                          {copiedVersionId === version.id ? (
                            <CheckIcon />
                          ) : (
                            <CopyIcon />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}

export default App;
