const MODELS_DEV_API_URL = "https://models.dev/api.json";

type ModelsDevProvider = {
  models?: Record<string, unknown>;
};

export type ModelOption = {
  id: string;
  name: string;
};

export type ModelsDevModelMap = Record<string, ModelOption[]>;

const providerIdsByPresetId: Record<string, readonly string[]> = {
  openai: ["openai"],
  anthropic: ["anthropic"],
  "google-gemini": ["google"],
  xai: ["xai"],
  groq: ["groq"],
  mistral: ["mistral"],
  deepseek: ["deepseek"],
  qwen: ["alibaba-cn", "alibaba"],
  moonshot: ["moonshotai-cn", "moonshotai"],
  zhipu: ["zhipuai"],
  siliconflow: ["siliconflow-cn", "siliconflow"],
  minimax: ["minimax-cn", "minimax"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isTextModel(value: Record<string, unknown>) {
  if (value.status === "deprecated") return false;

  const modalities = isRecord(value.modalities) ? value.modalities : undefined;
  const output = Array.isArray(modalities?.output)
    ? modalities.output.filter((item): item is string => typeof item === "string")
    : [];

  return output.length === 0 || output.includes("text");
}

function parseModels(provider: ModelsDevProvider): ModelOption[] {
  if (!isRecord(provider.models)) return [];

  const models = new Map<string, ModelOption>();
  for (const [modelKey, rawModel] of Object.entries(provider.models)) {
    if (!isRecord(rawModel) || !isTextModel(rawModel)) continue;
    const id = readString(rawModel.id) ?? modelKey;
    const name = readString(rawModel.name) ?? id;
    models.set(id, { id, name });
  }

  return [...models.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

function parseModelsDevCatalog(payload: unknown): ModelsDevModelMap {
  if (!isRecord(payload)) return {};

  const result: ModelsDevModelMap = {};
  for (const [presetId, providerIds] of Object.entries(providerIdsByPresetId)) {
    for (const providerId of providerIds) {
      const provider = payload[providerId];
      if (!isRecord(provider)) continue;

      const models = parseModels(provider);
      if (models.length > 0) {
        result[presetId] = models;
        break;
      }
    }
  }
  return result;
}

let modelsDevPromise: Promise<ModelsDevModelMap> | null = null;

export function loadModelsDevModels() {
  modelsDevPromise ??= fetch(MODELS_DEV_API_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`models.dev returned HTTP ${response.status}`);
      }
      return response.json() as Promise<unknown>;
    })
    .then(parseModelsDevCatalog)
    .catch((error) => {
      modelsDevPromise = null;
      throw error;
    });

  return modelsDevPromise;
}
