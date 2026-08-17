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
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check as checkForUpdate,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpDownIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  HouseIcon,
  InfoIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon,
  PlugZapIcon,
  RefreshCwIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SparklesIcon,
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
import { PromptOptimizerDialog } from "@/components/prompt-optimizer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorPicker } from "@/components/ui/color-picker";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  isLocale,
  localeNativeNames,
  locales,
  useI18n,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";
import {
  DEFAULT_CUSTOM_THEME_COLOR,
  isCustomThemeColor,
  isThemeColor,
  useTheme,
  type RadiusPreset,
  type Theme,
  type ThemeColor,
  type ThemeColorPreset,
} from "@/lib/theme";
import {
  downloadText,
  serializeGlossary,
} from "@/lib/transfer";
import { APP_AUTHOR, APP_NAME, APP_VERSION } from "@/lib/app-meta";
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
  askResultQuestion,
  cancelGeneration,
  createGenerationChannel,
  deleteProviderApiKey,
  exportBackendGlossaryToFile,
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
import {
  loadModelsDevProviders,
  type ModelOption,
  type ModelsDevProvider,
} from "@/lib/models-dev";
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
const SKIPPED_UPDATE_VERSION_KEY = "translator.skippedUpdateVersion";
const TRALI_HOMEPAGE_URL = "https://trali.net";
const TRALI_GITHUB_URL = "https://github.com/StereoApp/trali";
const DEFAULT_TOGGLE_SHORTCUT = "";
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

function GithubBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.834 2.809 1.304 3.495.997.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.292-1.552 3.297-1.23 3.297-1.23.647 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.575C20.565 22.092 24 17.595 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

async function openExternalUrl(url: string) {
  try {
    if (isTauri()) {
      await openUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // Keep the about page usable when the system browser is unavailable.
  }
}

type SettingsTab =
  | "provider"
  | "styles"
  | "glossary"
  | "preferences"
  | "about";
type UpdateCheckState =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "installing"
  | "error";
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

type GenerationCacheEntry = {
  results: Record<
    string,
    {
      contextKey: string;
      result: GenerationResult;
    }
  >;
};

type GenerationCache = Record<WorkMode, GenerationCacheEntry>;

function isReusableGenerationResult(
  result: GenerationResult | undefined,
): boolean {
  return (
    result != null &&
    result.status === "completed" &&
    result.text.trim().length > 0
  );
}

function invokeErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

type AskSlot = {
  question: string;
  submittedQuestion: string;
  answer: string | null;
  error: string | null;
  status: "idle" | "asking";
};

function emptyAskSlot(): AskSlot {
  return {
    question: "",
    submittedQuestion: "",
    answer: null,
    error: null,
    status: "idle",
  };
}

type ResultQuestionAskProps = {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: () => void;
  asking: boolean;
  submittedQuestion: string;
  answer: string | null;
  error: string | null;
  placeholder: string;
  sendLabel: string;
  askingLabel: string;
  questionLabel: string;
  answerLabel: string;
  onUseAsTranslation?: () => void;
  useAsTranslationLabel?: string;
};

function ResultQuestionAsk({
  question,
  onQuestionChange,
  onSubmit,
  asking,
  submittedQuestion,
  answer,
  error,
  placeholder,
  sendLabel,
  askingLabel,
  questionLabel,
  answerLabel,
  onUseAsTranslation,
  useAsTranslationLabel,
}: ResultQuestionAskProps) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (
      event.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      !event.repeat
    ) {
      event.preventDefault();
      onSubmit();
    }
  }

  const showPair =
    submittedQuestion.length > 0 &&
    !asking &&
    (answer != null || error != null);
  const showUseAsTranslation =
    onUseAsTranslation != null &&
    !asking &&
    error == null &&
    answer != null &&
    answer.trim().length > 0;

  return (
    <div className="border-t border-border/70 px-4 pb-3 pt-2">
      <div className="grid gap-2 rounded-lg bg-muted/50 p-2.5">
        {showPair ? (
          <div className="grid gap-1.5">
            <div className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                {questionLabel}
              </span>
              <p className="min-w-0 text-sm whitespace-pre-wrap text-foreground">
                {submittedQuestion}
              </p>
            </div>
            <div className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                {answerLabel}
              </span>
              {error ? (
                <p className="min-w-0 text-sm text-destructive/80">{error}</p>
              ) : (
                <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap text-foreground">
                  {answer}
                </p>
              )}
              {showUseAsTranslation ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0 self-start"
                  onClick={onUseAsTranslation}
                >
                  {useAsTranslationLabel}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <Input
            value={question}
            onChange={(event) =>
              onQuestionChange(event.currentTarget.value)
            }
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            className="h-7 border-0 bg-transparent px-1.5 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            variant="ghost"
            size="xs"
            onClick={onSubmit}
            disabled={asking || question.trim().length === 0}
          >
            {asking ? (
              <>
                <Loader2Icon className="animate-spin" />
                {askingLabel}
              </>
            ) : (
              sendLabel
            )}
          </Button>
        </div>
      </div>
    </div>
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

type ProviderSetupEmptyStateProps = {
  onOpenSettings: () => void;
};

function ProviderSetupEmptyState({
  onOpenSettings,
}: ProviderSetupEmptyStateProps) {
  const { t } = useI18n();
  const steps = [
    {
      icon: PlugZapIcon,
      title: t("providerSetupStep1Title"),
      description: t("providerSetupStep1Description"),
    },
    {
      icon: KeyRoundIcon,
      title: t("providerSetupStep2Title"),
      description: t("providerSetupStep2Description"),
    },
    {
      icon: Settings2Icon,
      title: t("providerSetupStep3Title"),
      description: t("providerSetupStep3Description"),
    },
  ];

  return (
    <section
      className="relative min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-4 sm:px-6 sm:py-5"
      aria-labelledby="provider-setup-title"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 right-[12%] size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 left-[8%] size-64 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-3xl items-center justify-center">
        <div className="w-full overflow-hidden rounded-2xl border bg-card shadow-lg shadow-primary/5 ring-1 ring-foreground/5">
          <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
            <div className="relative p-5 sm:p-7">
              <div className="mb-4 flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                  <SparklesIcon className="size-4" />
                </div>
                <Badge variant="secondary">
                  {t("providerSetupEyebrow")}
                </Badge>
              </div>

              <h1
                id="provider-setup-title"
                className="max-w-xl text-xl font-semibold tracking-tight sm:text-2xl"
              >
                {t("providerSetupTitle")}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-5 text-muted-foreground">
                {t("providerSetupDescription")}
              </p>

              <Button
                size="lg"
                className="mt-5 gap-2 rounded-full px-4 shadow-md shadow-primary/15"
                onClick={onOpenSettings}
              >
                {t("providerSetupAction")}
                <ArrowRightIcon className="size-4" />
              </Button>

              <div className="mt-4 flex max-w-xl items-start gap-2 text-xs leading-4 text-muted-foreground">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{t("providerSetupSecureNote")}</span>
              </div>
            </div>

            <div className="border-t bg-muted/30 p-5 sm:p-6 lg:border-t-0 lg:border-l">
              <p className="text-sm font-semibold">
                {t("providerSetupWhyTitle")}
              </p>
              <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                {t("providerSetupWhyDescription")}
              </p>

              <div className="mt-5 border-t pt-4">
                <p className="text-sm font-semibold">
                  {t("providerSetupStepsTitle")}
                </p>
                <div className="mt-4 grid gap-3.5">
                  {steps.map((step, index) => {
                    const StepIcon = step.icon;
                    return (
                      <div key={step.title} className="flex gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background text-primary shadow-sm ring-1 ring-foreground/10">
                          <StepIcon className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            <span className="mr-1.5 text-xs text-muted-foreground">
                              0{index + 1}
                            </span>
                            {step.title}
                          </p>
                          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
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
  const [mountGlossary, setMountGlossary] = useState(true);
  const [transcreationByStyleId, setTranscreationByStyleId] = useState<
    Record<string, boolean>
  >({});
  const [fetchingProviderId, setFetchingProviderId] = useState<string | null>(
    null,
  );
  const [providerModels, setProviderModels] = useState<
    Record<string, ModelOption[]>
  >({});
  const [modelsDevProviders, setModelsDevProviders] = useState<
    ModelsDevProvider[]
  >([]);
  const [providerSearch, setProviderSearch] = useState("");
  const [modelsDevLoading, setModelsDevLoading] = useState(false);
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
  const [stylePromptOptimizerId, setStylePromptOptimizerId] = useState<
    string | null
  >(null);
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
  const [fillClipboardOnShortcut, setFillClipboardOnShortcut] = useState(false);
  const fillClipboardOnShortcutRef = useRef(false);
  fillClipboardOnShortcutRef.current = fillClipboardOnShortcut;
  const [copyResultOnComplete, setCopyResultOnComplete] = useState(false);
  const copyResultOnCompleteRef = useRef(false);
  copyResultOnCompleteRef.current = copyResultOnComplete;
  const copiedResultRequestIdsRef = useRef(new Set<string>());
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const windowExpandedRef = useRef(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartReady, setAutostartReady] = useState(false);
  const [autostartUpdating, setAutostartUpdating] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateCheckState, setUpdateCheckState] =
    useState<UpdateCheckState>("idle");
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const updateCheckInFlightRef = useRef(false);
  const [backendReady, setBackendReady] = useState(false);
  const [generationResults, setGenerationResults] = useState<
    Record<string, GenerationResult>
  >({});
  const generationResultsRef = useRef(generationResults);
  generationResultsRef.current = generationResults;
  const generationCacheRef = useRef<GenerationCache>({
    translate: { results: {} },
    proofread: { results: {} },
  });
  const [generationRefreshNonce, setGenerationRefreshNonce] = useState(0);
  const [askByVersion, setAskByVersion] = useState<Record<string, AskSlot>>({});
  const askByVersionRef = useRef(askByVersion);
  askByVersionRef.current = askByVersion;
  const askRequestIdByVersionRef = useRef<Record<string, string>>({});
  const lastCompletedTextByVersionRef = useRef<Record<string, string>>({});
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
  const [disabledSwapClickCount, setDisabledSwapClickCount] = useState(0);

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
  const hasGlossaryTerms = glossary.concepts.some((concept) =>
    Object.values(concept.terms).some((term) => term.trim().length > 0),
  );
  const glossaryHint = t("addGlossaryTerm", { settings: "__settings__" });
  const [glossaryHintBefore, glossaryHintAfter] =
    glossaryHint.split("__settings__");
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
  const askContextKey = [
    sourceText,
    sourceLanguage,
    detectedLanguage ?? "",
    targetLanguage,
    workMode,
    selectedStyleIds.join("\0"),
  ].join("\u001f");
  const askVersionSnapshotKey = translationVersions
    .map((version) =>
      [
        version.id,
        version.status === "completed" && version.text.trim().length > 0
          ? version.text
          : "",
      ].join("\0"),
    )
    .join("\u001f");
  const hasResolvedSourceLanguage =
    sourceLanguage !== "auto" || detectedLanguage !== null;
  const canSwapTranslation =
    !isGenerating && swapVersion !== undefined && hasResolvedSourceLanguage;

  useEffect(() => {
    if (canSwapTranslation) {
      setDisabledSwapClickCount(0);
    }
  }, [canSwapTranslation]);

  useEffect(() => {
    const requestIds = Object.values(askRequestIdByVersionRef.current);
    askRequestIdByVersionRef.current = {};
    lastCompletedTextByVersionRef.current = {};
    for (const requestId of requestIds) {
      void cancelGeneration(requestId).catch(() => {});
    }
    setAskByVersion({});
  }, [askContextKey]);

  const translationVersionsRef = useRef(translationVersions);
  translationVersionsRef.current = translationVersions;

  useEffect(() => {
    const versions = translationVersionsRef.current;
    const lastTexts = lastCompletedTextByVersionRef.current;
    const currentIds = new Set(versions.map((version) => version.id));
    const idsToClear = new Set<string>();

    for (const id of new Set([
      ...Object.keys(lastTexts),
      ...Object.keys(askRequestIdByVersionRef.current),
      ...Object.keys(askByVersionRef.current),
    ])) {
      if (!currentIds.has(id)) {
        idsToClear.add(id);
        delete lastTexts[id];
      }
    }

    for (const version of versions) {
      if (version.status === "completed" && version.text.trim().length > 0) {
        const previous = lastTexts[version.id];
        if (previous !== undefined && previous !== version.text) {
          idsToClear.add(version.id);
        }
        lastTexts[version.id] = version.text;
      }
    }

    if (idsToClear.size === 0) return;

    for (const id of idsToClear) {
      const requestId = askRequestIdByVersionRef.current[id];
      if (requestId) {
        delete askRequestIdByVersionRef.current[id];
        void cancelGeneration(requestId).catch(() => {});
      }
    }

    setAskByVersion((current) => {
      let changed = false;
      const next = { ...current };
      for (const id of idsToClear) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [askVersionSnapshotKey]);

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
    if (!backendReady) return;
    if (providers.length === 0) {
      setSettingsTab("provider");
      setStylePromptOptimizerId(null);
      setSettingsOpen(true);
    }
    // Only on first backend snapshot: later closes must stay closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendReady]);

  useEffect(() => {
    if (!settingsOpen || settingsTab !== "provider") return;

    let cancelled = false;
    setProviderSearch("");
    setModelsDevLoading(true);
    void loadModelsDevProviders()
      .then((providers) => {
        if (!cancelled) setModelsDevProviders(providers);
      })
      .catch(() => {
        // The provider's own /models endpoint remains available as a fallback.
      })
      .finally(() => {
        if (!cancelled) setModelsDevLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    if (!backendReady || !autoCheckUpdates || !isTauri()) return;
    void checkForUpdates();
    // The check should run when the persisted preference is ready or changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckUpdates, backendReady]);

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
    copyResultOnComplete,
    fillClipboardOnShortcut,
    defaultProviderId,
    defaultTarget,
    languagePairs,
    locale,
    autoCheckUpdates,
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
    let unlistenShown: (() => void) | undefined;
    void listen("main-window-shown", () => {
      if (providersRef.current.length === 0) {
        setSettingsTab("provider");
        setStylePromptOptimizerId(null);
        setSettingsOpen(true);
      }
    }).then((dispose) => {
      unlistenShown = dispose;
    });
    return () => {
      unlisten?.();
      unlistenShown?.();
      void stopSpeech().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const syncExpandedState = async () => {
      const [fullscreen, maximized] = await Promise.all([
        appWindow.isFullscreen(),
        appWindow.isMaximized(),
      ]);
      const expanded = fullscreen || maximized;
      if (cancelled) return;

      if (expanded && !windowExpandedRef.current) {
        windowExpandedRef.current = true;
        setAlwaysOnTop(false);
      } else if (!expanded) {
        windowExpandedRef.current = false;
      }
    };

    void syncExpandedState();
    void appWindow
      .onResized(() => {
        void syncExpandedState();
      })
      .then((dispose) => {
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      });

    return () => {
      cancelled = true;
      unlisten?.();
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
        .then(() => {
          if (!toggleShortcut.trim()) return;
          return register(toggleShortcut, (event) => {
            if (event.state === "Pressed") {
              void (async () => {
                let willShow = true;
                try {
                  const win = getCurrentWindow();
                  const [visible, minimized] = await Promise.all([
                    win.isVisible(),
                    win.isMinimized(),
                  ]);
                  willShow = !visible || minimized;
                } catch {
                  willShow = true;
                }
                await invoke("toggle_window");
                if (!willShow) return;
                if (providersRef.current.length === 0) {
                  setSettingsTab("provider");
                  setStylePromptOptimizerId(null);
                  setSettingsOpen(true);
                  return;
                }
                if (!fillClipboardOnShortcutRef.current) return;
                try {
                  const { readText } = await import(
                    "@tauri-apps/plugin-clipboard-manager"
                  );
                  const text = await readText();
                  if (typeof text !== "string" || text.length === 0) return;
                  setSourceText(text);
                  window.setTimeout(() => {
                    const input = sourceInputRef.current;
                    if (!input) return;
                    input.focus();
                    input.select();
                  }, 0);
                } catch {
                  // Empty, denied, or non-text clipboard — leave the input unchanged.
                }
              })();
            }
          });
        })
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
    const includeGlossary = workMode === "proofread" || mountGlossary;
    const baseContextKey = JSON.stringify({
      text,
      workMode,
      sourceLanguage: resolvedSourceLanguage,
      targetLanguage,
      includeGlossary,
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
    const transcreationContext = selectedStyleIds.map((id) => [
      id,
      id !== "default" && transcreationByStyleId[id] === true,
    ]);
    const contextKey = JSON.stringify({
      baseContextKey,
      transcreationContext,
    });
    const variantContextKeys: Record<string, string> = Object.fromEntries(
      selectedStyleIds.map((id) => [
        id,
        JSON.stringify({
          baseContextKey,
          id,
          transcreation:
            id !== "default" && transcreationByStyleId[id] === true,
        }),
      ]),
    );

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
      copiedResultRequestIdsRef.current.clear();
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
    const modeCache = generationCacheRef.current[workMode];
    const cachedResultsForContext: Record<string, GenerationResult> =
      Object.fromEntries(
        selectedStyleIds.flatMap((id) => {
          const cached = modeCache.results[id];
          return cached?.contextKey === variantContextKeys[id] &&
            isReusableGenerationResult(cached.result)
            ? [[id, cached.result] as const]
            : [];
        }),
      );

    // Content/settings changed: drop in-flight work. Completed results whose
    // individual context is unchanged remain reusable. When switching modes,
    // restore completed results for the unchanged variant contexts.
    if (contextChanged) {
      cancelAllGenerations();
      setGenerationResults((current) => {
        return Object.fromEntries(
          selectedStyleIds.map((id) => [
            id,
            cachedResultsForContext[id] ??
              (isReusableGenerationResult(current[id]) &&
              modeCache.results[id]?.contextKey === variantContextKeys[id]
                ? current[id]
                : { text: "", status: "idle" as const }),
          ]),
        );
      });
    }

    const timeout = window.setTimeout(() => {
      const cached = generationResultsRef.current;
      const resultsForContext = contextChanged
        ? cachedResultsForContext
        : cached;
      const idsToGenerate = selectedStyleIds.filter(
        (id) => !isReusableGenerationResult(resultsForContext[id]),
      );

      if (idsToGenerate.length === 0) {
        if (contextChanged) {
          setGenerationResults((current) =>
            Object.fromEntries(
              selectedStyleIds.map((id) => [
                id,
                resultsForContext[id] ??
                  current[id] ?? { text: "", status: "idle" as const },
              ]),
            ),
          );
        }
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
                : resultsForContext[id] ??
                  current[id] ?? { text: "", status: "idle" as const },
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
      copiedResultRequestIdsRef.current.clear();
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
            let result: GenerationResult;
            if (workMode === "proofread") {
              const normalized = normalizeProofreadOutput(previous.text, {
                hasStyle: event.variantId !== "default",
                sourceText: text,
                emptyResult: t("proofreadEmptyResult"),
                unexpectedFormat: t("proofreadUnexpectedFormat"),
              });
              result = {
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
              };
            } else {
              result = {
                ...previous,
                status: "completed",
                speakableText: event.speakableText ?? undefined,
              };
            }
            if (copyResultOnCompleteRef.current) {
              const alreadyWritten = copiedResultRequestIdsRef.current.has(
                event.requestId,
              );
              const defaultInRun = selectedStyleIds.includes("default");
              const isMainVariant = defaultInRun
                ? event.variantId === "default"
                : idsToGenerate.includes(event.variantId);
              const plainText = result.text.trim();
              if (!alreadyWritten && isMainVariant && plainText) {
                copiedResultRequestIdsRef.current.add(event.requestId);
                void import("@tauri-apps/plugin-clipboard-manager")
                  .then(({ writeText }) => writeText(plainText))
                  .catch(() => {
                    // Denied or unavailable — leave clipboard unchanged.
                  });
              }
            }
            const currentCache = generationCacheRef.current[workMode];
            generationCacheRef.current[workMode] = {
              results: {
                ...currentCache.results,
                [event.variantId]: {
                  contextKey: variantContextKeys[event.variantId],
                  result,
                },
              },
            };
            return {
              ...current,
              [event.variantId]: result,
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
          includeGlossary,
          variants: idsToGenerate.map((id) => ({
            id,
            styleId: id === "default" ? null : id,
            transcreation:
              workMode === "translate" &&
              id !== "default" &&
              transcreationByStyleId[id] === true,
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
    mountGlossary,
    transcreationByStyleId,
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
      fillClipboardOnShortcut,
      copyResultOnComplete,
      autoCheckUpdates,
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
    const nextThemeColor: ThemeColor = isThemeColor(settings.themeColor)
      ? settings.themeColor
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
    setFillClipboardOnShortcut(Boolean(settings.fillClipboardOnShortcut));
    setCopyResultOnComplete(Boolean(settings.copyResultOnComplete));
    setAutoCheckUpdates(settings.autoCheckUpdates !== false);
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
    setStylePromptOptimizerId(null);
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

  function getModelsDevProvider(provider: ProviderConfig) {
    return modelsDevProviders.find(
      (candidate) =>
        candidate.name === provider.name &&
        candidate.endpoint === provider.endpoint,
    );
  }

  function applyModelsDevProvider(providerId: string, providerCatalogId: string) {
    const catalogProvider = modelsDevProviders.find(
      (provider) => provider.id === providerCatalogId,
    );
    if (!catalogProvider) return;

    setProviderConnectionStatus((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    setProviderModels((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    saveProviders(
      providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              name: catalogProvider.name,
              type: catalogProvider.type,
              endpoint: catalogProvider.endpoint,
            }
          : provider,
      ),
    );
    setProviderSearch("");
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
        [provider.id]: models.map((model) => ({ id: model, name: model })),
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

  function getProviderModelOptions(provider: ProviderConfig) {
    const fetchedModels = providerModels[provider.id];
    if (fetchedModels) return fetchedModels;

    return getModelsDevProvider(provider)?.models;
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
      languages: [...languages],
      concepts: glossary.concepts,
    };
    const csv = serializeGlossary(
      normalized.languages,
      normalized.concepts.map((concept) => concept.terms),
    );
    if (isTauri()) {
      const path = await exportBackendGlossaryToFile(normalized);
      await revealItemInDir(path);
      return;
    }
    downloadText("glossary.csv", csv, "text/csv;charset=utf-8");
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

  function toggleTranscreation(styleId: string) {
    if (styleId === "default") return;
    setTranscreationByStyleId((current) => ({
      ...current,
      [styleId]: current[styleId] !== true,
    }));
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

  function patchAskSlot(versionId: string, patch: Partial<AskSlot>) {
    setAskByVersion((current) => ({
      ...current,
      [versionId]: {
        ...(current[versionId] ?? emptyAskSlot()),
        ...patch,
      },
    }));
  }

  function submitResultQuestion(versionId: string) {
    const slot = askByVersionRef.current[versionId] ?? emptyAskSlot();
    const question = slot.question.trim();
    const version = translationVersions.find(
      (candidate) => candidate.id === versionId,
    );
    if (
      !question ||
      slot.status === "asking" ||
      version == null ||
      version.status !== "completed" ||
      version.text.trim().length === 0 ||
      !isTauri()
    ) {
      return;
    }

    const requestId = window.crypto.randomUUID();
    const previousRequestId = askRequestIdByVersionRef.current[versionId];
    if (previousRequestId) {
      void cancelGeneration(previousRequestId).catch(() => {});
    }
    askRequestIdByVersionRef.current[versionId] = requestId;
    patchAskSlot(versionId, {
      question: "",
      submittedQuestion: question,
      answer: null,
      error: null,
      status: "asking",
    });

    void askResultQuestion({
      requestId,
      sourceText,
      resultText: version.text,
      question,
      interfaceLanguage: locale,
    })
      .then((answer) => {
        if (askRequestIdByVersionRef.current[versionId] !== requestId) return;
        const trimmed = answer.trim();
        if (!trimmed) {
          patchAskSlot(versionId, {
            answer: null,
            error: "provider returned an empty response",
            status: "idle",
          });
          return;
        }
        patchAskSlot(versionId, {
          answer: trimmed,
          error: null,
          status: "idle",
        });
      })
      .catch((error: unknown) => {
        if (askRequestIdByVersionRef.current[versionId] !== requestId) return;
        const message = invokeErrorMessage(error);
        if (message === "generation cancelled") {
          patchAskSlot(versionId, { status: "idle" });
          return;
        }
        patchAskSlot(versionId, {
          answer: null,
          error: message,
          status: "idle",
        });
      })
      .finally(() => {
        if (askRequestIdByVersionRef.current[versionId] === requestId) {
          delete askRequestIdByVersionRef.current[versionId];
        }
      });
  }

  function applyAskAnswerAsTranslation(versionId: string) {
    const slot = askByVersionRef.current[versionId] ?? emptyAskSlot();
    const answer = slot.answer?.trim() ?? "";
    if (!answer || slot.error || slot.status === "asking") {
      return;
    }

    const version = translationVersions.find(
      (candidate) => candidate.id === versionId,
    );
    if (
      version == null ||
      version.status !== "completed" ||
      version.text.trim().length === 0
    ) {
      return;
    }

    const nextResult: GenerationResult = {
      status: "completed",
      text: answer,
      speakableText: answer,
    };

    setGenerationResults((current) => ({
      ...current,
      [versionId]: nextResult,
    }));

    const currentCache = generationCacheRef.current[workMode];
    const existingContextKey = currentCache.results[versionId]?.contextKey;
    const contextKey =
      existingContextKey ??
      (() => {
        const text = sourceText.trim();
        const resolvedSourceLanguage =
          sourceLanguage === "auto"
            ? (detectedLanguage ?? "auto")
            : sourceLanguage;
        const includeGlossary = workMode === "proofread" || mountGlossary;
        const baseContextKey = JSON.stringify({
          text,
          workMode,
          sourceLanguage: resolvedSourceLanguage,
          targetLanguage,
          includeGlossary,
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
        return JSON.stringify({
          baseContextKey,
          id: versionId,
          transcreation:
            versionId !== "default" &&
            transcreationByStyleId[versionId] === true,
        });
      })();
    generationCacheRef.current[workMode] = {
      results: {
        ...currentCache.results,
        [versionId]: {
          contextKey,
          result: nextResult,
        },
      },
    };

    const requestId = askRequestIdByVersionRef.current[versionId];
    if (requestId) {
      delete askRequestIdByVersionRef.current[versionId];
      void cancelGeneration(requestId).catch(() => {});
    }
    setAskByVersion((current) => {
      if (!(versionId in current)) return current;
      const next = { ...current };
      delete next[versionId];
      return next;
    });
  }

  async function copyTranslation(versionId: string, text: string) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedVersionId(versionId);
    window.setTimeout(() => setCopiedVersionId(null), 1500);
  }

  function regenerateResult(versionId: string) {
    if (isGenerating) return;
    const currentCache = generationCacheRef.current[workMode];
    const nextCachedResults = { ...currentCache.results };
    delete nextCachedResults[versionId];
    generationCacheRef.current[workMode] = {
      results: nextCachedResults,
    };
    setGenerationResults((current) => ({
      ...current,
      [versionId]: { text: "", status: "idle" },
    }));
    setGenerationRefreshNonce((current) => current + 1);
  }

  async function checkForUpdates(options?: {
    openDialog?: boolean;
    respectSkippedVersion?: boolean;
  }) {
    if (
      !isTauri() ||
      updateCheckState === "checking" ||
      updateCheckState === "installing" ||
      updateCheckInFlightRef.current
    ) {
      return;
    }

    const openDialog = options?.openDialog ?? false;
    const respectSkippedVersion = options?.respectSkippedVersion ?? true;
    updateCheckInFlightRef.current = true;
    setUpdateCheckState("checking");
    setUpdateProgress(null);

    try {
      const update = await checkForUpdate({ timeout: 30_000 });
      if (!update) {
        setAvailableUpdate(null);
        setUpdateCheckState("up-to-date");
        return;
      }

      const skippedVersion = window.localStorage.getItem(
        SKIPPED_UPDATE_VERSION_KEY,
      );
      if (respectSkippedVersion && skippedVersion === update.version) {
        await update.close().catch(() => {});
        setAvailableUpdate(null);
        setUpdateCheckState("idle");
        return;
      }

      if (availableUpdate && availableUpdate !== update) {
        await availableUpdate.close().catch(() => {});
      }
      setAvailableUpdate(update);
      setUpdateCheckState("available");
      if (openDialog) setUpdateDialogOpen(true);
    } catch {
      setUpdateCheckState("error");
    } finally {
      updateCheckInFlightRef.current = false;
    }
  }

  async function installAvailableUpdate() {
    if (!availableUpdate) return;

    setUpdateCheckState("installing");
    setUpdateProgress(0);
    let downloadedBytes = 0;
    let contentLength: number | null = null;

    try {
      await availableUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? null;
          setUpdateProgress(contentLength === 0 ? 0 : null);
          return;
        }
        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (contentLength && contentLength > 0) {
            setUpdateProgress(
              Math.min(100, Math.round((downloadedBytes / contentLength) * 100)),
            );
          }
          return;
        }
        setUpdateProgress(100);
      });
      await relaunch();
    } catch {
      setUpdateCheckState("error");
      setUpdateProgress(null);
    }
  }

  async function skipAvailableUpdate() {
    if (!availableUpdate) return;

    window.localStorage.setItem(
      SKIPPED_UPDATE_VERSION_KEY,
      availableUpdate.version,
    );
    await availableUpdate.close().catch(() => {});
    setAvailableUpdate(null);
    setUpdateDialogOpen(false);
    setUpdateCheckState("idle");
    setUpdateProgress(null);
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

  function handleSwapButtonClick() {
    if (!canSwapTranslation) {
      setDisabledSwapClickCount((count) => Math.min(count + 1, 5));
      return;
    }

    swapSourceAndTranslation();
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

  const normalizedProviderSearch = providerSearch.trim().toLocaleLowerCase();
  const filteredModelsDevProviders = modelsDevProviders.filter((provider) => {
    if (!normalizedProviderSearch) return true;
    return `${provider.name} ${provider.id}`
      .toLocaleLowerCase()
      .includes(normalizedProviderSearch);
  });
  const hasConfiguredProvider = providers.length > 0;
  const stylePromptOptimizerTarget = styles.find(
    (style) => style.id === stylePromptOptimizerId,
  );

  if (settingsOpen) {
    const tabs: Array<{ value: SettingsTab; label: string }> = [
      { value: "provider", label: t("settingsTabProvider") },
      { value: "styles", label: t("settingsTabStyles") },
      { value: "glossary", label: t("settingsTabGlossary") },
      { value: "preferences", label: t("settingsTabPreferences") },
      { value: "about", label: t("settingsTabAbout") },
    ];
    const settingsTabIndex = tabs.findIndex(
      (tab) => tab.value === settingsTab,
    );

    return (
      <main className="flex h-svh flex-col overflow-hidden bg-muted/30">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-3 py-2 sm:px-4">
          <header className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStylePromptOptimizerId(null);
                setSettingsOpen(false);
              }}
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
            className="relative mt-2 grid w-fit shrink-0 grid-cols-5 rounded-md bg-muted p-0.5"
            role="tablist"
            aria-label={t("settingsSections")}
          >
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(20%-1px)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${
                settingsTabIndex === 1
                  ? "translate-x-full"
                  : settingsTabIndex === 2
                    ? "translate-x-[200%]"
                    : settingsTabIndex === 3
                      ? "translate-x-[300%]"
                      : settingsTabIndex === 4
                        ? "translate-x-[400%]"
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
            className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card p-4"
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
                      <div className="grid gap-1.5 sm:col-span-2">
                        <Label>{t("providerPreset")}</Label>
                        <Select
                          value={getModelsDevProvider(provider)?.id ?? "custom"}
                          onValueChange={(value) =>
                            applyModelsDevProvider(provider.id, String(value))
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {getModelsDevProvider(provider)?.name ??
                                t("providerCustom")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent align="start" alignItemWithTrigger={false}>
                            <Input
                              value={providerSearch}
                              placeholder={t("providerSearch")}
                              aria-label={t("providerSearch")}
                              className="mx-1 mb-1 w-[calc(100%-0.5rem)]"
                              onPointerDown={(event) =>
                                event.stopPropagation()
                              }
                              onKeyDown={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                setProviderSearch(event.currentTarget.value)
                              }
                            />
                            <SelectItem value="custom">
                              {t("providerCustom")}
                            </SelectItem>
                            <SelectSeparator />
                            {filteredModelsDevProviders.map((catalogProvider) => (
                              <SelectItem
                                key={catalogProvider.id}
                                value={catalogProvider.id}
                              >
                                {catalogProvider.name}
                              </SelectItem>
                            ))}
                            {!modelsDevLoading &&
                              filteredModelsDevProviders.length === 0 && (
                                <div className="px-1.5 py-2 text-sm text-muted-foreground">
                                  {t("providerNoMatches")}
                                </div>
                              )}
                          </SelectContent>
                        </Select>
                      </div>
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
                          <div className="flex items-center gap-2">
                            <Label>{t("providerModel")}</Label>
                            {modelsDevLoading && (
                              <span className="text-xs text-muted-foreground">
                                models.dev…
                              </span>
                            )}
                          </div>
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
                        {getProviderModelOptions(provider)?.length ? (
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
                              {getProviderModelOptions(provider)?.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                  {model.name === model.id
                                    ? model.id
                                    : `${model.name} · ${model.id}`}
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
                      <div className="flex items-center justify-between gap-2">
                        <Label>{t("stylePrompt")}</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setStylePromptOptimizerId(style.id)
                                  }
                                  disabled={
                                    style.providerId === null &&
                                    defaultProviderId === null
                                  }
                                />
                              }
                            >
                              <SparklesIcon />
                              {t("styleOptimizeButton")}
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("styleOptimizeTokenHint")}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
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
              <div className="grid w-full gap-3">
                <div className="order-1 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
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

                <div className="order-3 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
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

                <div className="order-4 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
                    <Label>{t("themeColor")}</Label>
                    <div className="flex gap-2">
                    {(
                      [
                        ["neutral", "bg-zinc-800"],
                        ["blue", "bg-blue-600"],
                        ["green", "bg-green-600"],
                        ["violet", "bg-violet-600"],
                        ["orange", "bg-orange-600"],
                      ] as Array<[ThemeColorPreset, string]>
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
                    <ColorPicker
                      value={
                        isCustomThemeColor(themeColor)
                          ? themeColor
                          : DEFAULT_CUSTOM_THEME_COLOR
                      }
                      onChange={(value) => {
                        if (isCustomThemeColor(value)) setThemeColor(value);
                      }}
                      label={t("themeColorCustom")}
                    />
                    </div>
                </div>

                <div className="order-5 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
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

                <div className="order-2 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
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

                <div className="order-6 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
                  <Label>{t("toggleShortcut")}</Label>
                  <div className="flex items-center justify-between gap-3 rounded-lg border px-2 py-1">
                    {toggleShortcut ? (
                      <ShortcutKeys shortcut={toggleShortcut} />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {t("shortcutNotSet")}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
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
                      {toggleShortcut ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setToggleShortcut("");
                            setRecordingShortcut(false);
                          }}
                          aria-label={t("clearShortcut")}
                        >
                          <Trash2Icon />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="order-7 grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-3">
                  <Label htmlFor="fill-clipboard-on-shortcut" className="pt-1">
                    {t("fillClipboardOnShortcut")}
                  </Label>
                  <div className="grid gap-1.5">
                    <Switch
                      id="fill-clipboard-on-shortcut"
                      checked={fillClipboardOnShortcut}
                      onCheckedChange={setFillClipboardOnShortcut}
                      aria-describedby="fill-clipboard-on-shortcut-hint"
                    />
                    <p
                      id="fill-clipboard-on-shortcut-hint"
                      className="text-sm text-muted-foreground"
                    >
                      {t("fillClipboardOnShortcutHint")}
                    </p>
                  </div>
                </div>

                <div className="order-8 grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-3">
                  <Label htmlFor="copy-result-on-complete" className="pt-1">
                    {t("copyResultOnComplete")}
                  </Label>
                  <div className="grid gap-1.5">
                    <Switch
                      id="copy-result-on-complete"
                      checked={copyResultOnComplete}
                      onCheckedChange={setCopyResultOnComplete}
                      aria-describedby="copy-result-on-complete-hint"
                    />
                    <p
                      id="copy-result-on-complete-hint"
                      className="text-sm text-muted-foreground"
                    >
                      {t("copyResultOnCompleteHint")}
                    </p>
                  </div>
                </div>

                <div className="order-9 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
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

                <div className="order-10 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
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

                <div className="order-11 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
                  <Label htmlFor="auto-check-updates">
                    {t("autoCheckUpdates")}
                  </Label>
                  <div className="flex items-center">
                    <Switch
                      id="auto-check-updates"
                      checked={autoCheckUpdates}
                      onCheckedChange={setAutoCheckUpdates}
                    />
                  </div>
                </div>

                <div className="order-12 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
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

            {settingsTab === "about" && (
              <div className="grid gap-6">
                <div className="flex flex-col items-center gap-5 rounded-xl border bg-muted/20 px-5 py-8 text-center sm:flex-row sm:items-start sm:text-left">
                  <img
                    src="/trali.png"
                    alt={APP_NAME}
                    className="size-24 rounded-3xl shadow-lg ring-1 ring-foreground/10"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center justify-center gap-2 sm:justify-start">
                      <InfoIcon className="size-4 text-primary" />
                      <h2 className="font-semibold">{t("aboutTitle")}</h2>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("aboutDescription")}
                    </p>
                    <dl className="mt-4 grid gap-2 text-sm">
                      <div className="flex justify-center gap-2 sm:justify-start">
                        <dt className="text-muted-foreground">
                          {t("appName")}
                        </dt>
                        <dd className="font-medium">{APP_NAME}</dd>
                      </div>
                      <div className="flex justify-center gap-2 sm:justify-start">
                        <dt className="text-muted-foreground">
                          {t("appVersion")}
                        </dt>
                        <dd className="font-medium tabular-nums">
                          {APP_VERSION}
                        </dd>
                      </div>
                      <div className="flex justify-center gap-2 sm:justify-start">
                        <dt className="text-muted-foreground">
                          {t("appAuthor")}
                        </dt>
                        <dd className="font-medium">{APP_AUTHOR}</dd>
                      </div>
                    </dl>
                    <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void openExternalUrl(TRALI_HOMEPAGE_URL)}
                      >
                        <HouseIcon />
                        {t("officialWebsite")}
                        <ExternalLinkIcon className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        className="bg-[#24292f] text-white shadow-sm hover:bg-[#57606a] dark:bg-[#f0f6fc] dark:text-[#24292f] dark:hover:bg-white"
                        onClick={() => void openExternalUrl(TRALI_GITHUB_URL)}
                      >
                        <GithubBrandIcon className="size-4" />
                        GitHub
                        <ExternalLinkIcon className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
                  <div>
                    <p className="font-medium">{t("updateTitle")}</p>
                    <p className="text-sm text-muted-foreground">
                      {availableUpdate
                        ? t("updateAvailable", {
                            version: availableUpdate.version,
                          })
                        : updateCheckState === "up-to-date"
                          ? t("noUpdatesAvailable")
                          : updateCheckState === "error"
                            ? t("updateCheckFailed")
                      : t("updateDescription")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {availableUpdate &&
                    updateCheckState === "available" ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void installAvailableUpdate()}
                        >
                          <RefreshCwIcon />
                          {t("updateNow")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void skipAvailableUpdate()}
                        >
                          {t("skipThisVersion")}
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="outline"
                      onClick={() =>
                        void checkForUpdates({
                          respectSkippedVersion: false,
                        })
                      }
                      disabled={
                        updateCheckState === "checking" ||
                        updateCheckState === "installing"
                      }
                    >
                      <RefreshCwIcon
                        className={
                          updateCheckState === "checking"
                            ? "animate-spin"
                            : undefined
                        }
                      />
                      {updateCheckState === "checking"
                        ? t("checkingForUpdates")
                        : t("checkForUpdates")}
                    </Button>
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
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => glossaryImportRef.current?.click()}
                            />
                          }
                        >
                          {t("importGlossary")}
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("importGlossaryHint")}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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
        <PromptOptimizerDialog
          open={stylePromptOptimizerTarget !== undefined}
          currentPrompt={stylePromptOptimizerTarget?.prompt ?? ""}
          providerId={
            stylePromptOptimizerTarget?.providerId ?? defaultProviderId
          }
          onOpenChange={(open) => {
            if (!open) setStylePromptOptimizerId(null);
          }}
          onApply={(prompt) => {
            if (stylePromptOptimizerTarget) {
              updateStyle(stylePromptOptimizerTarget.id, "prompt", prompt);
            }
            setStylePromptOptimizerId(null);
          }}
        />
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
          className={
            hasConfiguredProvider
              ? "grid h-full overflow-hidden bg-card"
              : "flex h-full flex-col overflow-hidden bg-card"
          }
          style={
            hasConfiguredProvider
              ? {
                  gridTemplateRows: `minmax(${MAIN_PANEL_MIN_HEIGHT}px, ${sourcePanelRatio}fr) auto minmax(${MAIN_PANEL_MIN_HEIGHT}px, ${1 - sourcePanelRatio}fr)`,
                }
              : undefined
          }
          onPointerMove={handlePanelDividerPointerMove}
          onPointerUp={handlePanelDividerPointerEnd}
          onPointerCancel={handlePanelDividerPointerEnd}
        >
          <div
            className={
              hasConfiguredProvider
                ? "grid min-h-0 grid-rows-[auto_1fr]"
                : "shrink-0"
            }
          >
            <div
              className={`flex items-center gap-2 ${
                IS_MACOS
                  ? "mac-titlebar-row px-4 pt-8 pb-2"
                  : "px-3 py-2.5 pl-3"
              }`}
            >
              <div className="flex shrink-0 items-center gap-2">
                <div
                  className="relative grid grid-cols-2 rounded-lg bg-muted p-0.5"
                  role="tablist"
                >
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-primary shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${
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
                          ? "text-primary-foreground hover:text-primary-foreground"
                          : "text-muted-foreground hover:text-muted-foreground"
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
                  triggerClassName="min-w-0 max-w-64 border-0 bg-transparent shadow-none dark:bg-transparent dark:hover:bg-transparent"
                  languagePairs={
                    workMode === "translate" ? languagePairs : undefined
                  }
                  languagePairsLabel={t("languagePairsHome")}
                  onLanguagePairSelect={applyLanguagePair}
                />
              </div>
              <WindowDragRegion className="flex items-center justify-end pr-1">
                {!IS_MACOS ? (
                  <Badge
                    variant="secondary"
                    className="pointer-events-none select-none font-normal tabular-nums"
                  >
                    {APP_NAME} {APP_VERSION}
                  </Badge>
                ) : null}
              </WindowDragRegion>
              {availableUpdate && updateCheckState === "available" ? (
                <Button
                  variant="secondary"
                  size="xs"
                  className="gap-1 rounded-full text-primary"
                  onClick={() => setUpdateDialogOpen(true)}
                >
                  <RefreshCwIcon />
                  {t("updateAvailableShort", {
                    version: availableUpdate.version,
                  })}
                </Button>
              ) : null}
              <div className="flex shrink-0 items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
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
                        />
                      }
                    >
                      <PinIcon />
                    </TooltipTrigger>
                    <TooltipContent>
                      {alwaysOnTop ? t("unpinWindow") : t("pinWindow")}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
            {hasConfiguredProvider ? (
              <Textarea
                ref={sourceInputRef}
                value={sourceText}
                onChange={(event) => {
                  setSourceText(event.currentTarget.value);
                }}
                placeholder={t("sourcePlaceholder")}
                className="h-full min-h-0 resize-none rounded-none border-0 px-4 py-4 text-base shadow-none focus-visible:ring-0"
                autoFocus
              />
            ) : null}
          </div>

          {hasConfiguredProvider ? (
            <>
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
              className="pointer-events-none absolute top-1/2 bg-border transition-colors dark:bg-foreground/30 group-hover:bg-primary/60 dark:group-hover:bg-primary/60 group-data-[dragging=true]:bg-primary dark:group-data-[dragging=true]:bg-primary"
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
              onClick={handleSwapButtonClick}
            >
              {disabledSwapClickCount >= 5 ? (
                <span
                  aria-hidden="true"
                  className="swap-easter-egg-emoji"
                  onAnimationEnd={() => setDisabledSwapClickCount(0)}
                >
                  👋
                </span>
              ) : (
                <>
                  <TransferStatusIcon
                    className="transfer-status-icon size-4"
                    loading={isGenerating}
                  />
                  <ArrowUpDownIcon className="transfer-swap-icon absolute size-4" />
                </>
              )}
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
                    triggerClassName="min-w-0 max-w-40 border-0 bg-transparent pl-0 shadow-none dark:bg-transparent dark:hover:bg-transparent"
                  />
                ) : null}
              </div>
              {workMode === "translate" ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Label
                    htmlFor="mount-glossary"
                    className="text-xs text-muted-foreground"
                  >
                    {t("mountGlossary")}
                  </Label>
                  {hasGlossaryTerms ? (
                    <Switch
                      id="mount-glossary"
                      checked={mountGlossary}
                      onCheckedChange={setMountGlossary}
                      aria-label={t("mountGlossary")}
                    />
                  ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="inline-flex cursor-not-allowed" />
                          }
                        >
                          <Switch
                            id="mount-glossary"
                            checked={false}
                            disabled
                            aria-label={t("mountGlossary")}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>{glossaryHintBefore}</span>
                          <Button
                            variant="link"
                            size="xs"
                            className="mx-0.5 h-auto p-0 align-baseline text-primary-foreground hover:text-primary-foreground/80"
                            onClick={() => {
                              setSettingsTab("glossary");
                              openSettings();
                            }}
                          >
                            {t("settingsTitle")}
                          </Button>
                          <span>{glossaryHintAfter}</span>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              ) : null}
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
                    <div
                      className={
                        translationVersions.length > 1
                          ? "flex items-center justify-between border-b px-3 py-1.5 text-xs font-medium text-muted-foreground"
                          : "flex items-center justify-between px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground"
                      }
                    >
                      <span>{version.name}</span>
                      {workMode === "translate" && version.id !== "default" ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="inline-flex items-center gap-1.5 font-normal" />
                              }
                            >
                              <Checkbox
                                id={`transcreation-${version.id}`}
                                checked={
                                  transcreationByStyleId[version.id] === true
                                }
                                onCheckedChange={() =>
                                  toggleTranscreation(version.id)
                                }
                                aria-label={`${t("transcreation")} ${version.name}`}
                              />
                              <Label
                                htmlFor={`transcreation-${version.id}`}
                                className="cursor-pointer text-xs font-normal text-muted-foreground"
                              >
                                {t("transcreation")}
                              </Label>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-72">
                              {t("transcreationTooltip")}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </div>
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
                    {version.status === "completed" &&
                    version.text.trim().length > 0 ? (
                      <ResultQuestionAsk
                        question={askByVersion[version.id]?.question ?? ""}
                        onQuestionChange={(value) =>
                          patchAskSlot(version.id, { question: value })
                        }
                        onSubmit={() => submitResultQuestion(version.id)}
                        asking={askByVersion[version.id]?.status === "asking"}
                        submittedQuestion={
                          askByVersion[version.id]?.submittedQuestion ?? ""
                        }
                        answer={askByVersion[version.id]?.answer ?? null}
                        error={askByVersion[version.id]?.error ?? null}
                        placeholder={t("askResultPlaceholder")}
                        sendLabel={t("askResultSend")}
                        askingLabel={t("askResultAsking")}
                        questionLabel={t("askResultQuestionLabel")}
                        answerLabel={t("askResultAnswerLabel")}
                        onUseAsTranslation={() =>
                          applyAskAnswerAsTranslation(version.id)
                        }
                        useAsTranslationLabel={t("askResultUseAsTranslation")}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
              </div>
            </>
          ) : (
            <ProviderSetupEmptyState
              onOpenSettings={() => {
                setSettingsTab("provider");
                openSettings();
              }}
            />
          )}
        </section>

        <Dialog
          open={updateDialogOpen}
          onOpenChange={(open) => {
            if (updateCheckState !== "installing") {
              setUpdateDialogOpen(open);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("updateTitle")}</DialogTitle>
              <DialogDescription>
                {availableUpdate
                  ? t("updateAvailable", {
                      version: availableUpdate.version,
                    })
                  : t("updateDescription")}
              </DialogDescription>
            </DialogHeader>

            {availableUpdate?.body ? (
              <div className="max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                {availableUpdate.body}
              </div>
            ) : null}

            {updateCheckState === "installing" ? (
              <p className="text-sm text-muted-foreground">
                {updateProgress === null
                  ? t("downloadingUpdate")
                  : t("downloadingUpdateProgress", {
                      progress: String(updateProgress),
                    })}
              </p>
            ) : null}

            {updateCheckState === "error" ? (
              <p className="text-sm text-destructive">
                {t("updateCheckFailed")}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => void skipAvailableUpdate()}
                disabled={
                  !availableUpdate || updateCheckState === "installing"
                }
              >
                {t("skipThisVersion")}
              </Button>
              <Button
                onClick={() => void installAvailableUpdate()}
                disabled={
                  !availableUpdate || updateCheckState === "installing"
                }
              >
                <RefreshCwIcon
                  className={
                    updateCheckState === "installing"
                      ? "animate-spin"
                      : undefined
                  }
                />
                {updateCheckState === "installing"
                  ? t("updatingApp")
                  : t("updateNow")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </main>
  );
}

export default App;
