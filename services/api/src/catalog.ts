export type Provider = string;

export type LoadBalanceStrategy = "round_robin" | "random";

export type ModelRoute = {
  id: string;
  provider: Provider;
  upstreamModel: string;
  label: string;
  description: string;
  uiMode: string;
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

export type RemoteChannel = {
  id: string;
  displayName: string;
  description: string;
  icon: { type: "builtin" | "data_url"; value: string };
  style: {
    backgroundStart: string;
    backgroundEnd: string;
    accentColor: string;
    textColor: string;
    surfaceColor: string;
    typography: "sans" | "serif" | "mono";
    animatedGradient: boolean;
  };
  models: Array<{ id: string; label: string; description: string }>;
};

const builtInChannels: Array<Omit<RemoteChannel, "models">> = [
  {
    id: "chatgpt", displayName: "ChatGPT", description: "Minimal and focused",
    icon: { type: "builtin", value: "chatgpt" },
    style: { backgroundStart: "#FFFFFF", backgroundEnd: "#F7F7F8", accentColor: "#0D7C66", textColor: "#202123", surfaceColor: "#FFFFFF", typography: "sans", animatedGradient: false },
  },
  {
    id: "gemini", displayName: "Gemini", description: "Colorful Material intelligence",
    icon: { type: "builtin", value: "gemini" },
    style: { backgroundStart: "#E8F0FE", backgroundEnd: "#FCE8F3", accentColor: "#1A73E8", textColor: "#202124", surfaceColor: "#FFFFFF", typography: "sans", animatedGradient: true },
  },
  {
    id: "deepseek", displayName: "DeepSeek", description: "Technical reasoning workspace",
    icon: { type: "builtin", value: "deepseek" },
    style: { backgroundStart: "#F2F7FF", backgroundEnd: "#E8F0FF", accentColor: "#3B6EF5", textColor: "#17213A", surfaceColor: "#FFFFFF", typography: "mono", animatedGradient: false },
  },
];

export function publicRemoteConfig(routes: ModelRoute[] = modelCatalog, dynamicChannels: RemoteChannel[] = []) {
  const enabledRoutes = routes.filter((model) => model.enabled !== false);
  const channels = [
    ...builtInChannels.map((channel) => ({
      ...channel,
      models: enabledRoutes
        .filter((model) => model.uiMode === channel.id)
        .map(({ id, label, description }) => ({ id, label, description })),
    })),
    ...dynamicChannels,
  ].filter((channel) => channel.models.length > 0);
  return {
    version: 4,
    defaultSystemPrompt: "You are a helpful AI assistant.",
    featureFlags: {
      attachments: false,
      reasoningBlocks: true,
      remoteModelConfig: true,
    },
    channels,
    models: enabledRoutes
      .map(({ aliases: _aliases, upstreamModel: _upstreamModel, enabled: _enabled, ...model }) => model),
  };
}
