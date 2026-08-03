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

const openAiModel = "gpt-4.1-mini";
const geminiModel = "gemini-2.5-flash";
const deepSeekModel = "deepseek-chat";

/** Default mappings are persisted on first PostgreSQL startup and remain editable in the console. */
export const modelCatalog: ModelRoute[] = [
  {
    id: "chatgpt-lite",
    provider: "openai",
    upstreamModel: openAiModel,
    label: "Lite",
    description: "Fast, focused ChatGPT conversations",
    uiMode: "chatgpt",
    aliases: ["gpt-4.1-mini", "openai", "chatgpt"],
  },
  {
    id: "chatgpt-standard",
    provider: "openai",
    upstreamModel: openAiModel,
    label: "Standard",
    description: "Balanced ChatGPT responses",
    uiMode: "chatgpt",
    aliases: ["gpt-4.1"],
  },
  {
    id: "chatgpt-pro",
    provider: "openai",
    upstreamModel: "gpt-4.1",
    label: "Pro",
    description: "Expanded ChatGPT capability",
    uiMode: "chatgpt",
    aliases: [],
  },
  {
    id: "gemini-flash",
    provider: "gemini",
    upstreamModel: geminiModel,
    label: "Flash",
    description: "Fast Gemini responses",
    uiMode: "gemini",
    aliases: ["gemini", "gemini-2.5-flash"],
  },
  {
    id: "gemini-standard",
    provider: "gemini",
    upstreamModel: geminiModel,
    label: "Standard",
    description: "Balanced Gemini reasoning",
    uiMode: "gemini",
    aliases: [],
  },
  {
    id: "gemini-extended",
    provider: "gemini",
    upstreamModel: geminiModel,
    label: "Extended",
    description: "Longer Gemini responses",
    uiMode: "gemini",
    aliases: [],
  },
  {
    id: "deepseek-flash",
    provider: "deepseek",
    upstreamModel: deepSeekModel,
    label: "Flash",
    description: "Fast DeepSeek responses",
    uiMode: "deepseek",
    aliases: ["deepseek", "deepseek-chat"],
  },
  {
    id: "deepseek-expert",
    provider: "deepseek",
    upstreamModel: deepSeekModel,
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
