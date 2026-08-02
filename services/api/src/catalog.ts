export type Provider = "openai" | "gemini" | "deepseek";

export type LoadBalanceStrategy = "round_robin" | "random";

export type ModelRoute = {
  id: string;
  provider: Provider;
  upstreamModel: string;
  label: string;
  description: string;
  uiMode: "chatgpt" | "gemini" | "deepseek";
  aliases: string[];
  enabled?: boolean;
};

const openAiModel = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const geminiModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const deepSeekModel = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

/** Default mappings are persisted on first PostgreSQL startup and remain editable in the console. */
export const modelCatalog: ModelRoute[] = [
  {
    id: "chatgpt-lite",
    provider: "openai",
    upstreamModel: process.env.OPENAI_LITE_MODEL ?? openAiModel,
    label: "Lite",
    description: "Fast, focused ChatGPT conversations",
    uiMode: "chatgpt",
    aliases: ["gpt-4.1-mini", "openai", "chatgpt"],
  },
  {
    id: "chatgpt-standard",
    provider: "openai",
    upstreamModel: process.env.OPENAI_STANDARD_MODEL ?? openAiModel,
    label: "Standard",
    description: "Balanced ChatGPT responses",
    uiMode: "chatgpt",
    aliases: ["gpt-4.1"],
  },
  {
    id: "chatgpt-pro",
    provider: "openai",
    upstreamModel: process.env.OPENAI_PRO_MODEL ?? "gpt-4.1",
    label: "Pro",
    description: "Expanded ChatGPT capability",
    uiMode: "chatgpt",
    aliases: [],
  },
  {
    id: "gemini-flash",
    provider: "gemini",
    upstreamModel: process.env.GEMINI_FLASH_MODEL ?? geminiModel,
    label: "Flash",
    description: "Fast Gemini responses",
    uiMode: "gemini",
    aliases: ["gemini", "gemini-2.5-flash"],
  },
  {
    id: "gemini-standard",
    provider: "gemini",
    upstreamModel: process.env.GEMINI_STANDARD_MODEL ?? geminiModel,
    label: "Standard",
    description: "Balanced Gemini reasoning",
    uiMode: "gemini",
    aliases: [],
  },
  {
    id: "gemini-extended",
    provider: "gemini",
    upstreamModel: process.env.GEMINI_EXTENDED_MODEL ?? geminiModel,
    label: "Extended",
    description: "Longer Gemini responses",
    uiMode: "gemini",
    aliases: [],
  },
  {
    id: "deepseek-flash",
    provider: "deepseek",
    upstreamModel: process.env.DEEPSEEK_FLASH_MODEL ?? deepSeekModel,
    label: "Flash",
    description: "Fast DeepSeek responses",
    uiMode: "deepseek",
    aliases: ["deepseek", "deepseek-chat"],
  },
  {
    id: "deepseek-expert",
    provider: "deepseek",
    upstreamModel: process.env.DEEPSEEK_EXPERT_MODEL ?? deepSeekModel,
    label: "Expert",
    description: "DeepSeek reasoning-focused responses",
    uiMode: "deepseek",
    aliases: [],
  },
];

export function findModelRoute(model: string, routes: ModelRoute[] = modelCatalog): ModelRoute | undefined {
  const normalized = model.trim().toLowerCase();
  return routes.find(
    (route) => route.enabled !== false && (route.id === normalized || route.aliases.includes(normalized)),
  );
}

export function publicRemoteConfig(routes: ModelRoute[] = modelCatalog) {
  return {
    version: 2,
    defaultSystemPrompt: "You are a helpful AI assistant.",
    featureFlags: {
      attachments: false,
      reasoningBlocks: true,
      remoteModelConfig: true,
    },
    models: routes
      .filter((model) => model.enabled !== false)
      .map(({ aliases: _aliases, upstreamModel: _upstreamModel, enabled: _enabled, ...model }) => model),
  };
}
