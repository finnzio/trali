import type { ProviderType } from "@/lib/backend";

const MODELS_DEV_API_URL = "https://models.dev/api.json";

type RawModelsDevProvider = {
  id?: unknown;
  name?: unknown;
  api?: unknown;
  npm?: unknown;
  models?: Record<string, unknown>;
};

export type ModelOption = {
  id: string;
  name: string;
};

export type ModelsDevProvider = {
  id: string;
  name: string;
  endpoint: string;
  type: ProviderType;
  models: ModelOption[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isTextModel(value: Record<string, unknown>) {
  if (value.status === "deprecated") return false;

  const modalities = isRecord(value.modalities) ? value.modalities : undefined;
  const output = Array.isArray(modalities?.output)
    ? modalities.output.filter((item): item is string => typeof item === "string")
    : [];

  return output.length === 0 || output.includes("text");
}

function parseModels(provider: RawModelsDevProvider): ModelOption[] {
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

function inferProviderType(
  providerId: string,
  provider: RawModelsDevProvider,
): ProviderType {
  const npm = readString(provider.npm)?.toLowerCase() ?? "";
  return providerId.includes("anthropic") || npm.includes("anthropic")
    ? "anthropic-compatible"
    : "openai-compatible";
}

function isUsableEndpoint(endpoint: string) {
  return (
    (endpoint.startsWith("https://") || endpoint.startsWith("http://")) &&
    !endpoint.includes("${")
  );
}

function parseModelsDevCatalog(payload: unknown): ModelsDevProvider[] {
  if (!isRecord(payload)) return [];

  return Object.entries(payload)
    .flatMap(([providerKey, rawProvider]) => {
      if (!isRecord(rawProvider)) return [];

      const provider = rawProvider as RawModelsDevProvider;
      const models = parseModels(provider);
      const endpoint = readString(provider.api);
      if (models.length === 0 || !endpoint || !isUsableEndpoint(endpoint)) {
        return [];
      }

      const id = readString(provider.id) ?? providerKey;
      return [
        {
          id,
          name: readString(provider.name) ?? id,
          endpoint,
          type: inferProviderType(id, provider),
          models,
        },
      ];
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
}

let modelsDevPromise: Promise<ModelsDevProvider[]> | null = null;

export function loadModelsDevProviders() {
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
