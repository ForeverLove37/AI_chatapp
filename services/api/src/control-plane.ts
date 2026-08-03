import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { createClient } from "redis";
import {
  findModelRoute,
  modelCatalog,
  type LoadBalanceStrategy,
  type ModelRoute,
  type Provider,
} from "./catalog.js";

export type ClientKeyView = {
  id: string;
  name: string;
  prefix: string;
  status: "active" | "revoked";
  rpmLimit: number;
  dailyLimit: number;
  rpmUsed: number;
  callsToday: number;
  createdAt: string;
  userId: string | null;
};

export type UserRecord = {
  id: string;
  email: string;
  role: "admin" | "standard";
  status: "active" | "suspended";
  monthlyTokens: number;
  rpmLimit: number;
  dailyLimit: number;
  createdAt: string;
};

export type CreateUserInput = Omit<UserRecord, "id" | "monthlyTokens" | "createdAt"> & {
  password: string;
};

export type UpdateUserInput = Partial<Pick<UserRecord, "status" | "role" | "rpmLimit" | "dailyLimit">> & {
  password?: string;
};

export type AuthenticatedUser = Pick<UserRecord, "id" | "email" | "role" | "status">;

export type RoutingScope = "channel" | "model";

export type RoutingPolicy = {
  scope: RoutingScope;
  scopeId: string;
  keyIds: string[];
  updatedAt: string;
};

export type FeedbackRecord = {
  id: string;
  userId: string;
  userEmail: string | null;
  message: string;
  category: string;
  appVersion: string;
  locale: string;
  status: "new" | "reviewed" | "resolved";
  createdAt: string;
};

export type CreateFeedbackInput = Pick<FeedbackRecord, "message" | "category" | "appVersion" | "locale">;

export type AppVersion = {
  id: string;
  versionCode: number;
  versionName: string;
  downloadUrl: string;
  releaseNotes: string;
  isActive: boolean;
  publishedAt: string;
};

export type CreateAppVersionInput = Omit<AppVersion, "id" | "publishedAt">;

export type ProviderKeyView = {
  id: string;
  provider: Provider;
  label: string;
  endpoint: string;
  priority: number;
  status: "active" | "disabled";
  createdAt: string;
  lastUsedAt: string | null;
};

export type ProviderKeyInput = {
  provider: Provider;
  label: string;
  endpoint: string;
  secret: string;
  priority: number;
};

export type ProviderKeyPatch = Partial<Pick<ProviderKeyInput, "label" | "endpoint" | "secret" | "priority">> & {
  status?: "active" | "disabled";
};

export type ModelRoutePatch = Partial<Pick<ModelRoute, "provider" | "upstreamModel" | "label" | "description" | "aliases">> & {
  enabled?: boolean;
};

export type RequestMetric = {
  model: string;
  provider: Provider;
  clientKeyId: string | null;
  userId?: string | null;
  status: "success" | "failure";
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
};

export type UsageMetrics = {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  modelCalls: Record<string, number>;
};

export type Overview = {
  storage: string;
  metrics: UsageMetrics;
  models: ModelRoute[];
  keys: ClientKeyView[];
  users: UserRecord[];
  providerKeys: ProviderKeyView[];
  routing: {
    strategy: LoadBalanceStrategy;
    channelPolicies: RoutingPolicy[];
    modelPolicies: RoutingPolicy[];
  };
  activeStreams: number;
};

export type SelectedUpstream = {
  endpoint: string;
  secret: string;
  keyId: string;
};

export type ClientAuthorization =
  | { allowed: true; clientKeyId: string }
  | { allowed: false; status: 401 | 429; message: string };

export type UserAuthorization =
  | { allowed: true; userId: string }
  | { allowed: false; status: 401 | 429; message: string };

export interface ControlPlane {
  start(): Promise<void>;
  close(): Promise<void>;
  getModels(): Promise<ModelRoute[]>;
  findModelRoute(model: string): Promise<ModelRoute | undefined>;
  hasAvailableUpstream(route: ModelRoute): Promise<boolean>;
  selectUpstreams(route: ModelRoute): Promise<SelectedUpstream[]>;
  authorizeClient(secret: string): Promise<ClientAuthorization>;
  authorizeUser(userId: string): Promise<UserAuthorization>;
  recordRequest(metric: RequestMetric): Promise<void>;
  changeActiveStreams(delta: number): Promise<number>;
  getOverview(): Promise<Overview>;
  listUsers(): Promise<UserRecord[]>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  updateUser(id: string, patch: UpdateUserInput): Promise<UserRecord | undefined>;
  authenticateUser(email: string, password: string): Promise<AuthenticatedUser | undefined>;
  listClientKeys(): Promise<ClientKeyView[]>;
  createClientKey(input: { name: string; rpmLimit: number; dailyLimit: number; userId?: string | null }): Promise<{ data: ClientKeyView; secret: string }>;
  revokeClientKey(id: string): Promise<ClientKeyView | undefined>;
  listProviderKeys(): Promise<ProviderKeyView[]>;
  createProviderKey(input: ProviderKeyInput): Promise<ProviderKeyView>;
  updateProviderKey(id: string, patch: ProviderKeyPatch): Promise<ProviderKeyView | undefined>;
  listModelRoutes(): Promise<ModelRoute[]>;
  createModelRoute(route: ModelRoute): Promise<ModelRoute>;
  updateModelRoute(id: string, patch: ModelRoutePatch): Promise<ModelRoute | undefined>;
  getRoutingStrategy(): Promise<LoadBalanceStrategy>;
  setRoutingStrategy(strategy: LoadBalanceStrategy): Promise<LoadBalanceStrategy>;
  listRoutingPolicies(): Promise<RoutingPolicy[]>;
  setRoutingPolicy(scope: RoutingScope, scopeId: string, keyIds: string[]): Promise<RoutingPolicy | undefined>;
  deleteRoutingPolicy(scope: RoutingScope, scopeId: string): Promise<boolean>;
  createFeedback(userId: string, input: CreateFeedbackInput): Promise<FeedbackRecord>;
  listFeedbacks(): Promise<FeedbackRecord[]>;
  updateFeedbackStatus(id: string, status: FeedbackRecord["status"]): Promise<FeedbackRecord | undefined>;
  getLatestAppVersion(): Promise<AppVersion | undefined>;
  listAppVersions(): Promise<AppVersion[]>;
  createAppVersion(input: CreateAppVersionInput): Promise<AppVersion>;
  updateAppVersion(id: string, patch: Partial<Pick<AppVersion, "versionName" | "downloadUrl" | "releaseNotes" | "isActive">>): Promise<AppVersion | undefined>;
}

type StoredClientKey = ClientKeyView & {
  hash: string;
  minuteCalls: number[];
  usageDay: string;
};

type StoredProviderKey = ProviderKeyView & { secret: string };
type StoredUser = UserRecord & { passwordHash: string };
type UsageWindow = { minuteCalls: number[]; usageDay: string; callsToday: number };
type StoredFeedback = FeedbackRecord;

const dayKey = () => new Date().toISOString().slice(0, 10);
const minuteBucket = () => Math.floor(Date.now() / 60_000);
const nowIso = () => new Date().toISOString();
const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");
const scrypt = promisify(scryptCallback);

async function hashPassword(value: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(value, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

async function verifyPassword(value: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [algorithm, salt, encoded] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, "base64url");
  const derived = await scrypt(value, salt, expected.length) as Buffer;
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function normalizeEndpoint(value: string) {
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error("Upstream endpoint must use HTTP or HTTPS.");
  const normalized = url.toString().replace(/\/$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function policyKey(scope: RoutingScope, scopeId: string) {
  return `${scope}:${scopeId}`;
}

function normalizePolicyScope(scope: RoutingScope, scopeId: string) {
  const normalized = scopeId.trim().toLowerCase();
  if (!normalized) throw new Error("A routing policy target is required.");
  if (scope === "channel" && !["chatgpt", "gemini", "deepseek"].includes(normalized)) {
    throw new Error("Channel policies must target ChatGPT, Gemini, or DeepSeek.");
  }
  return normalized;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function isoValue(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function modelFromRow(row: Record<string, unknown>): ModelRoute {
  return {
    id: String(row.id),
    provider: String(row.provider) as Provider,
    upstreamModel: String(row.upstream_model),
    label: String(row.label),
    description: String(row.description),
    uiMode: String(row.ui_mode) as ModelRoute["uiMode"],
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    enabled: Boolean(row.enabled),
  };
}

function userFromRow(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    role: String(row.role) as UserRecord["role"],
    status: String(row.status) as UserRecord["status"],
    monthlyTokens: numberValue(row.monthly_tokens),
    rpmLimit: numberValue(row.rpm_limit),
    dailyLimit: numberValue(row.daily_limit),
    createdAt: isoValue(row.created_at),
  };
}

function providerKeyFromRow(row: Record<string, unknown>): ProviderKeyView {
  return {
    id: String(row.id),
    provider: String(row.provider) as Provider,
    label: String(row.label),
    endpoint: String(row.endpoint),
    priority: numberValue(row.priority),
    status: String(row.status) as ProviderKeyView["status"],
    createdAt: isoValue(row.created_at),
    lastUsedAt: row.last_used_at ? isoValue(row.last_used_at) : null,
  };
}

function feedbackFromRow(row: Record<string, unknown>): FeedbackRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    userEmail: row.user_email ? String(row.user_email) : null,
    message: String(row.message),
    category: String(row.category),
    appVersion: String(row.app_version),
    locale: String(row.locale),
    status: String(row.status) as FeedbackRecord["status"],
    createdAt: isoValue(row.created_at),
  };
}

function appVersionFromRow(row: Record<string, unknown>): AppVersion {
  return {
    id: String(row.id),
    versionCode: numberValue(row.version_code),
    versionName: String(row.version_name),
    downloadUrl: String(row.download_url),
    releaseNotes: String(row.release_notes),
    isActive: Boolean(row.is_active),
    publishedAt: isoValue(row.published_at),
  };
}

/** Isolated adapter used by API unit tests; runtime startup always uses PostgresControlPlane. */
export class MemoryControlPlane implements ControlPlane {
  private readonly apiKeys = new Map<string, StoredClientKey>();
  private readonly users = new Map<string, StoredUser>();
  private readonly providerKeys = new Map<string, StoredProviderKey>();
  private readonly models = new Map(modelCatalog.map((model) => [model.id, { ...model, enabled: true }]));
  private readonly policies = new Map<string, RoutingPolicy>();
  private readonly userUsage = new Map<string, UsageWindow>();
  private readonly feedbacks = new Map<string, StoredFeedback>();
  private readonly appVersions = new Map<string, AppVersion>();
  private readonly requests: RequestMetric[] = [];
  private cursors: Record<Provider, number> = { openai: 0, gemini: 0, deepseek: 0 };
  private activeStreams = 0;
  private strategy: LoadBalanceStrategy = "round_robin";

  constructor() {
    const createdAt = nowIso();
    this.users.set("usr_admin", {
      id: "usr_admin",
      email: "admin@adaptive.local",
      role: "admin",
      status: "active",
      monthlyTokens: 0,
      rpmLimit: 60,
      dailyLimit: 100_000,
      createdAt,
      passwordHash: "",
    });
    const secret = "ac_demo_local_key";
    this.apiKeys.set("key_demo", {
      id: "key_demo",
      name: "Local Android development",
      prefix: "ac_demo_",
      status: "active",
      rpmLimit: 120,
      dailyLimit: 250_000,
      rpmUsed: 0,
      callsToday: 0,
      createdAt,
      userId: null,
      hash: hashSecret(secret),
      minuteCalls: [],
      usageDay: dayKey(),
    });
  }

  async start() {}
  async close() {}

  async getModels() {
    return [...this.models.values()].filter((model) => model.enabled !== false);
  }

  async findModelRoute(model: string) {
    return findModelRoute(model, [...this.models.values()]);
  }

  async hasAvailableUpstream(route: ModelRoute) {
    return (await this.selectUpstreams(route)).length > 0;
  }

  async selectUpstreams(route: ModelRoute) {
    const explicit = this.policies.get(policyKey("model", route.id))
      ?? this.policies.get(policyKey("channel", route.uiMode));
    if (explicit) {
      return explicit.keyIds
        .map((id) => this.providerKeys.get(id))
        .filter((key): key is StoredProviderKey => Boolean(key && key.status === "active"))
        .map((key) => ({ endpoint: key.endpoint, secret: key.secret, keyId: key.id }));
    }
    const provider = route.provider;
    const sorted = [...this.providerKeys.values()]
      .filter((key) => key.provider === provider && key.status === "active")
      .sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt));
    const ordered: StoredProviderKey[] = [];
    for (const priority of [...new Set(sorted.map((key) => key.priority))]) {
      const tier = sorted.filter((key) => key.priority === priority);
      if (this.strategy === "random") tier.sort(() => Math.random() - 0.5);
      else if (tier.length > 1) {
        const offset = this.cursors[provider]++ % tier.length;
        tier.push(...tier.splice(0, offset));
      }
      ordered.push(...tier);
    }
    return ordered.map((key) => ({ endpoint: key.endpoint, secret: key.secret, keyId: key.id }));
  }

  async authorizeClient(secret: string): Promise<ClientAuthorization> {
    const key = [...this.apiKeys.values()].find((candidate) => candidate.hash === hashSecret(secret));
    if (!key || key.status !== "active") return { allowed: false, status: 401, message: "A valid client API key is required." };
    const now = Date.now();
    key.minuteCalls = key.minuteCalls.filter((timestamp) => timestamp > now - 60_000);
    if (key.minuteCalls.length >= key.rpmLimit) return { allowed: false, status: 429, message: "Client API key has reached its requests-per-minute limit." };
    if (key.usageDay !== dayKey()) {
      key.usageDay = dayKey();
      key.callsToday = 0;
    }
    if (key.callsToday >= key.dailyLimit) return { allowed: false, status: 429, message: "Client API key has reached its daily quota." };
    key.minuteCalls.push(now);
    key.rpmUsed = key.minuteCalls.length;
    key.callsToday += 1;
    return { allowed: true, clientKeyId: key.id };
  }

  async authorizeUser(userId: string): Promise<UserAuthorization> {
    const user = this.users.get(userId);
    if (!user || user.status !== "active") return { allowed: false, status: 401, message: "Your session is no longer active." };
    const now = Date.now();
    const usage = this.userUsage.get(userId) ?? { minuteCalls: [], usageDay: dayKey(), callsToday: 0 };
    usage.minuteCalls = usage.minuteCalls.filter((timestamp) => timestamp > now - 60_000);
    if (usage.minuteCalls.length >= user.rpmLimit) return { allowed: false, status: 429, message: "Your account has reached its requests-per-minute limit." };
    if (usage.usageDay !== dayKey()) {
      usage.usageDay = dayKey();
      usage.callsToday = 0;
    }
    if (usage.callsToday >= user.dailyLimit) return { allowed: false, status: 429, message: "Your account has reached its daily quota." };
    usage.minuteCalls.push(now);
    usage.callsToday += 1;
    this.userUsage.set(userId, usage);
    return { allowed: true, userId };
  }

  async recordRequest(metric: RequestMetric) {
    this.requests.push(metric);
    const keyUserId = metric.clientKeyId ? this.apiKeys.get(metric.clientKeyId)?.userId : null;
    const user = this.users.get(metric.userId ?? keyUserId ?? "");
    if (user) {
      user.monthlyTokens += metric.promptTokens + metric.completionTokens;
    }
  }

  async changeActiveStreams(delta: number) {
    this.activeStreams = Math.max(0, this.activeStreams + delta);
    return this.activeStreams;
  }

  async getOverview(): Promise<Overview> {
    const modelCalls = Object.fromEntries([...this.models.keys()].map((id) => [id, 0]));
    let successfulRequests = 0;
    let failedRequests = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    for (const request of this.requests) {
      modelCalls[request.model] = (modelCalls[request.model] ?? 0) + 1;
      promptTokens += request.promptTokens;
      completionTokens += request.completionTokens;
      if (request.status === "success") successfulRequests += 1;
      else failedRequests += 1;
    }
    const totalRequests = successfulRequests + failedRequests;
    return {
      storage: "test memory adapter",
      metrics: {
        totalRequests,
        successfulRequests,
        failedRequests,
        successRate: Math.round((successfulRequests / Math.max(1, totalRequests)) * 100),
        promptTokens,
        completionTokens,
        modelCalls,
      },
      models: await this.getModels(),
      keys: await this.listClientKeys(),
      users: await this.listUsers(),
      providerKeys: await this.listProviderKeys(),
      routing: {
        strategy: this.strategy,
        channelPolicies: (await this.listRoutingPolicies()).filter((policy) => policy.scope === "channel"),
        modelPolicies: (await this.listRoutingPolicies()).filter((policy) => policy.scope === "model"),
      },
      activeStreams: this.activeStreams,
    };
  }

  async listUsers() {
    return [...this.users.values()]
      .sort((left, right) => left.email.localeCompare(right.email))
      .map(({ passwordHash: _passwordHash, ...user }) => user);
  }

  async createUser(input: CreateUserInput) {
    if ([...this.users.values()].some((user) => user.email === input.email.toLowerCase())) throw new Error("A user with that email already exists.");
    const { password, ...record } = input;
    const user: StoredUser = {
      ...record,
      id: `usr_${randomUUID().slice(0, 12)}`,
      email: input.email.toLowerCase(),
      monthlyTokens: 0,
      createdAt: nowIso(),
      passwordHash: await hashPassword(password),
    };
    this.users.set(user.id, user);
    const { passwordHash: _passwordHash, ...view } = user;
    return view;
  }

  async updateUser(id: string, patch: UpdateUserInput) {
    const user = this.users.get(id);
    if (!user) return undefined;
    if (patch.password !== undefined) user.passwordHash = await hashPassword(patch.password);
    const { password: _password, ...recordPatch } = patch;
    Object.assign(user, recordPatch);
    const { passwordHash: _passwordHash, ...view } = user;
    return view;
  }

  async authenticateUser(email: string, password: string) {
    const user = [...this.users.values()].find((candidate) => candidate.email === email.trim().toLowerCase());
    if (!user || user.status !== "active" || !await verifyPassword(password, user.passwordHash)) return undefined;
    return { id: user.id, email: user.email, role: user.role, status: user.status };
  }

  async listClientKeys() {
    return [...this.apiKeys.values()].map(({ hash: _hash, minuteCalls: _calls, usageDay: _day, ...key }) => key);
  }

  async createClientKey(input: { name: string; rpmLimit: number; dailyLimit: number; userId?: string | null }) {
    if (input.userId && !this.users.has(input.userId)) throw new Error("Selected user was not found.");
    const secret = `ac_${randomUUID().replaceAll("-", "")}`;
    const key: StoredClientKey = {
      id: `key_${randomUUID().slice(0, 12)}`,
      name: input.name,
      prefix: secret.slice(0, 12),
      status: "active",
      rpmLimit: input.rpmLimit,
      dailyLimit: input.dailyLimit,
      rpmUsed: 0,
      callsToday: 0,
      createdAt: nowIso(),
      userId: input.userId ?? null,
      hash: hashSecret(secret),
      minuteCalls: [],
      usageDay: dayKey(),
    };
    this.apiKeys.set(key.id, key);
    const { hash: _hash, minuteCalls: _calls, usageDay: _day, ...data } = key;
    return { data, secret };
  }

  async revokeClientKey(id: string) {
    const key = this.apiKeys.get(id);
    if (!key) return undefined;
    key.status = "revoked";
    const { hash: _hash, minuteCalls: _calls, usageDay: _day, ...data } = key;
    return data;
  }

  async listProviderKeys() {
    return [...this.providerKeys.values()]
      .sort((left, right) => left.provider.localeCompare(right.provider) || left.priority - right.priority)
      .map(({ secret: _secret, ...key }) => key);
  }

  async createProviderKey(input: ProviderKeyInput) {
    const key: StoredProviderKey = {
      id: `upk_${randomUUID().slice(0, 12)}`,
      provider: input.provider,
      label: input.label,
      endpoint: normalizeEndpoint(input.endpoint),
      secret: input.secret.trim(),
      priority: input.priority,
      status: "active",
      createdAt: nowIso(),
      lastUsedAt: null,
    };
    this.providerKeys.set(key.id, key);
    const { secret: _secret, ...view } = key;
    return view;
  }

  async updateProviderKey(id: string, patch: ProviderKeyPatch) {
    const key = this.providerKeys.get(id);
    if (!key) return undefined;
    if (patch.label !== undefined) key.label = patch.label;
    if (patch.endpoint !== undefined) key.endpoint = normalizeEndpoint(patch.endpoint);
    if (patch.secret !== undefined) key.secret = patch.secret.trim();
    if (patch.priority !== undefined) key.priority = patch.priority;
    if (patch.status !== undefined) key.status = patch.status;
    const { secret: _secret, ...view } = key;
    return view;
  }

  async listModelRoutes() {
    return [...this.models.values()];
  }

  async createModelRoute(route: ModelRoute) {
    if (this.models.has(route.id)) throw new Error("A model mapping with that internal name already exists.");
    const normalized = { ...route, id: route.id.toLowerCase(), aliases: route.aliases.map((alias) => alias.toLowerCase()), enabled: route.enabled ?? true };
    this.models.set(normalized.id, normalized);
    return normalized;
  }

  async updateModelRoute(id: string, patch: ModelRoutePatch) {
    const route = this.models.get(id);
    if (!route) return undefined;
    Object.assign(route, patch, patch.aliases ? { aliases: patch.aliases.map((alias) => alias.toLowerCase()) } : {});
    return route;
  }

  async getRoutingStrategy() {
    return this.strategy;
  }

  async setRoutingStrategy(strategy: LoadBalanceStrategy) {
    this.strategy = strategy;
    return strategy;
  }

  async listRoutingPolicies() {
    return [...this.policies.values()].sort((left, right) => policyKey(left.scope, left.scopeId).localeCompare(policyKey(right.scope, right.scopeId)));
  }

  async setRoutingPolicy(scope: RoutingScope, scopeId: string, keyIds: string[]) {
    const target = normalizePolicyScope(scope, scopeId);
    if (scope === "model" && !this.models.has(target)) throw new Error("The selected model mapping was not found.");
    const normalizedIds = [...new Set(keyIds.map((id) => id.trim()).filter(Boolean))];
    if (!normalizedIds.length) return undefined;
    if (normalizedIds.some((id) => !this.providerKeys.has(id))) throw new Error("One or more selected provider keys were not found.");
    const policy: RoutingPolicy = { scope, scopeId: target, keyIds: normalizedIds, updatedAt: nowIso() };
    this.policies.set(policyKey(scope, target), policy);
    return policy;
  }

  async deleteRoutingPolicy(scope: RoutingScope, scopeId: string) {
    return this.policies.delete(policyKey(scope, normalizePolicyScope(scope, scopeId)));
  }

  async createFeedback(userId: string, input: CreateFeedbackInput) {
    const user = this.users.get(userId);
    if (!user || user.status !== "active") throw new Error("Your account is no longer active.");
    const feedback: StoredFeedback = {
      id: `fb_${randomUUID().slice(0, 12)}`,
      userId,
      userEmail: user.email,
      message: input.message.trim(),
      category: input.category,
      appVersion: input.appVersion,
      locale: input.locale,
      status: "new",
      createdAt: nowIso(),
    };
    this.feedbacks.set(feedback.id, feedback);
    return feedback;
  }

  async listFeedbacks() {
    return [...this.feedbacks.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updateFeedbackStatus(id: string, status: FeedbackRecord["status"]) {
    const feedback = this.feedbacks.get(id);
    if (!feedback) return undefined;
    feedback.status = status;
    return feedback;
  }

  async getLatestAppVersion() {
    return [...this.appVersions.values()]
      .filter((version) => version.isActive)
      .sort((left, right) => right.versionCode - left.versionCode)[0];
  }

  async listAppVersions() {
    return [...this.appVersions.values()].sort((left, right) => right.versionCode - left.versionCode);
  }

  async createAppVersion(input: CreateAppVersionInput) {
    if ([...this.appVersions.values()].some((version) => version.versionCode === input.versionCode)) throw new Error("An app version with that version code already exists.");
    if (input.isActive) this.appVersions.forEach((version) => { version.isActive = false; });
    const version: AppVersion = { id: `appv_${randomUUID().slice(0, 12)}`, ...input, publishedAt: nowIso() };
    this.appVersions.set(version.id, version);
    return version;
  }

  async updateAppVersion(id: string, patch: Partial<Pick<AppVersion, "versionName" | "downloadUrl" | "releaseNotes" | "isActive">>) {
    const version = this.appVersions.get(id);
    if (!version) return undefined;
    if (patch.isActive) this.appVersions.forEach((candidate) => { candidate.isActive = false; });
    Object.assign(version, patch);
    return version;
  }
}

export class PostgresControlPlane implements ControlPlane {
  private readonly pool: Pool;
  private readonly redis: ReturnType<typeof createClient>;
  private readonly encryptionKey: Buffer;

  constructor(databaseUrl: string, redisUrl: string, encryptionSecret?: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.redis = createClient({ url: redisUrl });
    this.encryptionKey = createHash("sha256")
      .update(encryptionSecret ?? process.env.UPSTREAM_KEY_ENCRYPTION_SECRET ?? process.env.ADMIN_API_KEY ?? "development-only-admin-key")
      .digest();
  }

  async start() {
    await this.pool.query("SELECT 1");
    if (!this.redis.isOpen) await this.redis.connect();
    await this.migrate();
    await this.seed();
  }

  async close() {
    if (this.redis.isOpen) await this.redis.quit();
    await this.pool.end();
  }

  private async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL CHECK (role IN ('admin', 'standard')),
        status TEXT NOT NULL CHECK (status IN ('active', 'suspended')) DEFAULT 'active',
        monthly_tokens BIGINT NOT NULL DEFAULT 0,
        rpm_limit INTEGER NOT NULL DEFAULT 60,
        daily_limit INTEGER NOT NULL DEFAULT 100000,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS client_api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
        rpm_limit INTEGER NOT NULL,
        daily_limit INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS provider_keys (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('openai', 'gemini', 'deepseek')),
        label TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        encrypted_secret TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0 AND priority <= 100000),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')) DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS provider_keys_available_idx ON provider_keys(provider, status, priority, created_at);
      CREATE TABLE IF NOT EXISTS model_routes (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('openai', 'gemini', 'deepseek')),
        upstream_model TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        ui_mode TEXT NOT NULL CHECK (ui_mode IN ('chatgpt', 'gemini', 'deepseek')),
        aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS routing_settings (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        strategy TEXT NOT NULL CHECK (strategy IN ('round_robin', 'random')) DEFAULT 'round_robin',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS routing_policies (
        scope TEXT NOT NULL CHECK (scope IN ('channel', 'model')),
        scope_id TEXT NOT NULL,
        key_ids TEXT[] NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (scope, scope_id)
      );
      CREATE INDEX IF NOT EXISTS routing_policies_scope_idx ON routing_policies(scope, scope_id);
      CREATE TABLE IF NOT EXISTS feedbacks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        app_version TEXT NOT NULL DEFAULT '',
        locale TEXT NOT NULL DEFAULT 'system',
        status TEXT NOT NULL CHECK (status IN ('new', 'reviewed', 'resolved')) DEFAULT 'new',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS feedbacks_created_idx ON feedbacks(created_at DESC);
      CREATE TABLE IF NOT EXISTS app_versions (
        id TEXT PRIMARY KEY,
        version_code INTEGER NOT NULL UNIQUE,
        version_name TEXT NOT NULL,
        download_url TEXT NOT NULL,
        release_notes TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS app_versions_active_idx ON app_versions(is_active, version_code DESC);
      CREATE TABLE IF NOT EXISTS request_logs (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        client_key_id TEXT REFERENCES client_api_keys(id) ON DELETE SET NULL,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS request_logs_created_idx ON request_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS request_logs_model_idx ON request_logs(model_id, created_at DESC);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
      UPDATE provider_keys
      SET endpoint = regexp_replace(endpoint, '/v1/?$', '/v1/chat/completions')
      WHERE endpoint ~ '/v1/?$';
    `);
  }

  private async seed() {
    await this.pool.query("INSERT INTO routing_settings (id, strategy) VALUES (1, 'round_robin') ON CONFLICT (id) DO NOTHING");
    for (const model of modelCatalog) {
      await this.pool.query(
        `INSERT INTO model_routes (id, provider, upstream_model, label, description, ui_mode, aliases, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [model.id, model.provider, model.upstreamModel, model.label, model.description, model.uiMode, model.aliases],
      );
    }
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  private decrypt(value: string) {
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Stored upstream key cannot be decrypted.");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  }

  async getModels() {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM model_routes WHERE enabled = TRUE ORDER BY id");
    return result.rows.map(modelFromRow);
  }

  async listModelRoutes() {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM model_routes ORDER BY id");
    return result.rows.map(modelFromRow);
  }

  async findModelRoute(model: string) {
    const normalized = model.trim().toLowerCase();
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM model_routes WHERE enabled = TRUE AND (id = $1 OR $1 = ANY(aliases)) LIMIT 1",
      [normalized],
    );
    return result.rows[0] ? modelFromRow(result.rows[0]) : undefined;
  }

  private async policyForRoute(route: ModelRoute) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM routing_policies
       WHERE (scope = 'model' AND scope_id = $1) OR (scope = 'channel' AND scope_id = $2)
       ORDER BY CASE scope WHEN 'model' THEN 0 ELSE 1 END
       LIMIT 1`,
      [route.id, route.uiMode],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      scope: String(row.scope) as RoutingScope,
      scopeId: String(row.scope_id),
      keyIds: Array.isArray(row.key_ids) ? row.key_ids.map(String) : [],
      updatedAt: isoValue(row.updated_at),
    } satisfies RoutingPolicy;
  }

  async hasAvailableUpstream(route: ModelRoute) {
    const policy = await this.policyForRoute(route);
    const result = policy
      ? await this.pool.query<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM provider_keys WHERE id = ANY($1::text[]) AND status = 'active') AS exists",
        [policy.keyIds],
      )
      : await this.pool.query<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM provider_keys WHERE provider = $1 AND status = 'active') AS exists",
        [route.provider],
      );
    return Boolean(result.rows[0]?.exists);
  }

  async selectUpstreams(route: ModelRoute) {
    const policy = await this.policyForRoute(route);
    const [keys, strategy] = await Promise.all([
      policy
        ? this.pool.query<Record<string, unknown>>(
          `SELECT * FROM provider_keys
           WHERE id = ANY($1::text[]) AND status = 'active'
           ORDER BY array_position($1::text[], id)`,
          [policy.keyIds],
        )
        : this.pool.query<Record<string, unknown>>(
          "SELECT * FROM provider_keys WHERE provider = $1 AND status = 'active' ORDER BY priority ASC, created_at ASC",
          [route.provider],
        ),
      this.getRoutingStrategy(),
    ]);
    const ordered: Record<string, unknown>[] = [];
    const rows = keys.rows;
    if (policy) {
      ordered.push(...rows);
    } else {
      for (const priority of [...new Set(rows.map((row) => numberValue(row.priority)))]) {
        const tier = rows.filter((row) => numberValue(row.priority) === priority);
        if (strategy === "random") tier.sort(() => Math.random() - 0.5);
        else if (tier.length > 1) {
          const count = await this.redis.incr(`routing:cursor:${route.provider}:${priority}`);
          const offset = (count - 1) % tier.length;
          tier.push(...tier.splice(0, offset));
        }
        ordered.push(...tier);
      }
    }
    if (ordered.length) {
      await this.pool.query("UPDATE provider_keys SET last_used_at = NOW() WHERE id = ANY($1::text[])", [ordered.map((row) => String(row.id))]);
    }
    return ordered.map((row) => ({
      endpoint: String(row.endpoint),
      secret: this.decrypt(String(row.encrypted_secret)),
      keyId: String(row.id),
    }));
  }

  async authorizeClient(secret: string): Promise<ClientAuthorization> {
    const keyHash = hashSecret(secret);
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM client_api_keys WHERE key_hash = $1 LIMIT 1",
      [keyHash],
    );
    const row = result.rows[0];
    if (!row || row.status !== "active") return { allowed: false, status: 401, message: "A valid client API key is required." };
    const id = String(row.id);
    const rpmLimit = numberValue(row.rpm_limit);
    const dailyLimit = numberValue(row.daily_limit);
    const rpm = await this.incrementWithTtl(`quota:${id}:rpm:${minuteBucket()}`, 70);
    if (rpm > rpmLimit) return { allowed: false, status: 429, message: "Client API key has reached its requests-per-minute limit." };
    const daily = await this.incrementWithTtl(`quota:${id}:daily:${dayKey()}`, 90_000);
    if (daily > dailyLimit) return { allowed: false, status: 429, message: "Client API key has reached its daily quota." };
    return { allowed: true, clientKeyId: id };
  }

  async authorizeUser(userId: string): Promise<UserAuthorization> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT id, status, rpm_limit, daily_limit FROM users WHERE id = $1 LIMIT 1",
      [userId],
    );
    const row = result.rows[0];
    if (!row || row.status !== "active") return { allowed: false, status: 401, message: "Your session is no longer active." };
    const rpm = await this.incrementWithTtl(`user:${userId}:rpm:${minuteBucket()}`, 70);
    if (rpm > numberValue(row.rpm_limit)) return { allowed: false, status: 429, message: "Your account has reached its requests-per-minute limit." };
    const daily = await this.incrementWithTtl(`user:${userId}:daily:${dayKey()}`, 90_000);
    if (daily > numberValue(row.daily_limit)) return { allowed: false, status: 429, message: "Your account has reached its daily quota." };
    return { allowed: true, userId };
  }

  private async incrementWithTtl(key: string, ttlSeconds: number) {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ttlSeconds);
    return count;
  }

  async recordRequest(metric: RequestMetric) {
    await this.pool.query(
      `INSERT INTO request_logs (id, model_id, provider, client_key_id, user_id, status, prompt_tokens, completion_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), metric.model, metric.provider, metric.clientKeyId, metric.userId ?? null, metric.status, metric.promptTokens, metric.completionTokens, metric.latencyMs],
    );
    const userId = metric.userId ?? (metric.clientKeyId ? (await this.pool.query<{ user_id: string | null }>("SELECT user_id FROM client_api_keys WHERE id = $1", [metric.clientKeyId])).rows[0]?.user_id : null);
    if (userId) {
      await this.pool.query(
        `UPDATE users SET monthly_tokens = monthly_tokens + $1
         WHERE id = $2`,
        [metric.promptTokens + metric.completionTokens, userId],
      );
    }
  }

  async changeActiveStreams(delta: number) {
    const key = "service:active_streams";
    if (delta > 0) return this.redis.incrBy(key, delta);
    const value = await this.redis.decrBy(key, Math.abs(delta));
    if (value < 0) {
      await this.redis.set(key, "0");
      return 0;
    }
    return value;
  }

  private async keyUsage(id: string) {
    const [rpm, callsToday] = await Promise.all([
      this.redis.get(`quota:${id}:rpm:${minuteBucket()}`),
      this.redis.get(`quota:${id}:daily:${dayKey()}`),
    ]);
    return { rpmUsed: numberValue(rpm), callsToday: numberValue(callsToday) };
  }

  private async clientKeyViews(rows: Record<string, unknown>[]) {
    return Promise.all(rows.map(async (row) => {
      const usage = await this.keyUsage(String(row.id));
      return {
        id: String(row.id),
        name: String(row.name),
        prefix: String(row.prefix),
        status: String(row.status) as ClientKeyView["status"],
        rpmLimit: numberValue(row.rpm_limit),
        dailyLimit: numberValue(row.daily_limit),
        createdAt: isoValue(row.created_at),
        userId: row.user_id ? String(row.user_id) : null,
        ...usage,
      };
    }));
  }

  async listClientKeys() {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM client_api_keys ORDER BY created_at DESC");
    return this.clientKeyViews(result.rows);
  }

  async listUsers() {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM users ORDER BY created_at DESC");
    return result.rows.map(userFromRow);
  }

  async createUser(input: CreateUserInput) {
    const id = `usr_${randomUUID().slice(0, 12)}`;
    const passwordHash = await hashPassword(input.password);
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO users (id, email, password_hash, role, status, rpm_limit, daily_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, input.email.toLowerCase(), passwordHash, input.role, input.status, input.rpmLimit, input.dailyLimit],
    );
    return userFromRow(result.rows[0]);
  }

  async updateUser(id: string, patch: UpdateUserInput) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.status !== undefined) { values.push(patch.status); fields.push(`status = $${values.length}`); }
    if (patch.role !== undefined) { values.push(patch.role); fields.push(`role = $${values.length}`); }
    if (patch.rpmLimit !== undefined) { values.push(patch.rpmLimit); fields.push(`rpm_limit = $${values.length}`); }
    if (patch.dailyLimit !== undefined) { values.push(patch.dailyLimit); fields.push(`daily_limit = $${values.length}`); }
    if (patch.password !== undefined) {
      values.push(await hashPassword(patch.password));
      fields.push(`password_hash = $${values.length}`);
    }
    if (!fields.length) {
      const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM users WHERE id = $1", [id]);
      return result.rows[0] ? userFromRow(result.rows[0]) : undefined;
    }
    values.push(id);
    const result = await this.pool.query<Record<string, unknown>>(`UPDATE users SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
    return result.rows[0] ? userFromRow(result.rows[0]) : undefined;
  }

  async authenticateUser(email: string, password: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM users WHERE email = $1 AND status = 'active' LIMIT 1",
      [email.trim().toLowerCase()],
    );
    const row = result.rows[0];
    if (!row || !await verifyPassword(password, row.password_hash ? String(row.password_hash) : null)) return undefined;
    const user = userFromRow(row);
    return { id: user.id, email: user.email, role: user.role, status: user.status };
  }

  async createClientKey(input: { name: string; rpmLimit: number; dailyLimit: number; userId?: string | null }) {
    const secret = `ac_${randomUUID().replaceAll("-", "")}`;
    const id = `key_${randomUUID().slice(0, 12)}`;
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO client_api_keys (id, user_id, name, key_hash, prefix, rpm_limit, daily_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, input.userId ?? null, input.name, hashSecret(secret), secret.slice(0, 12), input.rpmLimit, input.dailyLimit],
    );
    return { data: (await this.clientKeyViews(result.rows))[0], secret };
  }

  async revokeClientKey(id: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      "UPDATE client_api_keys SET status = 'revoked' WHERE id = $1 RETURNING *",
      [id],
    );
    return result.rows[0] ? (await this.clientKeyViews(result.rows))[0] : undefined;
  }

  async listProviderKeys() {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM provider_keys ORDER BY provider, priority, created_at",
    );
    return result.rows.map(providerKeyFromRow);
  }

  async createProviderKey(input: ProviderKeyInput) {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO provider_keys (id, provider, label, endpoint, encrypted_secret, priority)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        `upk_${randomUUID().slice(0, 12)}`,
        input.provider,
        input.label,
        normalizeEndpoint(input.endpoint),
        this.encrypt(input.secret.trim()),
        input.priority,
      ],
    );
    return providerKeyFromRow(result.rows[0]);
  }

  async updateProviderKey(id: string, patch: ProviderKeyPatch) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.label !== undefined) { values.push(patch.label); fields.push(`label = $${values.length}`); }
    if (patch.endpoint !== undefined) { values.push(normalizeEndpoint(patch.endpoint)); fields.push(`endpoint = $${values.length}`); }
    if (patch.secret !== undefined) { values.push(this.encrypt(patch.secret.trim())); fields.push(`encrypted_secret = $${values.length}`); }
    if (patch.priority !== undefined) { values.push(patch.priority); fields.push(`priority = $${values.length}`); }
    if (patch.status !== undefined) { values.push(patch.status); fields.push(`status = $${values.length}`); }
    if (!fields.length) {
      const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM provider_keys WHERE id = $1", [id]);
      return result.rows[0] ? providerKeyFromRow(result.rows[0]) : undefined;
    }
    values.push(id);
    const result = await this.pool.query<Record<string, unknown>>(`UPDATE provider_keys SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
    return result.rows[0] ? providerKeyFromRow(result.rows[0]) : undefined;
  }

  async createModelRoute(route: ModelRoute) {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO model_routes (id, provider, upstream_model, label, description, ui_mode, aliases, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [route.id.toLowerCase(), route.provider, route.upstreamModel, route.label, route.description, route.uiMode, route.aliases.map((alias) => alias.toLowerCase()), route.enabled ?? true],
    );
    return modelFromRow(result.rows[0]);
  }

  async updateModelRoute(id: string, patch: ModelRoutePatch) {
    const fields: string[] = ["updated_at = NOW()"];
    const values: unknown[] = [];
    if (patch.provider !== undefined) { values.push(patch.provider); fields.push(`provider = $${values.length}`); }
    if (patch.upstreamModel !== undefined) { values.push(patch.upstreamModel); fields.push(`upstream_model = $${values.length}`); }
    if (patch.label !== undefined) { values.push(patch.label); fields.push(`label = $${values.length}`); }
    if (patch.description !== undefined) { values.push(patch.description); fields.push(`description = $${values.length}`); }
    if (patch.aliases !== undefined) { values.push(patch.aliases.map((alias) => alias.toLowerCase())); fields.push(`aliases = $${values.length}`); }
    if (patch.enabled !== undefined) { values.push(patch.enabled); fields.push(`enabled = $${values.length}`); }
    values.push(id);
    const result = await this.pool.query<Record<string, unknown>>(`UPDATE model_routes SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
    return result.rows[0] ? modelFromRow(result.rows[0]) : undefined;
  }

  async getRoutingStrategy() {
    const result = await this.pool.query<{ strategy: LoadBalanceStrategy }>("SELECT strategy FROM routing_settings WHERE id = 1");
    return result.rows[0]?.strategy ?? "round_robin";
  }

  async setRoutingStrategy(strategy: LoadBalanceStrategy) {
    await this.pool.query("UPDATE routing_settings SET strategy = $1, updated_at = NOW() WHERE id = 1", [strategy]);
    return strategy;
  }

  async listRoutingPolicies() {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM routing_policies ORDER BY scope, scope_id",
    );
    return result.rows.map((row) => ({
      scope: String(row.scope) as RoutingScope,
      scopeId: String(row.scope_id),
      keyIds: Array.isArray(row.key_ids) ? row.key_ids.map(String) : [],
      updatedAt: isoValue(row.updated_at),
    }));
  }

  async setRoutingPolicy(scope: RoutingScope, scopeId: string, keyIds: string[]) {
    const target = normalizePolicyScope(scope, scopeId);
    if (scope === "model") {
      const model = await this.pool.query("SELECT 1 FROM model_routes WHERE id = $1", [target]);
      if (!model.rowCount) throw new Error("The selected model mapping was not found.");
    }
    const normalizedIds = [...new Set(keyIds.map((id) => id.trim()).filter(Boolean))];
    if (!normalizedIds.length) return undefined;
    const keys = await this.pool.query("SELECT id FROM provider_keys WHERE id = ANY($1::text[])", [normalizedIds]);
    if (keys.rowCount !== normalizedIds.length) throw new Error("One or more selected provider keys were not found.");
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO routing_policies (scope, scope_id, key_ids, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (scope, scope_id)
       DO UPDATE SET key_ids = EXCLUDED.key_ids, updated_at = NOW()
       RETURNING *`,
      [scope, target, normalizedIds],
    );
    const row = result.rows[0];
    return {
      scope: String(row.scope) as RoutingScope,
      scopeId: String(row.scope_id),
      keyIds: Array.isArray(row.key_ids) ? row.key_ids.map(String) : [],
      updatedAt: isoValue(row.updated_at),
    } satisfies RoutingPolicy;
  }

  async deleteRoutingPolicy(scope: RoutingScope, scopeId: string) {
    const result = await this.pool.query(
      "DELETE FROM routing_policies WHERE scope = $1 AND scope_id = $2",
      [scope, normalizePolicyScope(scope, scopeId)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createFeedback(userId: string, input: CreateFeedbackInput) {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO feedbacks (id, user_id, message, category, app_version, locale)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *, (SELECT email FROM users WHERE id = feedbacks.user_id) AS user_email`,
      [
        `fb_${randomUUID().slice(0, 12)}`,
        userId,
        input.message.trim(),
        input.category,
        input.appVersion,
        input.locale,
      ],
    );
    return feedbackFromRow(result.rows[0]);
  }

  async listFeedbacks() {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT feedbacks.*, users.email AS user_email
       FROM feedbacks
       LEFT JOIN users ON users.id = feedbacks.user_id
       ORDER BY feedbacks.created_at DESC`,
    );
    return result.rows.map(feedbackFromRow);
  }

  async updateFeedbackStatus(id: string, status: FeedbackRecord["status"]) {
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE feedbacks SET status = $1
       WHERE id = $2
       RETURNING *, (SELECT email FROM users WHERE id = feedbacks.user_id) AS user_email`,
      [status, id],
    );
    return result.rows[0] ? feedbackFromRow(result.rows[0]) : undefined;
  }

  async getLatestAppVersion() {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM app_versions WHERE is_active = TRUE ORDER BY version_code DESC LIMIT 1",
    );
    return result.rows[0] ? appVersionFromRow(result.rows[0]) : undefined;
  }

  async listAppVersions() {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM app_versions ORDER BY version_code DESC",
    );
    return result.rows.map(appVersionFromRow);
  }

  async createAppVersion(input: CreateAppVersionInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.isActive) await client.query("UPDATE app_versions SET is_active = FALSE WHERE is_active = TRUE");
      const result = await client.query<Record<string, unknown>>(
        `INSERT INTO app_versions (id, version_code, version_name, download_url, release_notes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          `appv_${randomUUID().slice(0, 12)}`,
          input.versionCode,
          input.versionName,
          input.downloadUrl,
          input.releaseNotes,
          input.isActive,
        ],
      );
      await client.query("COMMIT");
      return appVersionFromRow(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateAppVersion(id: string, patch: Partial<Pick<AppVersion, "versionName" | "downloadUrl" | "releaseNotes" | "isActive">>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (patch.isActive) await client.query("UPDATE app_versions SET is_active = FALSE WHERE is_active = TRUE");
      const fields: string[] = [];
      const values: unknown[] = [];
      if (patch.versionName !== undefined) { values.push(patch.versionName); fields.push(`version_name = $${values.length}`); }
      if (patch.downloadUrl !== undefined) { values.push(patch.downloadUrl); fields.push(`download_url = $${values.length}`); }
      if (patch.releaseNotes !== undefined) { values.push(patch.releaseNotes); fields.push(`release_notes = $${values.length}`); }
      if (patch.isActive !== undefined) { values.push(patch.isActive); fields.push(`is_active = $${values.length}`); }
      if (!fields.length) {
        const existing = await client.query<Record<string, unknown>>("SELECT * FROM app_versions WHERE id = $1", [id]);
        await client.query("COMMIT");
        return existing.rows[0] ? appVersionFromRow(existing.rows[0]) : undefined;
      }
      values.push(id);
      const result = await client.query<Record<string, unknown>>(
        `UPDATE app_versions SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
        values,
      );
      await client.query("COMMIT");
      return result.rows[0] ? appVersionFromRow(result.rows[0]) : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getOverview(): Promise<Overview> {
    const [summaryResult, modelResult, models, keys, users, providerKeys, strategy, policies, activeStreams] = await Promise.all([
      this.pool.query<Record<string, unknown>>(
        `SELECT COUNT(*)::int AS total_requests,
          COUNT(*) FILTER (WHERE status = 'success')::int AS successful_requests,
          COUNT(*) FILTER (WHERE status = 'failure')::int AS failed_requests,
          COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens
         FROM request_logs`,
      ),
      this.pool.query<{ model_id: string; calls: string }>("SELECT model_id, COUNT(*)::int AS calls FROM request_logs GROUP BY model_id"),
      this.listModelRoutes(),
      this.listClientKeys(),
      this.listUsers(),
      this.listProviderKeys(),
      this.getRoutingStrategy(),
      this.listRoutingPolicies(),
      this.redis.get("service:active_streams"),
    ]);
    const summary = summaryResult.rows[0] ?? {};
    const modelCalls = Object.fromEntries(models.map((model) => [model.id, 0]));
    for (const row of modelResult.rows) modelCalls[row.model_id] = numberValue(row.calls);
    const totalRequests = numberValue(summary.total_requests);
    const successfulRequests = numberValue(summary.successful_requests);
    return {
      storage: "PostgreSQL + Redis",
      metrics: {
        totalRequests,
        successfulRequests,
        failedRequests: numberValue(summary.failed_requests),
        successRate: Math.round((successfulRequests / Math.max(1, totalRequests)) * 100),
        promptTokens: numberValue(summary.prompt_tokens),
        completionTokens: numberValue(summary.completion_tokens),
        modelCalls,
      },
      models,
      keys,
      users,
      providerKeys,
      routing: {
        strategy,
        channelPolicies: policies.filter((policy) => policy.scope === "channel"),
        modelPolicies: policies.filter((policy) => policy.scope === "model"),
      },
      activeStreams: numberValue(activeStreams),
    };
  }
}

export async function createPostgresControlPlane(options: {
  databaseUrl?: string;
  redisUrl?: string;
  encryptionSecret?: string;
} = {}) {
  const controlPlane = new PostgresControlPlane(
    options.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://adaptive_chat:adaptive_chat@localhost:5432/adaptive_chat",
    options.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    options.encryptionSecret,
  );
  await controlPlane.start();
  return controlPlane;
}
