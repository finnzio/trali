import type { ProviderConfig, ProviderType } from "@/lib/backend";

export type ProviderPreset = {
  id: string;
  name: string;
  type: ProviderType;
  endpoint: string;
};

/** Common hosted providers with stable OpenAI- or Anthropic-compatible APIs. */
export const providerPresets: readonly ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    type: "openai-compatible",
    endpoint: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic-compatible",
    endpoint: "https://api.anthropic.com/v1",
  },
  {
    id: "google-gemini",
    name: "Google Gemini",
    type: "openai-compatible",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "xai",
    name: "xAI",
    type: "openai-compatible",
    endpoint: "https://api.x.ai/v1",
  },
  {
    id: "groq",
    name: "Groq",
    type: "openai-compatible",
    endpoint: "https://api.groq.com/openai/v1",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    type: "openai-compatible",
    endpoint: "https://api.mistral.ai/v1",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai-compatible",
    endpoint: "https://api.deepseek.com",
  },
  {
    id: "qwen",
    name: "阿里云百炼 / Qwen",
    type: "openai-compatible",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "moonshot",
    name: "月之暗面 / Kimi",
    type: "openai-compatible",
    endpoint: "https://api.moonshot.cn/v1",
  },
  {
    id: "zhipu",
    name: "智谱 AI / GLM",
    type: "openai-compatible",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "qianfan",
    name: "百度千帆",
    type: "openai-compatible",
    endpoint: "https://qianfan.baidubce.com/v2",
  },
  {
    id: "volcengine-ark",
    name: "火山方舟 / 豆包",
    type: "openai-compatible",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    type: "openai-compatible",
    endpoint: "https://api.siliconflow.cn/v1",
  },
  {
    id: "minimax",
    name: "MiniMax",
    type: "openai-compatible",
    endpoint: "https://api.minimaxi.com/v1",
  },
];

export function getProviderPreset(
  provider: Pick<ProviderConfig, "name" | "type" | "endpoint">,
) {
  return providerPresets.find(
    (preset) =>
      preset.name === provider.name &&
      preset.type === provider.type &&
      preset.endpoint === provider.endpoint,
  );
}
