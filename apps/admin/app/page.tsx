"use client";

import {
  Activity,
  ArrowRightLeft,
  Bot,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleX,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  KeyRound,
  Layers3,
  Link2,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";
import { createContext, type FormEvent, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Provider = "openai" | "gemini" | "deepseek";
type Strategy = "round_robin" | "random";
type Locale = "en" | "zh-CN";
type Section = "Overview" | "Users" | "Client keys" | "Provider keys" | "Routing" | "Feedback" | "App releases" | "Connections";

type ApiKey = {
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

type UserRecord = {
  id: string;
  email: string;
  role: "admin" | "standard";
  status: "active" | "suspended";
  monthlyTokens: number;
  rpmLimit: number;
  dailyLimit: number;
  createdAt: string;
};

type Model = {
  id: string;
  provider: Provider;
  upstreamModel: string;
  label: string;
  description: string;
  uiMode: "chatgpt" | "gemini" | "deepseek";
  aliases: string[];
  enabled: boolean;
  upstreamConfigured: boolean;
};

type ProviderKey = {
  id: string;
  provider: Provider;
  label: string;
  endpoint: string;
  priority: number;
  status: "active" | "disabled";
  createdAt: string;
  lastUsedAt: string | null;
};

type RoutingPolicy = {
  scope: "channel" | "model";
  scopeId: string;
  keyIds: string[];
  updatedAt: string;
};

type Feedback = {
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

type AppVersion = {
  id: string;
  versionCode: number;
  versionName: string;
  downloadUrl: string;
  releaseNotes: string;
  isActive: boolean;
  publishedAt: string;
};

type Overview = {
  generatedAt: string;
  storage: string;
  health: { status: string; activeStreams: number; uptimeSeconds: number };
  metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    promptTokens: number;
    completionTokens: number;
    modelCalls: Record<string, number>;
  };
  models: Model[];
  keys: ApiKey[];
  users: UserRecord[];
  providerKeys: ProviderKey[];
  routing: {
    strategy: Strategy;
    channelPolicies: RoutingPolicy[];
    modelPolicies: RoutingPolicy[];
  };
};

const sections: { name: Section; label: string; icon: typeof Activity }[] = [
  { name: "Overview", label: "navOverview", icon: Activity },
  { name: "Users", label: "navUsers", icon: Users },
  { name: "Client keys", label: "navClientKeys", icon: KeyRound },
  { name: "Provider keys", label: "navProviderKeys", icon: Database },
  { name: "Routing", label: "navRouting", icon: Layers3 },
  { name: "Feedback", label: "navFeedback", icon: MessageSquare },
  { name: "App releases", label: "navReleases", icon: Rocket },
  { name: "Connections", label: "navConnections", icon: Wifi },
];

type AdminCopy = Record<string, string>;

const englishCopy: AdminCopy = {
  formatLocale: "en-US", adminSections: "Admin sections", operationFailed: "The operation failed.", requestTimedOut: "The console request timed out. Check the gateway connection and try again.", unableLoadOperations: "Unable to load operational data.", unableLoadFeedback: "Unable to load feedback.", unableLoadReleases: "Unable to load app releases.", seconds: "s", minutes: "m", hours: "h", moveUp: "Move up", moveDown: "Move down", remove: "Remove",
  appName: "Adaptive Chat", controlRoom: "Control room", operations: "Operations", apiOnline: "API online", connecting: "Connecting", refresh: "Refresh operational data", retry: "Retry", loading: "Loading operations data",
  navOverview: "Overview", navUsers: "Users", navClientKeys: "Client keys", navProviderKeys: "Provider keys", navRouting: "Routing", navFeedback: "Feedback", navReleases: "App releases", navConnections: "Connections",
  requests: "Requests", persistentRequestLog: "Persistent request log", successRate: "Success rate", completed: "completed", tokenVolume: "Token volume", promptAndCompletion: "Prompt and completion", activeStreams: "Active streams", uptime: "Uptime",
  modelTraffic: "Model traffic", requestVolume: "Request volume by internal model name", routingState: "Routing state", upstreamAvailability: "Configured upstream availability", ready: "Ready", unconfigured: "Unconfigured", serviceState: "Service state", lastSampled: "Last sampled", providerKeys: "Provider keys", clientKeys: "Client keys", activeUsers: "Active users", failures: "Failures",
  createUser: "Create user", accountsAdminOnly: "Accounts are created only by an administrator", email: "Email", password: "Password", role: "Role", standard: "Standard", admin: "Admin", rpm: "RPM", dailyQuota: "Daily quota", userAccess: "User access", statusRoleQuota: "Status, role, and quotas", identity: "Identity", limits: "Limits", monthlyTokens: "Monthly tokens", status: "Status", suspend: "Suspend", restore: "Restore",
  issueClientKey: "Issue client key", secretHashed: "A secret is shown once and stored as a hash", name: "Name", user: "User", unassigned: "Unassigned", issueKey: "Issue key", newClientKey: "New client key", dismiss: "Dismiss", keyPoolClient: "Rate and daily quota usage are sourced from Redis", prefix: "Prefix", usage: "Usage", revoke: "Revoke",
  addProviderKey: "Add provider key", encryptedPostgres: "Secrets are encrypted before PostgreSQL storage", provider: "Provider", openAiCompatible: "OpenAI-compatible", label: "Label", endpoint: "Endpoint", secret: "Secret", priority: "Priority", addProvider: "Add provider key", keyPool: "Key pool", priorityDetail: "Lowest numeric priority is selected first; tied tiers use the routing strategy", lastUsed: "Last used", never: "Never", disable: "Disable", enable: "Enable",
  channelDefaults: "Channel defaults", channelDefaultsDetail: "Each ordered list is an explicit fallback chain. The first available key is used first.", modelOverrides: "Model overrides", modelOverridesDetail: "A model override takes precedence over its channel chain. Clear it to inherit the channel default.", customChain: "Custom chain", inheritsChannel: "Inherits channel", usesPriority: "Uses provider priority", noExplicitOrder: "No explicit key order.", addProviderKeyOption: "Add provider key", add: "Add", saveOrder: "Save order", clear: "Clear", priorityBalancing: "Priority-tier balancing", priorityBalancingDetail: "Used only when no explicit channel or model chain is configured.", roundRobin: "Round robin", randomized: "Randomized", current: "Current", modelMappings: "Model mappings", mappingDetail: "Internal names sent by clients are translated before upstream dispatch", upstreamModel: "Upstream model", addMapping: "Add mapping", addMappingDetail: "Expose a new internal model name without changing the mobile client", internalName: "Internal name", description: "Description", aliases: "Aliases",
  feedbackInbox: "Feedback inbox", feedbackDetail: "Messages are submitted by authenticated Android accounts and persisted in PostgreSQL.", message: "Message", account: "Account", context: "Context", received: "Received", noFeedback: "No feedback has been submitted.", unknown: "Unknown", new: "New", reviewed: "Reviewed", resolved: "Resolved",
  publishVersion: "Publish app version", publishVersionDetail: "The active release is returned by the Android update-check endpoint.", versionCode: "Version code", versionName: "Version name", apkUrl: "APK URL", releaseNotes: "Release notes", setActive: "Set active", publishRelease: "Publish release", publishedVersions: "Published versions", oneActiveVersion: "Only one version is active at a time.", version: "Version", download: "Download", notes: "Notes", published: "Published", apkLink: "APK link", activate: "Activate", active: "Active", noVersions: "No app versions have been published.", code: "Code",
  liveSse: "Live SSE", connectionsFlight: "Connections in flight", persistedSuccess: "Persisted successes", providerFailure: "Provider or relay failures", currentProcess: "Current process lifetime",
};

const chineseCopy: AdminCopy = {
  formatLocale: "zh-CN", adminSections: "管理控制台栏目", operationFailed: "操作失败。", requestTimedOut: "控制台请求超时。请检查网关连接后重试。", unableLoadOperations: "无法加载运行数据。", unableLoadFeedback: "无法加载反馈。", unableLoadReleases: "无法加载应用发布信息。", seconds: "秒", minutes: "分", hours: "时", moveUp: "上移", moveDown: "下移", remove: "移除",
  appName: "Adaptive Chat", controlRoom: "控制台", operations: "运维", apiOnline: "API 在线", connecting: "正在连接", refresh: "刷新运行数据", retry: "重试", loading: "正在加载运行数据",
  navOverview: "概览", navUsers: "用户", navClientKeys: "客户端密钥", navProviderKeys: "上游密钥", navRouting: "路由", navFeedback: "反馈", navReleases: "应用发布", navConnections: "连接",
  requests: "请求数", persistentRequestLog: "持久化请求日志", successRate: "成功率", completed: "已完成", tokenVolume: "令牌总量", promptAndCompletion: "提示词和补全", activeStreams: "活跃流", uptime: "运行时间",
  modelTraffic: "模型流量", requestVolume: "按内部模型名称统计的请求量", routingState: "路由状态", upstreamAvailability: "已配置上游可用性", ready: "就绪", unconfigured: "未配置", serviceState: "服务状态", lastSampled: "最近采样", providerKeys: "上游密钥", clientKeys: "客户端密钥", activeUsers: "活跃用户", failures: "失败数",
  createUser: "创建用户", accountsAdminOnly: "账户只能由管理员创建", email: "邮箱", password: "密码", role: "角色", standard: "普通用户", admin: "管理员", rpm: "每分钟请求", dailyQuota: "每日配额", userAccess: "用户权限", statusRoleQuota: "状态、角色与配额", identity: "身份", limits: "限制", monthlyTokens: "月度令牌", status: "状态", suspend: "停用", restore: "恢复",
  issueClientKey: "签发客户端密钥", secretHashed: "密钥只显示一次，数据库仅保存哈希", name: "名称", user: "用户", unassigned: "未分配", issueKey: "签发密钥", newClientKey: "新的客户端密钥", dismiss: "关闭", keyPoolClient: "每分钟和每日用量由 Redis 提供", prefix: "前缀", usage: "用量", revoke: "撤销",
  addProviderKey: "添加上游密钥", encryptedPostgres: "密钥在写入 PostgreSQL 前会加密", provider: "提供商", openAiCompatible: "OpenAI 兼容", label: "标签", endpoint: "端点", secret: "密钥", priority: "优先级", addProvider: "添加上游密钥", keyPool: "密钥池", priorityDetail: "数值更小的优先级先使用；相同优先级由路由策略决定", lastUsed: "最近使用", never: "从未", disable: "禁用", enable: "启用",
  channelDefaults: "频道默认路由", channelDefaultsDetail: "每个有序列表都是明确的回退链，会先使用第一个可用密钥。", modelOverrides: "模型覆盖", modelOverridesDetail: "模型覆盖优先于频道链，清除后继承频道默认值。", customChain: "自定义链", inheritsChannel: "继承频道", usesPriority: "使用提供商优先级", noExplicitOrder: "没有明确的密钥顺序。", addProviderKeyOption: "添加上游密钥", add: "添加", saveOrder: "保存顺序", clear: "清除", priorityBalancing: "优先级分层均衡", priorityBalancingDetail: "仅在未配置明确频道或模型链时使用。", roundRobin: "轮询", randomized: "随机", current: "当前", modelMappings: "模型映射", mappingDetail: "客户端发送的内部名称会在上游转发前进行转换", upstreamModel: "上游模型", addMapping: "添加映射", addMappingDetail: "无需变更移动端即可暴露新的内部模型名称", internalName: "内部名称", description: "描述", aliases: "别名",
  feedbackInbox: "反馈收件箱", feedbackDetail: "消息由已认证的 Android 账户提交并持久化到 PostgreSQL。", message: "内容", account: "账户", context: "上下文", received: "收到时间", noFeedback: "尚未收到反馈。", unknown: "未知", new: "新建", reviewed: "已查看", resolved: "已解决",
  publishVersion: "发布应用版本", publishVersionDetail: "Android 更新检查接口将返回当前激活的版本。", versionCode: "版本代码", versionName: "版本名称", apkUrl: "APK 地址", releaseNotes: "发布说明", setActive: "设为激活", publishRelease: "发布版本", publishedVersions: "已发布版本", oneActiveVersion: "任一时间只有一个激活版本。", version: "版本", download: "下载", notes: "说明", published: "发布时间", apkLink: "APK 链接", activate: "激活", active: "已激活", noVersions: "尚未发布应用版本。", code: "代码",
  liveSse: "实时 SSE", connectionsFlight: "传输中的连接", persistedSuccess: "已持久化成功请求", providerFailure: "提供商或中继失败", currentProcess: "当前进程运行时间",
};

const AdminCopyContext = createContext<AdminCopy>(englishCopy);
const useCopy = () => useContext(AdminCopyContext);

const requestTimeoutMs = 12_000;

function statusClass(status: string) {
  return status === "active" || status === "ok" || status === "success" ? "status status-good" : "status status-muted";
}

function secondsLabel(seconds: number, copy: AdminCopy) {
  if (seconds < 60) return `${seconds}${copy.seconds}`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}${copy.minutes}`;
  return `${Math.floor(seconds / 3_600)}${copy.hours}`;
}

function formatNumber(value: number, copy: AdminCopy) {
  return new Intl.NumberFormat(copy.formatLocale).format(value);
}

function formatCompactNumber(value: number, copy: AdminCopy) {
  return new Intl.NumberFormat(copy.formatLocale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string, copy: AdminCopy, includeTime = false) {
  return new Intl.DateTimeFormat(copy.formatLocale, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" },
  ).format(new Date(value));
}

function localizedConsoleError(message: string, copy: AdminCopy) {
  if (copy.formatLocale !== "zh-CN") return message;
  if (message === "The operation failed.") return copy.operationFailed;
  if (message === "The console request timed out. Check the gateway connection and try again.") return copy.requestTimedOut;
  if (message === "Unable to load operational data.") return copy.unableLoadOperations;
  if (message === "Unable to load feedback.") return copy.unableLoadFeedback;
  if (message === "Unable to load app releases.") return copy.unableLoadReleases;
  return message;
}

async function request<T>(path: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`/api/admin/${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? "The operation failed.");
    return payload;
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") {
      throw new Error("The console request timed out. Check the gateway connection and try again.");
    }
    throw reason;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function AdminPage() {
  const [section, setSection] = useState<Section>("Overview");
  const [locale, setLocale] = useState<Locale>("en");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [appVersions, setAppVersions] = useState<AppVersion[]>([]);
  const [userForm, setUserForm] = useState({ email: "", password: "", role: "standard", rpmLimit: "60", dailyLimit: "100000" });
  const [clientKeyForm, setClientKeyForm] = useState({ name: "", userId: "", rpmLimit: "60", dailyLimit: "100000" });
  const [providerForm, setProviderForm] = useState({ provider: "openai" as Provider, label: "", endpoint: "", secret: "", priority: "100" });
  const [mappingForm, setMappingForm] = useState({ id: "", provider: "openai" as Provider, upstreamModel: "", label: "", description: "", uiMode: "chatgpt", aliases: "" });
  const [appVersionForm, setAppVersionForm] = useState({ versionCode: "", versionName: "", downloadUrl: "", releaseNotes: "", isActive: true });
  const copy = locale === "zh-CN" ? chineseCopy : englishCopy;
  const activeSectionLabel = sections.find((item) => item.name === section)?.label ?? "navOverview";

  useEffect(() => {
    const saved = window.localStorage.getItem("adaptive-chat-admin-language") as Locale | null;
    if (saved === "en" || saved === "zh-CN") {
      setLocale(saved);
    } else if (navigator.language.toLowerCase().startsWith("zh")) {
      setLocale("zh-CN");
    }
  }, []);

  function changeLocale(value: Locale) {
    setLocale(value);
    window.localStorage.setItem("adaptive-chat-admin-language", value);
  }

  const loadOverview = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const payload = await request<Overview>("overview", { cache: "no-store" });
      setOverview(payload);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load operational data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    const timer = window.setInterval(() => void loadOverview(true), 15_000);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  const loadFeedbacks = useCallback(async () => {
    try {
      const payload = await request<{ data: Feedback[] }>("feedbacks", { cache: "no-store" });
      setFeedbacks(payload.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load feedback.");
    }
  }, []);

  const loadAppVersions = useCallback(async () => {
    try {
      const payload = await request<{ data: AppVersion[] }>("app-versions", { cache: "no-store" });
      setAppVersions(payload.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load app releases.");
    }
  }, []);

  useEffect(() => {
    if (section === "Feedback") void loadFeedbacks();
    if (section === "App releases") void loadAppVersions();
  }, [section, loadAppVersions, loadFeedbacks]);

  const modelTraffic = useMemo(() => {
    if (!overview) return [];
    const largest = Math.max(1, ...Object.values(overview.metrics.modelCalls));
    return overview.models.map((model) => ({
      ...model,
      calls: overview.metrics.modelCalls[model.id] ?? 0,
      width: `${Math.max(3, ((overview.metrics.modelCalls[model.id] ?? 0) / largest) * 100)}%`,
    }));
  }, [overview]);

  async function mutate(action: () => Promise<void>) {
    setSubmitting(true);
    try {
      await action();
      await loadOverview(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The operation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(async () => {
      await request("users", {
        method: "POST",
        body: JSON.stringify({
          email: userForm.email.trim(),
          password: userForm.password,
          role: userForm.role,
          rpmLimit: Number(userForm.rpmLimit),
          dailyLimit: Number(userForm.dailyLimit),
        }),
      });
      setUserForm({ email: "", password: "", role: "standard", rpmLimit: "60", dailyLimit: "100000" });
    });
  }

  function submitClientKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(async () => {
      const payload = await request<{ data: ApiKey; secret: string }>("api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: clientKeyForm.name.trim(),
          userId: clientKeyForm.userId || null,
          rpmLimit: Number(clientKeyForm.rpmLimit),
          dailyLimit: Number(clientKeyForm.dailyLimit),
        }),
      });
      setCreatedSecret(payload.secret);
      setClientKeyForm({ name: "", userId: "", rpmLimit: "60", dailyLimit: "100000" });
    });
  }

  function submitProviderKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(async () => {
      await request("provider-keys", {
        method: "POST",
        body: JSON.stringify({
          ...providerForm,
          label: providerForm.label.trim(),
          endpoint: providerForm.endpoint.trim(),
          secret: providerForm.secret.trim(),
          priority: Number(providerForm.priority),
        }),
      });
      setProviderForm({ provider: "openai", label: "", endpoint: "", secret: "", priority: "100" });
    });
  }

  function submitMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(async () => {
      await request("models", {
        method: "POST",
        body: JSON.stringify({
          ...mappingForm,
          id: mappingForm.id.trim().toLowerCase(),
          upstreamModel: mappingForm.upstreamModel.trim(),
          label: mappingForm.label.trim(),
          description: mappingForm.description.trim(),
          aliases: mappingForm.aliases.split(",").map((value) => value.trim()).filter(Boolean),
        }),
      });
      setMappingForm({ id: "", provider: "openai", upstreamModel: "", label: "", description: "", uiMode: "chatgpt", aliases: "" });
    });
  }

  function submitAppVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(async () => {
      await request("app-versions", {
        method: "POST",
        body: JSON.stringify({
          versionCode: Number(appVersionForm.versionCode),
          versionName: appVersionForm.versionName.trim(),
          downloadUrl: appVersionForm.downloadUrl.trim(),
          releaseNotes: appVersionForm.releaseNotes.trim(),
          isActive: appVersionForm.isActive,
        }),
      });
      setAppVersionForm({ versionCode: "", versionName: "", downloadUrl: "", releaseNotes: "", isActive: true });
      await loadAppVersions();
    });
  }

  return (
    <AdminCopyContext.Provider value={copy}>
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Bot size={20} strokeWidth={2.4} /></div>
          <div><strong>{copy.appName}</strong><span>{copy.controlRoom}</span></div>
        </div>
        <nav aria-label={copy.adminSections} className="nav-list">
          {sections.map(({ name, label, icon: Icon }) => (
            <button className={`nav-item ${section === name ? "nav-item-active" : ""}`} key={name} onClick={() => setSection(name)} type="button">
              <Icon size={18} /><span>{copy[label]}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><div className="environment-dot" /><span>{overview?.storage ?? copy.connecting}</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{copy.operations}</p><h1>{copy[activeSectionLabel]}</h1></div>
          <div className="topbar-actions">
            <select aria-label={copy.language} className="locale-select" onChange={(event) => changeLocale(event.target.value as Locale)} value={locale}><option value="en">English</option><option value="zh-CN">中文</option></select>
            {overview && <span className={statusClass(overview.health.status)}><CircleCheck size={14} /> {copy.apiOnline}</span>}
            <button aria-label={copy.refresh} className="icon-button" disabled={refreshing} onClick={() => void loadOverview(true)} title={copy.refresh} type="button">
              <RefreshCw className={refreshing ? "spin" : ""} size={18} />
            </button>
          </div>
        </header>

        <div className="content">
          {error && <div className="alert" role="alert"><CircleAlert size={18} /><span>{localizedConsoleError(error, copy)}</span><button onClick={() => void loadOverview()} type="button">{copy.retry}</button></div>}
          {loading && !overview ? <div className="loading"><LoaderCircle className="spin" size={22} /> {copy.loading}</div> : null}
          {overview && section === "Overview" && <OverviewPanel overview={overview} modelTraffic={modelTraffic} />}
          {overview && section === "Users" && <UsersPanel form={userForm} onChange={setUserForm} onSubmit={submitUser} onToggle={(user) => void mutate(() => request(`users/${user.id}`, { method: "PATCH", body: JSON.stringify({ status: user.status === "active" ? "suspended" : "active" }) }))} submitting={submitting} users={overview.users} />}
          {overview && section === "Client keys" && <ClientKeysPanel createdSecret={createdSecret} form={clientKeyForm} onChange={setClientKeyForm} onDismissSecret={() => setCreatedSecret(null)} onRevoke={(id) => void mutate(() => request(`api-keys/${id}`, { method: "DELETE" }))} onSubmit={submitClientKey} submitting={submitting} keys={overview.keys} users={overview.users} />}
          {overview && section === "Provider keys" && <ProviderKeysPanel form={providerForm} keys={overview.providerKeys} onChange={setProviderForm} onSubmit={submitProviderKey} onToggle={(key) => void mutate(() => request(`provider-keys/${key.id}`, { method: "PATCH", body: JSON.stringify({ status: key.status === "active" ? "disabled" : "active" }) }))} submitting={submitting} />}
          {overview && section === "Routing" && <RoutingPanel
            form={mappingForm}
            models={overview.models}
            keys={overview.providerKeys}
            channelPolicies={overview.routing.channelPolicies}
            modelPolicies={overview.routing.modelPolicies}
            onChange={setMappingForm}
            onSave={(id, patch) => void mutate(() => request(`models/${id}`, { method: "PATCH", body: JSON.stringify(patch) }))}
            onSetStrategy={(strategy) => void mutate(() => request("routing", { method: "PATCH", body: JSON.stringify({ strategy }) }))}
            onSavePolicy={(scope, scopeId, keyIds) => void mutate(() => request(`routing/${scope}/${encodeURIComponent(scopeId)}`, { method: "PATCH", body: JSON.stringify({ keyIds }) }))}
            onDeletePolicy={(scope, scopeId) => void mutate(() => request(`routing/${scope}/${encodeURIComponent(scopeId)}`, { method: "DELETE" }))}
            onSubmit={submitMapping}
            strategy={overview.routing.strategy}
            submitting={submitting}
          />}
          {overview && section === "Feedback" && <FeedbackPanel feedbacks={feedbacks} onSetStatus={(id, status) => void mutate(async () => { await request(`feedbacks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await loadFeedbacks(); })} submitting={submitting} />}
          {overview && section === "App releases" && <AppReleasesPanel form={appVersionForm} onChange={setAppVersionForm} onSetActive={(id) => void mutate(async () => { await request(`app-versions/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) }); await loadAppVersions(); })} onSubmit={submitAppVersion} submitting={submitting} versions={appVersions} />}
          {overview && section === "Connections" && <ConnectionsPanel overview={overview} />}
        </div>
      </section>
    </main>
    </AdminCopyContext.Provider>
  );
}

function OverviewPanel({ overview, modelTraffic }: { overview: Overview; modelTraffic: Array<Model & { calls: number; width: string }> }) {
  const copy = useCopy();
  return <>
    <div className="metrics-grid">
      <Metric icon={Activity} label={copy.requests} tone="teal" value={formatNumber(overview.metrics.totalRequests, copy)} detail={copy.persistentRequestLog} />
      <Metric icon={ShieldCheck} label={copy.successRate} tone="green" value={`${overview.metrics.successRate}%`} detail={`${formatNumber(overview.metrics.successfulRequests, copy)} ${copy.completed}`} />
      <Metric icon={Cpu} label={copy.tokenVolume} tone="orange" value={formatCompactNumber(overview.metrics.promptTokens + overview.metrics.completionTokens, copy)} detail={copy.promptAndCompletion} />
      <Metric icon={Link2} label={copy.activeStreams} tone="blue" value={formatNumber(overview.health.activeStreams, copy)} detail={`${copy.uptime} ${secondsLabel(overview.health.uptimeSeconds, copy)}`} />
    </div>
    <div className="two-column">
      <section className="data-section"><SectionHeading title={copy.modelTraffic} detail={copy.requestVolume} /><div className="traffic-list">{modelTraffic.map((model) => <div className="traffic-row" key={model.id}><div className="traffic-label"><span>{model.id}</span><strong>{formatNumber(model.calls, copy)}</strong></div><div className="bar-track"><div className="bar-fill" style={{ width: model.width }} /></div></div>)}</div></section>
      <section className="data-section"><SectionHeading title={copy.routingState} detail={copy.upstreamAvailability} /><div className="routing-summary">{modelTraffic.map((model) => <div className="routing-line" key={model.id}><div><strong>{model.label}</strong><span>{model.upstreamModel}</span></div><span className={model.upstreamConfigured ? "status status-good" : "status status-muted"}>{model.upstreamConfigured ? <CircleCheck size={14} /> : <CirclePause size={14} />}{model.upstreamConfigured ? copy.ready : copy.unconfigured}</span></div>)}</div></section>
    </div>
    <section className="data-section"><SectionHeading title={copy.serviceState} detail={`${copy.lastSampled} ${formatDate(overview.generatedAt, copy, true)}`} /><div className="state-grid"><div><span>{copy.providerKeys}</span><strong>{overview.providerKeys.filter((key) => key.status === "active").length}</strong></div><div><span>{copy.clientKeys}</span><strong>{overview.keys.filter((key) => key.status === "active").length}</strong></div><div><span>{copy.activeUsers}</span><strong>{overview.users.filter((user) => user.status === "active").length}</strong></div><div><span>{copy.failures}</span><strong>{formatNumber(overview.metrics.failedRequests, copy)}</strong></div></div></section>
  </>;
}

function UsersPanel({ form, onChange, onSubmit, onToggle, submitting, users }: { form: { email: string; password: string; role: string; rpmLimit: string; dailyLimit: string }; onChange: (value: { email: string; password: string; role: string; rpmLimit: string; dailyLimit: string }) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onToggle: (user: UserRecord) => void; submitting: boolean; users: UserRecord[] }) {
  const copy = useCopy();
  return <>
    <section className="data-section"><SectionHeading title={copy.createUser} detail={copy.accountsAdminOnly} /><form className="form-grid user-form" onSubmit={onSubmit}><label>{copy.email}<input type="email" required value={form.email} onChange={(event) => onChange({ ...form, email: event.target.value })} /></label><label>{copy.password}<input type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={(event) => onChange({ ...form, password: event.target.value })} /></label><label>{copy.role}<select value={form.role} onChange={(event) => onChange({ ...form, role: event.target.value })}><option value="standard">{copy.standard}</option><option value="admin">{copy.admin}</option></select></label><label>{copy.rpm}<input min="1" type="number" value={form.rpmLimit} onChange={(event) => onChange({ ...form, rpmLimit: event.target.value })} /></label><label>{copy.dailyQuota}<input min="1" type="number" value={form.dailyLimit} onChange={(event) => onChange({ ...form, dailyLimit: event.target.value })} /></label><button className="primary-button form-action" disabled={submitting} type="submit"><UserPlus size={16} />{copy.createUser}</button></form></section>
    <section className="data-section"><SectionHeading title={copy.userAccess} detail={copy.statusRoleQuota} /><div className="table-wrap"><table><thead><tr><th>{copy.identity}</th><th>{copy.role}</th><th>{copy.limits}</th><th>{copy.monthlyTokens}</th><th>{copy.status}</th><th /></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.email}</strong><span>{user.id}</span></td><td><span className="role-label">{user.role === "admin" ? copy.admin : copy.standard}</span></td><td>{user.rpmLimit} {copy.rpm}<span>{formatNumber(user.dailyLimit, copy)} {copy.dailyQuota}</span></td><td>{formatNumber(user.monthlyTokens, copy)}</td><td><span className={statusClass(user.status)}>{user.status === "active" ? <CircleCheck size={14} /> : <CirclePause size={14} />}{user.status === "active" ? copy.active : copy.suspend}</span></td><td><button className="small-button" onClick={() => onToggle(user)} type="button">{user.status === "active" ? copy.suspend : copy.restore}</button></td></tr>)}</tbody></table></div></section>
  </>;
}

function ClientKeysPanel({ createdSecret, form, keys, onChange, onDismissSecret, onRevoke, onSubmit, submitting, users }: { createdSecret: string | null; form: { name: string; userId: string; rpmLimit: string; dailyLimit: string }; keys: ApiKey[]; onChange: (value: { name: string; userId: string; rpmLimit: string; dailyLimit: string }) => void; onDismissSecret: () => void; onRevoke: (id: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitting: boolean; users: UserRecord[] }) {
  const copy = useCopy();
  return <>
    <section className="data-section"><SectionHeading title={copy.issueClientKey} detail={copy.secretHashed} /><form className="form-grid" onSubmit={onSubmit}><label>{copy.name}<input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></label><label>{copy.user}<select value={form.userId} onChange={(event) => onChange({ ...form, userId: event.target.value })}><option value="">{copy.unassigned}</option>{users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label><label>{copy.rpm}<input min="1" type="number" value={form.rpmLimit} onChange={(event) => onChange({ ...form, rpmLimit: event.target.value })} /></label><label>{copy.dailyQuota}<input min="1" type="number" value={form.dailyLimit} onChange={(event) => onChange({ ...form, dailyLimit: event.target.value })} /></label><button className="primary-button form-action" disabled={submitting} type="submit"><Plus size={16} />{copy.issueKey}</button></form></section>
    {createdSecret && <section className="secret-notice"><div><ShieldCheck size={19} /><span>{copy.newClientKey}</span></div><code>{createdSecret}</code><button className="icon-button" onClick={onDismissSecret} title={copy.dismiss} type="button"><CircleX size={17} /></button></section>}
    <section className="data-section"><SectionHeading title={copy.clientKeys} detail={copy.keyPoolClient} /><div className="table-wrap"><table><thead><tr><th>{copy.name}</th><th>{copy.prefix}</th><th>{copy.usage}</th><th>{copy.status}</th><th /></tr></thead><tbody>{keys.map((key) => <tr key={key.id}><td><strong>{key.name}</strong><span>{formatDate(key.createdAt, copy)}</span></td><td><code>{key.prefix}</code></td><td>{key.rpmUsed} / {key.rpmLimit} {copy.rpm}<span>{formatNumber(key.callsToday, copy)} / {formatNumber(key.dailyLimit, copy)} {copy.dailyQuota}</span></td><td><span className={statusClass(key.status)}>{key.status === "active" ? <CircleCheck size={14} /> : <CirclePause size={14} />}{key.status === "active" ? copy.active : copy.revoke}</span></td><td>{key.status === "active" && <button aria-label={`${copy.revoke} ${key.name}`} className="icon-button danger-button" onClick={() => onRevoke(key.id)} title={`${copy.revoke} ${key.name}`} type="button"><Trash2 size={17} /></button>}</td></tr>)}</tbody></table></div></section>
  </>;
}

function ProviderKeysPanel({ form, keys, onChange, onSubmit, onToggle, submitting }: { form: { provider: Provider; label: string; endpoint: string; secret: string; priority: string }; keys: ProviderKey[]; onChange: (value: { provider: Provider; label: string; endpoint: string; secret: string; priority: string }) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onToggle: (key: ProviderKey) => void; submitting: boolean }) {
  const copy = useCopy();
  return <>
    <section className="data-section"><SectionHeading title={copy.addProviderKey} detail={copy.encryptedPostgres} /><form className="form-grid provider-form" onSubmit={onSubmit}><label>{copy.provider}<select value={form.provider} onChange={(event) => onChange({ ...form, provider: event.target.value as Provider })}><option value="openai">{copy.openAiCompatible}</option><option value="gemini">Gemini</option><option value="deepseek">DeepSeek</option></select></label><label>{copy.label}<input required value={form.label} onChange={(event) => onChange({ ...form, label: event.target.value })} /></label><label className="wide-field">{copy.endpoint}<input required type="url" placeholder="https://provider.example/v1" value={form.endpoint} onChange={(event) => onChange({ ...form, endpoint: event.target.value })} /></label><label>{copy.secret}<input required type="password" autoComplete="new-password" value={form.secret} onChange={(event) => onChange({ ...form, secret: event.target.value })} /></label><label>{copy.priority}<input min="0" type="number" value={form.priority} onChange={(event) => onChange({ ...form, priority: event.target.value })} /></label><button className="primary-button form-action" disabled={submitting} type="submit"><Plus size={16} />{copy.addProvider}</button></form></section>
    <section className="data-section"><SectionHeading title={copy.keyPool} detail={copy.priorityDetail} /><div className="table-wrap"><table><thead><tr><th>{copy.provider}</th><th>{copy.label}</th><th>{copy.endpoint}</th><th>{copy.priority}</th><th>{copy.lastUsed}</th><th>{copy.status}</th><th /></tr></thead><tbody>{keys.map((key) => <tr key={key.id}><td><span className={`provider-tag provider-${key.provider}`}>{key.provider}</span></td><td><strong>{key.label}</strong></td><td><code>{key.endpoint}</code></td><td>{key.priority}</td><td>{key.lastUsedAt ? formatDate(key.lastUsedAt, copy, true) : copy.never}</td><td><span className={statusClass(key.status)}>{key.status === "active" ? <CircleCheck size={14} /> : <CirclePause size={14} />}{key.status === "active" ? copy.active : copy.disable}</span></td><td><button className="small-button" onClick={() => onToggle(key)} type="button">{key.status === "active" ? copy.disable : copy.enable}</button></td></tr>)}</tbody></table></div></section>
  </>;
}

function RoutingPanel({ channelPolicies, form, keys, modelPolicies, models, onChange, onDeletePolicy, onSave, onSavePolicy, onSetStrategy, onSubmit, strategy, submitting }: { channelPolicies: RoutingPolicy[]; form: { id: string; provider: Provider; upstreamModel: string; label: string; description: string; uiMode: string; aliases: string }; keys: ProviderKey[]; modelPolicies: RoutingPolicy[]; models: Model[]; onChange: (value: { id: string; provider: Provider; upstreamModel: string; label: string; description: string; uiMode: string; aliases: string }) => void; onDeletePolicy: (scope: RoutingPolicy["scope"], scopeId: string) => void; onSave: (id: string, patch: Partial<Pick<Model, "upstreamModel" | "enabled">>) => void; onSavePolicy: (scope: RoutingPolicy["scope"], scopeId: string, keyIds: string[]) => void; onSetStrategy: (strategy: Strategy) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; strategy: Strategy; submitting: boolean }) {
  const copy = useCopy();
  const channelNames: Array<{ id: "chatgpt" | "gemini" | "deepseek"; label: string }> = [
    { id: "chatgpt", label: "ChatGPT" },
    { id: "gemini", label: "Gemini" },
    { id: "deepseek", label: "DeepSeek" },
  ];
  const policyFor = (policies: RoutingPolicy[], scopeId: string) => policies.find((policy) => policy.scopeId === scopeId);
  return <>
    <section className="data-section"><SectionHeading title={copy.channelDefaults} detail={copy.channelDefaultsDetail} /><div className="policy-grid">{channelNames.map((channel) => <RoutingPolicyEditor key={channel.id} label={channel.label} scope="channel" scopeId={channel.id} policy={policyFor(channelPolicies, channel.id)} keys={keys} onSave={onSavePolicy} onDelete={onDeletePolicy} disabled={submitting} />)}</div></section>
    <section className="data-section"><SectionHeading title={copy.modelOverrides} detail={copy.modelOverridesDetail} /><div className="policy-grid model-policy-grid">{models.map((model) => <RoutingPolicyEditor key={model.id} label={`${model.id} (${model.label})`} scope="model" scopeId={model.id} policy={policyFor(modelPolicies, model.id)} keys={keys} onSave={onSavePolicy} onDelete={onDeletePolicy} disabled={submitting} />)}</div></section>
    <section className="data-section"><SectionHeading title={copy.priorityBalancing} detail={copy.priorityBalancingDetail} /><div className="strategy-row"><div className="segmented" role="group" aria-label={copy.navRouting}><button className={strategy === "round_robin" ? "segment-active" : ""} disabled={submitting} onClick={() => onSetStrategy("round_robin")} type="button"><ArrowRightLeft size={16} />{copy.roundRobin}</button><button className={strategy === "random" ? "segment-active" : ""} disabled={submitting} onClick={() => onSetStrategy("random")} type="button">{copy.randomized}</button></div><span className="strategy-note">{copy.current}: {strategy === "round_robin" ? copy.roundRobin : copy.randomized}</span></div></section>
    <section className="data-section"><SectionHeading title={copy.modelMappings} detail={copy.mappingDetail} /><div className="mapping-list">{models.map((model) => <article className="mapping-row" key={model.id}><div className={`provider-swatch provider-${model.uiMode}`}>{model.label.slice(0, 1)}</div><div className="mapping-copy"><strong>{model.id}</strong><span>{model.provider} · {model.label}</span></div><label className="mapping-input"><span>{copy.upstreamModel}</span><input defaultValue={model.upstreamModel} key={`${model.id}-${model.upstreamModel}`} onBlur={(event) => { if (event.target.value !== model.upstreamModel) onSave(model.id, { upstreamModel: event.target.value }); }} /></label><button className={`small-button ${model.enabled ? "" : "button-muted"}`} onClick={() => onSave(model.id, { enabled: !model.enabled })} type="button">{model.enabled ? copy.disable : copy.enable}</button></article>)}</div></section>
    <section className="data-section"><SectionHeading title={copy.addMapping} detail={copy.addMappingDetail} /><form className="form-grid mapping-form" onSubmit={onSubmit}><label>{copy.internalName}<input required placeholder="gemini-fast" value={form.id} onChange={(event) => onChange({ ...form, id: event.target.value })} /></label><label>{copy.provider}<select value={form.provider} onChange={(event) => { const provider = event.target.value as Provider; onChange({ ...form, provider, uiMode: provider === "openai" ? "chatgpt" : provider }); }}><option value="openai">{copy.openAiCompatible}</option><option value="gemini">Gemini</option><option value="deepseek">DeepSeek</option></select></label><label>{copy.upstreamModel}<input required value={form.upstreamModel} onChange={(event) => onChange({ ...form, upstreamModel: event.target.value })} /></label><label>{copy.label}<input required value={form.label} onChange={(event) => onChange({ ...form, label: event.target.value })} /></label><label className="wide-field">{copy.description}<input required value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} /></label><label>{copy.aliases}<input placeholder="alias-one, alias-two" value={form.aliases} onChange={(event) => onChange({ ...form, aliases: event.target.value })} /></label><button className="primary-button form-action" disabled={submitting} type="submit"><Plus size={16} />{copy.addMapping}</button></form></section>
  </>;
}

function RoutingPolicyEditor({ disabled, keys, label, onDelete, onSave, policy, scope, scopeId }: { disabled: boolean; keys: ProviderKey[]; label: string; onDelete: (scope: RoutingPolicy["scope"], scopeId: string) => void; onSave: (scope: RoutingPolicy["scope"], scopeId: string, keyIds: string[]) => void; policy?: RoutingPolicy; scope: RoutingPolicy["scope"]; scopeId: string }) {
  const copy = useCopy();
  const [keyIds, setKeyIds] = useState<string[]>(policy?.keyIds ?? []);
  const [pendingKeyId, setPendingKeyId] = useState("");
  useEffect(() => setKeyIds(policy?.keyIds ?? []), [policy?.scopeId, policy?.updatedAt]);
  const selectedKeys = keyIds.map((id) => keys.find((key) => key.id === id)).filter((key): key is ProviderKey => Boolean(key));
  const availableKeys = keys.filter((key) => key.status === "active" && !keyIds.includes(key.id));
  const move = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= keyIds.length) return;
    const updated = [...keyIds];
    [updated[index], updated[destination]] = [updated[destination], updated[index]];
    setKeyIds(updated);
  };
  return <article className="policy-editor">
    <div className="policy-heading"><strong>{label}</strong><span>{policy ? copy.customChain : scope === "model" ? copy.inheritsChannel : copy.usesPriority}</span></div>
    <div className="policy-list">{selectedKeys.length ? selectedKeys.map((key, index) => <div className="policy-key" key={key.id}><span className="policy-index">{index + 1}</span><span className={`provider-tag provider-${key.provider}`}>{key.provider}</span><strong>{key.label}</strong><span className={key.status === "active" ? "status status-good" : "status status-muted"}>{key.status === "active" ? copy.active : copy.disable}</span><div className="policy-actions"><button aria-label={`${copy.moveUp} ${key.label}`} className="icon-button" disabled={disabled || index === 0} onClick={() => move(index, -1)} title={copy.moveUp} type="button"><ChevronUp size={16} /></button><button aria-label={`${copy.moveDown} ${key.label}`} className="icon-button" disabled={disabled || index === selectedKeys.length - 1} onClick={() => move(index, 1)} title={copy.moveDown} type="button"><ChevronDown size={16} /></button><button aria-label={`${copy.remove} ${key.label}`} className="icon-button danger-button" disabled={disabled} onClick={() => setKeyIds(keyIds.filter((id) => id !== key.id))} title={copy.remove} type="button"><CircleX size={16} /></button></div></div>) : <div className="policy-empty">{copy.noExplicitOrder}</div>}</div>
    <div className="policy-controls"><select aria-label={`${copy.addProviderKeyOption} ${label}`} disabled={disabled || !availableKeys.length} value={pendingKeyId} onChange={(event) => setPendingKeyId(event.target.value)}><option value="">{copy.addProviderKeyOption}</option>{availableKeys.map((key) => <option key={key.id} value={key.id}>{key.label} ({key.provider})</option>)}</select><button className="small-button" disabled={disabled || !pendingKeyId} onClick={() => { setKeyIds([...keyIds, pendingKeyId]); setPendingKeyId(""); }} type="button"><Plus size={15} />{copy.add}</button><button className="primary-button" disabled={disabled || !keyIds.length} onClick={() => onSave(scope, scopeId, keyIds)} type="button">{copy.saveOrder}</button>{policy && <button className="small-button" disabled={disabled} onClick={() => onDelete(scope, scopeId)} type="button">{copy.clear}</button>}</div>
  </article>;
}

function FeedbackPanel({ feedbacks, onSetStatus, submitting }: { feedbacks: Feedback[]; onSetStatus: (id: string, status: Feedback["status"]) => void; submitting: boolean }) {
  const copy = useCopy();
  return <section className="data-section"><SectionHeading title={copy.feedbackInbox} detail={copy.feedbackDetail} /><div className="table-wrap"><table><thead><tr><th>{copy.message}</th><th>{copy.account}</th><th>{copy.context}</th><th>{copy.received}</th><th>{copy.status}</th></tr></thead><tbody>{feedbacks.length ? feedbacks.map((feedback) => <tr key={feedback.id}><td className="feedback-message"><strong>{feedback.message}</strong><span>{feedback.category}</span></td><td>{feedback.userEmail ?? feedback.userId}</td><td>{feedback.appVersion || copy.unknown}<span>{feedback.locale}</span></td><td>{formatDate(feedback.createdAt, copy, true)}</td><td><select aria-label={`${copy.status} ${feedback.id}`} disabled={submitting} value={feedback.status} onChange={(event) => onSetStatus(feedback.id, event.target.value as Feedback["status"])}><option value="new">{copy.new}</option><option value="reviewed">{copy.reviewed}</option><option value="resolved">{copy.resolved}</option></select></td></tr>) : <tr><td colSpan={5} className="empty-table">{copy.noFeedback}</td></tr>}</tbody></table></div></section>;
}

function AppReleasesPanel({ form, onChange, onSetActive, onSubmit, submitting, versions }: { form: { versionCode: string; versionName: string; downloadUrl: string; releaseNotes: string; isActive: boolean }; onChange: (value: { versionCode: string; versionName: string; downloadUrl: string; releaseNotes: string; isActive: boolean }) => void; onSetActive: (id: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitting: boolean; versions: AppVersion[] }) {
  const copy = useCopy();
  return <>
    <section className="data-section"><SectionHeading title={copy.publishVersion} detail={copy.publishVersionDetail} /><form className="form-grid release-form" onSubmit={onSubmit}><label>{copy.versionCode}<input min="1" required type="number" value={form.versionCode} onChange={(event) => onChange({ ...form, versionCode: event.target.value })} /></label><label>{copy.versionName}<input required placeholder="1.1.0" value={form.versionName} onChange={(event) => onChange({ ...form, versionName: event.target.value })} /></label><label className="wide-field">{copy.apkUrl}<input required type="url" placeholder="https://downloads.example.com/adaptive-chat.apk" value={form.downloadUrl} onChange={(event) => onChange({ ...form, downloadUrl: event.target.value })} /></label><label className="wide-field">{copy.releaseNotes}<input value={form.releaseNotes} onChange={(event) => onChange({ ...form, releaseNotes: event.target.value })} /></label><label className="checkbox-label"><input checked={form.isActive} onChange={(event) => onChange({ ...form, isActive: event.target.checked })} type="checkbox" />{copy.setActive}</label><button className="primary-button form-action" disabled={submitting} type="submit"><Rocket size={16} />{copy.publishRelease}</button></form></section>
    <section className="data-section"><SectionHeading title={copy.publishedVersions} detail={copy.oneActiveVersion} /><div className="table-wrap"><table><thead><tr><th>{copy.version}</th><th>{copy.download}</th><th>{copy.notes}</th><th>{copy.published}</th><th>{copy.status}</th></tr></thead><tbody>{versions.length ? versions.map((version) => <tr key={version.id}><td><strong>{version.versionName}</strong><span>{copy.code} {version.versionCode}</span></td><td><a href={version.downloadUrl} rel="noreferrer" target="_blank">{copy.apkLink}</a></td><td className="release-notes">{version.releaseNotes || "-"}</td><td>{formatDate(version.publishedAt, copy, true)}</td><td>{version.isActive ? <span className="status status-good"><CircleCheck size={14} />{copy.active}</span> : <button className="small-button" disabled={submitting} onClick={() => onSetActive(version.id)} type="button">{copy.activate}</button>}</td></tr>) : <tr><td colSpan={5} className="empty-table">{copy.noVersions}</td></tr>}</tbody></table></div></section>
  </>;
}

function ConnectionsPanel({ overview }: { overview: Overview }) {
  const copy = useCopy();
  return <div className="metrics-grid connection-grid"><Metric icon={Wifi} label={copy.liveSse} tone="blue" value={formatNumber(overview.health.activeStreams, copy)} detail={copy.connectionsFlight} /><Metric icon={CircleCheck} label={copy.completed} tone="green" value={formatNumber(overview.metrics.successfulRequests, copy)} detail={copy.persistedSuccess} /><Metric icon={CircleX} label={copy.failures} tone="orange" value={formatNumber(overview.metrics.failedRequests, copy)} detail={copy.providerFailure} /><Metric icon={Activity} label={copy.uptime} tone="teal" value={secondsLabel(overview.health.uptimeSeconds, copy)} detail={copy.currentProcess} /></div>;
}

function Metric({ icon: Icon, label, tone, value, detail }: { icon: typeof Activity; label: string; tone: string; value: string; detail: string }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-icon"><Icon size={18} /></div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{detail}</p></div></div>;
}
