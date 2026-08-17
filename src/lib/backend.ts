import { Channel, invoke } from "@tauri-apps/api/core";

export type ProviderType =
  | "openai-compatible"
  | "anthropic-compatible";

export type ProviderConfig = {
  id: string;
  name: string;
  type: ProviderType;
  endpoint: string;
  model: string;
};

export type StyleConfig = {
  id: string;
  name: string;
  prompt: string;
  providerId: string | null;
};

export type PromptOptimizationAnswer = {
  question: string;
  answer: string;
};

export type PromptOptimizationQuestion = {
  text: string;
  options: string[];
  allowCustom: boolean;
};

export type PromptOptimizationRequest = {
  providerId: string;
  currentPrompt: string;
  answers: PromptOptimizationAnswer[];
  interfaceLanguage: string;
};

export type PromptOptimizationResponse =
  | {
      kind: "question";
      question: PromptOptimizationQuestion;
      round: number;
    }
  | {
      kind: "final";
      optimizedPrompt: string;
    };

export type GlossaryConcept = {
  id: string;
  terms: Record<string, string>;
};

export type GlossaryData = {
  languages: string[];
  concepts: GlossaryConcept[];
};

export type LanguagePair = {
  id: string;
  source: string;
  target: string;
};

export type AppSettings = {
  version: 2;
  interfaceLanguage: string;
  theme: string;
  themeColor: string;
  radius: string;
  shortcut: string;
  defaultTargetLanguage: string;
  closeBehavior: string;
  alwaysOnTop: boolean;
  fillClipboardOnShortcut: boolean;
  copyResultOnComplete: boolean;
  autoCheckUpdates: boolean;
  workMode: string;
  selectedStyleIds: string[];
  defaultProviderId: string | null;
  providers: ProviderConfig[];
  styles: StyleConfig[];
  languagePairs: LanguagePair[];
};

export type BackendSnapshot = {
  settings: AppSettings;
  glossary: GlossaryData;
  providerKeyStatuses: Record<string, boolean>;
  needsMigration: boolean;
};

export type GenerationVariant = {
  id: string;
  styleId: string | null;
  transcreation: boolean;
};

export type GenerationRequest = {
  requestId: string;
  mode: "translate" | "proofread";
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
  responseLanguage: string;
  includeGlossary: boolean;
  variants: GenerationVariant[];
};

export type GenerationEvent =
  | {
      type: "started";
      requestId: string;
      variantId: string;
    }
  | {
      type: "delta";
      requestId: string;
      variantId: string;
      text: string;
    }
  | {
      type: "completed";
      requestId: string;
      variantId: string;
      speakableText: string | null;
    }
  | {
      type: "error";
      requestId: string;
      variantId: string;
      code: string;
      message: string;
    }
  | {
      type: "allCompleted";
      requestId: string;
    };

export type SpeechCapabilities = {
  supported: boolean;
  backend: string;
};

export type SpeechState = {
  status: "playing" | "stopped" | "error";
  variantId: string | null;
  error: string | null;
};

export function createGenerationChannel(
  onEvent: (event: GenerationEvent) => void,
) {
  const channel = new Channel<GenerationEvent>();
  channel.onmessage = onEvent;
  return channel;
}

export function loadBackendSnapshot() {
  return invoke<BackendSnapshot>("load_backend_snapshot");
}

export function saveBackendSettings(settings: AppSettings) {
  return invoke<void>("save_settings", { settings });
}

export function migrateLegacyData(
  settings: AppSettings,
  glossary: GlossaryData,
) {
  return invoke<void>("migrate_legacy_data", { settings, glossary });
}

export function saveBackendGlossary(glossary: GlossaryData) {
  return invoke<void>("save_glossary", { glossary });
}

export function exportBackendSettings() {
  return invoke<string>("export_settings");
}

export function importBackendSettings(text: string) {
  return invoke<AppSettings>("import_settings", { text });
}

export function exportBackendGlossary() {
  return invoke<string>("export_glossary");
}

export function exportBackendGlossaryToFile(glossary: GlossaryData) {
  return invoke<string>("export_glossary_to_file", { glossary });
}

export function importBackendGlossary(text: string) {
  return invoke<GlossaryData>("import_glossary", { text });
}

export function saveProviderApiKey(providerId: string, apiKey: string) {
  return invoke<void>("set_provider_api_key", { providerId, apiKey });
}

export function deleteProviderApiKey(providerId: string) {
  return invoke<void>("delete_provider_api_key", { providerId });
}

export function fetchBackendProviderModels(providerId: string) {
  return invoke<string[]>("fetch_provider_models", { providerId });
}

export function testBackendProviderConnection(providerId: string) {
  return invoke<void>("test_provider_connection", { providerId });
}

export function generate(
  request: GenerationRequest,
  onEvent: Channel<GenerationEvent>,
) {
  return invoke<void>("generate", { request, onEvent });
}

export function cancelGeneration(requestId: string) {
  return invoke<void>("cancel_generation", { requestId });
}

export function optimizeStylePrompt(request: PromptOptimizationRequest) {
  return invoke<PromptOptimizationResponse>("optimize_style_prompt", {
    request,
  });
}

export function getSpeechCapabilities() {
  return invoke<SpeechCapabilities>("speech_capabilities");
}

export function speakText(
  variantId: string,
  text: string,
  language: string,
) {
  return invoke<void>("speak_text", {
    request: { variantId, text, language },
  });
}

export function stopSpeech() {
  return invoke<void>("stop_speech");
}
