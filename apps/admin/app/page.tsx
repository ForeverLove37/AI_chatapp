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
  Mail,
  Hammer,
  HardDrive,
  BookOpen,
  Play,
  Save,
  Send,
  Workflow,
  MessageSquare,
  Pencil,
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

type Provider = string;
type Strategy = "round_robin" | "random";
type Locale = "en" | "zh-CN";
type Section = "Overview" | "Users" | "Client keys" | "Provider keys" | "Routing" | "Email" | "Channels" | "Groups & builds" | "Backups & recovery" | "Jobs" | "Feedback" | "App releases" | "Connections";

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

type UserEditForm = {
  password: string;
  role: UserRecord["role"];
  status: UserRecord["status"];
  rpmLimit: string;
  dailyLimit: string;
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
  { name: "Email", label: "navEmail", icon: Mail },
  { name: "Channels", label: "navChannels", icon: Workflow },
  { name: "Groups & builds", label: "navGroupsBuilds", icon: Hammer },
  { name: "Backups & recovery", label: "navBackups", icon: HardDrive },
  { name: "Jobs", label: "navJobs", icon: Activity },
  { name: "Feedback", label: "navFeedback", icon: MessageSquare },
  { name: "App releases", label: "navReleases", icon: Rocket },
  { name: "Connections", label: "navConnections", icon: Wifi },
];

type AdminCopy = Record<string, string>;

const englishCopy: AdminCopy = {
  formatLocale: "en-US", adminSections: "Admin sections", operationFailed: "The operation failed.", requestTimedOut: "The console request timed out. Check the gateway connection and try again.", unableLoadOperations: "Unable to load operational data.", unableLoadFeedback: "Unable to load feedback.", unableLoadReleases: "Unable to load app releases.", seconds: "s", minutes: "m", hours: "h", moveUp: "Move up", moveDown: "Move down", remove: "Remove",
  appName: "Adaptive Chat", controlRoom: "Control room", operations: "Operations", apiOnline: "API online", connecting: "Connecting", refresh: "Refresh operational data", retry: "Retry", loading: "Loading operations data",
  navOverview: "Overview", navUsers: "Users", navClientKeys: "Client keys", navProviderKeys: "Provider keys", navRouting: "Routing", navEmail: "Email", navChannels: "Channel builder", navGroupsBuilds: "Groups & builds", navBackups: "Backup & recovery", navJobs: "Worker jobs", navFeedback: "Feedback", navReleases: "App releases", navConnections: "Connections",
  requests: "Requests", persistentRequestLog: "Persistent request log", successRate: "Success rate", completed: "completed", tokenVolume: "Token volume", promptAndCompletion: "Prompt and completion", activeStreams: "Active streams", uptime: "Uptime",
  modelTraffic: "Model traffic", requestVolume: "Request volume by internal model name", routingState: "Routing state", upstreamAvailability: "Configured upstream availability", ready: "Ready", unconfigured: "Unconfigured", serviceState: "Service state", lastSampled: "Last sampled", providerKeys: "Provider keys", clientKeys: "Client keys", activeUsers: "Active users", failures: "Failures",
  createUser: "Create user", accountsAdminOnly: "Accounts are created only by an administrator", email: "Email", password: "Password", role: "Role", standard: "Standard", admin: "Admin", rpm: "RPM", dailyQuota: "Daily quota", userAccess: "User access", statusRoleQuota: "Status, role, and quotas", identity: "Identity", limits: "Limits", monthlyTokens: "Monthly tokens", status: "Status", suspend: "Suspend", restore: "Restore", edit: "Edit", editUser: "Edit user", resetPassword: "Reset password", leavePasswordBlank: "Leave blank to keep the current password", saveChanges: "Save changes", cancel: "Cancel",
  issueClientKey: "Issue client key", secretHashed: "A secret is shown once and stored as a hash", name: "Name", user: "User", unassigned: "Unassigned", issueKey: "Issue key", newClientKey: "New client key", dismiss: "Dismiss", keyPoolClient: "Rate and daily quota usage are sourced from Redis", prefix: "Prefix", usage: "Usage", revoke: "Revoke",
  addProviderKey: "Add provider key", encryptedPostgres: "Secrets are encrypted before PostgreSQL storage", provider: "Provider", openAiCompatible: "OpenAI-compatible", label: "Label", endpoint: "Endpoint", secret: "Secret", priority: "Priority", addProvider: "Add provider key", keyPool: "Key pool", priorityDetail: "Lowest numeric priority is selected first; tied tiers use the routing strategy", lastUsed: "Last used", never: "Never", disable: "Disable", enable: "Enable",
  channelDefaults: "Channel defaults", channelDefaultsDetail: "Each ordered list is an explicit fallback chain. The first available key is used first.", modelOverrides: "Model overrides", modelOverridesDetail: "A model override takes precedence over its channel chain. Clear it to inherit the channel default.", customChain: "Custom chain", inheritsChannel: "Inherits channel", usesPriority: "Uses provider priority", noExplicitOrder: "No explicit key order.", addProviderKeyOption: "Add provider key", add: "Add", saveOrder: "Save order", clear: "Clear", priorityBalancing: "Priority-tier balancing", priorityBalancingDetail: "Used only when no explicit channel or model chain is configured.", roundRobin: "Round robin", randomized: "Randomized", current: "Current", modelMappings: "Model mappings", mappingDetail: "Internal names sent by clients are translated before upstream dispatch", upstreamModel: "Upstream model", addMapping: "Add mapping", addMappingDetail: "Expose a new internal model name without changing the mobile client", internalName: "Internal name", description: "Description", aliases: "Aliases",
  feedbackInbox: "Feedback inbox", feedbackDetail: "Messages are submitted by authenticated Android accounts and persisted in PostgreSQL.", message: "Message", account: "Account", context: "Context", received: "Received", noFeedback: "No feedback has been submitted.", unknown: "Unknown", new: "New", reviewed: "Reviewed", resolved: "Resolved",
  publishVersion: "Publish app version", publishVersionDetail: "The active release is returned by the Android update-check endpoint.", versionCode: "Version code", versionName: "Version name", apkUrl: "APK URL", releaseNotes: "Release notes", setActive: "Set active", publishRelease: "Publish release", publishedVersions: "Published versions", oneActiveVersion: "Only one version is active at a time.", version: "Version", download: "Download", notes: "Notes", published: "Published", apkLink: "APK link", activate: "Activate", active: "Active", noVersions: "No app versions have been published.", code: "Code",
  liveSse: "Live SSE", connectionsFlight: "Connections in flight", persistedSuccess: "Persisted successes", providerFailure: "Provider or relay failures", currentProcess: "Current process lifetime",
  smtpTitle: "SMTP email", smtpDetail: "Security alerts and announcements are delivered asynchronously", templates: "HTML templates", preview: "Sandboxed preview", sendTest: "Send test", channelBuilder: "No-code channel builder", channelBuilderDetail: "Publish native channel styling and upstream mappings without an Android release", livePreview: "Native live preview", groupsTitle: "User groups", groupsDetail: "Control beta and production OTA audiences", buildPipeline: "Android deployment pipeline", buildBeta: "Build Beta", publishProduction: "Publish Production", backupDestinations: "Backup destinations", backupDetail: "Encrypted PostgreSQL snapshots to local, WebDAV, or S3 storage", recoveryGuide: "Restoration guide", workerJobs: "Background jobs", workerDetail: "Redis-backed execution history and logs", trigger: "Run now", save: "Save", delete: "Delete", enabled: "Enabled", disabled: "Disabled",
};

const chineseCopy: AdminCopy = {
  formatLocale: "zh-CN", adminSections: "管理控制台栏目", operationFailed: "操作失败。", requestTimedOut: "控制台请求超时。请检查网关连接后重试。", unableLoadOperations: "无法加载运行数据。", unableLoadFeedback: "无法加载反馈。", unableLoadReleases: "无法加载应用发布信息。", seconds: "秒", minutes: "分", hours: "时", moveUp: "上移", moveDown: "下移", remove: "移除",
  appName: "Adaptive Chat", controlRoom: "控制台", operations: "运维", apiOnline: "API 在线", connecting: "正在连接", refresh: "刷新运行数据", retry: "重试", loading: "正在加载运行数据",
  navOverview: "概览", navUsers: "用户", navClientKeys: "客户端密钥", navProviderKeys: "上游密钥", navRouting: "路由", navEmail: "邮件", navChannels: "频道构建器", navGroupsBuilds: "用户组与构建", navBackups: "备份与恢复", navJobs: "后台任务", navFeedback: "反馈", navReleases: "应用发布", navConnections: "连接",
  requests: "请求数", persistentRequestLog: "持久化请求日志", successRate: "成功率", completed: "已完成", tokenVolume: "令牌总量", promptAndCompletion: "提示词和补全", activeStreams: "活跃流", uptime: "运行时间",
  modelTraffic: "模型流量", requestVolume: "按内部模型名称统计的请求量", routingState: "路由状态", upstreamAvailability: "已配置上游可用性", ready: "就绪", unconfigured: "未配置", serviceState: "服务状态", lastSampled: "最近采样", providerKeys: "上游密钥", clientKeys: "客户端密钥", activeUsers: "活跃用户", failures: "失败数",
  createUser: "创建用户", accountsAdminOnly: "账户只能由管理员创建", email: "邮箱", password: "密码", role: "角色", standard: "普通用户", admin: "管理员", rpm: "每分钟请求", dailyQuota: "每日配额", userAccess: "用户权限", statusRoleQuota: "状态、角色与配额", identity: "身份", limits: "限制", monthlyTokens: "月度令牌", status: "状态", suspend: "停用", restore: "恢复", edit: "编辑", editUser: "编辑用户", resetPassword: "重置密码", leavePasswordBlank: "留空则保留当前密码", saveChanges: "保存更改", cancel: "取消",
  issueClientKey: "签发客户端密钥", secretHashed: "密钥只显示一次，数据库仅保存哈希", name: "名称", user: "用户", unassigned: "未分配", issueKey: "签发密钥", newClientKey: "新的客户端密钥", dismiss: "关闭", keyPoolClient: "每分钟和每日用量由 Redis 提供", prefix: "前缀", usage: "用量", revoke: "撤销",
  addProviderKey: "添加上游密钥", encryptedPostgres: "密钥在写入 PostgreSQL 前会加密", provider: "提供商", openAiCompatible: "OpenAI 兼容", label: "标签", endpoint: "端点", secret: "密钥", priority: "优先级", addProvider: "添加上游密钥", keyPool: "密钥池", priorityDetail: "数值更小的优先级先使用；相同优先级由路由策略决定", lastUsed: "最近使用", never: "从未", disable: "禁用", enable: "启用",
  channelDefaults: "频道默认路由", channelDefaultsDetail: "每个有序列表都是明确的回退链，会先使用第一个可用密钥。", modelOverrides: "模型覆盖", modelOverridesDetail: "模型覆盖优先于频道链，清除后继承频道默认值。", customChain: "自定义链", inheritsChannel: "继承频道", usesPriority: "使用提供商优先级", noExplicitOrder: "没有明确的密钥顺序。", addProviderKeyOption: "添加上游密钥", add: "添加", saveOrder: "保存顺序", clear: "清除", priorityBalancing: "优先级分层均衡", priorityBalancingDetail: "仅在未配置明确频道或模型链时使用。", roundRobin: "轮询", randomized: "随机", current: "当前", modelMappings: "模型映射", mappingDetail: "客户端发送的内部名称会在上游转发前进行转换", upstreamModel: "上游模型", addMapping: "添加映射", addMappingDetail: "无需变更移动端即可暴露新的内部模型名称", internalName: "内部名称", description: "描述", aliases: "别名",
  feedbackInbox: "反馈收件箱", feedbackDetail: "消息由已认证的 Android 账户提交并持久化到 PostgreSQL。", message: "内容", account: "账户", context: "上下文", received: "收到时间", noFeedback: "尚未收到反馈。", unknown: "未知", new: "新建", reviewed: "已查看", resolved: "已解决",
  publishVersion: "发布应用版本", publishVersionDetail: "Android 更新检查接口将返回当前激活的版本。", versionCode: "版本代码", versionName: "版本名称", apkUrl: "APK 地址", releaseNotes: "发布说明", setActive: "设为激活", publishRelease: "发布版本", publishedVersions: "已发布版本", oneActiveVersion: "任一时间只有一个激活版本。", version: "版本", download: "下载", notes: "说明", published: "发布时间", apkLink: "APK 链接", activate: "激活", active: "已激活", noVersions: "尚未发布应用版本。", code: "代码",
  liveSse: "实时 SSE", connectionsFlight: "传输中的连接", persistedSuccess: "已持久化成功请求", providerFailure: "提供商或中继失败", currentProcess: "当前进程运行时间",
  smtpTitle: "SMTP 邮件", smtpDetail: "安全提醒和公告通过异步队列发送", templates: "HTML 模板", preview: "沙箱预览", sendTest: "发送测试", channelBuilder: "无代码频道构建器", channelBuilderDetail: "无需发布 Android 版本即可配置原生样式与上游映射", livePreview: "原生实时预览", groupsTitle: "用户组", groupsDetail: "控制 Beta 与生产 OTA 受众", buildPipeline: "Android 部署流水线", buildBeta: "构建 Beta", publishProduction: "发布生产版", backupDestinations: "备份目标", backupDetail: "将加密 PostgreSQL 快照保存到本地、WebDAV 或 S3", recoveryGuide: "恢复指南", workerJobs: "后台任务", workerDetail: "Redis 队列执行历史与日志", trigger: "立即运行", save: "保存", delete: "删除", enabled: "启用", disabled: "禁用",
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
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [userEditForm, setUserEditForm] = useState<UserEditForm>({ password: "", role: "standard", status: "active", rpmLimit: "60", dailyLimit: "100000" });
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

  function openUserEditor(user: UserRecord) {
    setEditingUser(user);
    setUserEditForm({
      password: "",
      role: user.role,
      status: user.status,
      rpmLimit: String(user.rpmLimit),
      dailyLimit: String(user.dailyLimit),
    });
  }

  async function submitUserEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;
    setSubmitting(true);
    try {
      const patch: Record<string, string | number> = {
        role: userEditForm.role,
        status: userEditForm.status,
        rpmLimit: Number(userEditForm.rpmLimit),
        dailyLimit: Number(userEditForm.dailyLimit),
      };
      if (userEditForm.password.trim()) patch.password = userEditForm.password;
      await request(`users/${editingUser.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setEditingUser(null);
      await loadOverview(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The operation failed.");
    } finally {
      setSubmitting(false);
    }
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
          {overview && section === "Users" && <><UsersPanel form={userForm} onChange={setUserForm} onSubmit={submitUser} onToggle={(user) => void mutate(() => request(`users/${user.id}`, { method: "PATCH", body: JSON.stringify({ status: user.status === "active" ? "suspended" : "active" }) }))} onEdit={openUserEditor} submitting={submitting} users={overview.users} />{editingUser && <UserEditDialog form={userEditForm} onChange={setUserEditForm} onClose={() => setEditingUser(null)} onSubmit={submitUserEdit} submitting={submitting} user={editingUser} />}</>}
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
          {overview && section === "Email" && <EmailPanel />}
          {overview && section === "Channels" && <ChannelBuilderPanel />}
          {overview && section === "Groups & builds" && <GroupsBuildsPanel users={overview.users} />}
          {overview && section === "Backups & recovery" && <BackupsPanel />}
          {overview && section === "Jobs" && <JobsPanel />}
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

function UsersPanel({ form, onChange, onSubmit, onToggle, onEdit, submitting, users }: { form: { email: string; password: string; role: string; rpmLimit: string; dailyLimit: string }; onChange: (value: { email: string; password: string; role: string; rpmLimit: string; dailyLimit: string }) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onToggle: (user: UserRecord) => void; onEdit: (user: UserRecord) => void; submitting: boolean; users: UserRecord[] }) {
  const copy = useCopy();
  return <>
    <section className="data-section"><SectionHeading title={copy.createUser} detail={copy.accountsAdminOnly} /><form className="form-grid user-form" onSubmit={onSubmit}><label>{copy.email}<input type="email" required value={form.email} onChange={(event) => onChange({ ...form, email: event.target.value })} /></label><label>{copy.password}<input type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={(event) => onChange({ ...form, password: event.target.value })} /></label><label>{copy.role}<select value={form.role} onChange={(event) => onChange({ ...form, role: event.target.value })}><option value="standard">{copy.standard}</option><option value="admin">{copy.admin}</option></select></label><label>{copy.rpm}<input min="1" type="number" value={form.rpmLimit} onChange={(event) => onChange({ ...form, rpmLimit: event.target.value })} /></label><label>{copy.dailyQuota}<input min="1" type="number" value={form.dailyLimit} onChange={(event) => onChange({ ...form, dailyLimit: event.target.value })} /></label><button className="primary-button form-action" disabled={submitting} type="submit"><UserPlus size={16} />{copy.createUser}</button></form></section>
    <section className="data-section"><SectionHeading title={copy.userAccess} detail={copy.statusRoleQuota} /><div className="table-wrap"><table><thead><tr><th>{copy.identity}</th><th>{copy.role}</th><th>{copy.limits}</th><th>{copy.monthlyTokens}</th><th>{copy.status}</th><th /></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.email}</strong><span>{user.id}</span></td><td><span className="role-label">{user.role === "admin" ? copy.admin : copy.standard}</span></td><td>{user.rpmLimit} {copy.rpm}<span>{formatNumber(user.dailyLimit, copy)} {copy.dailyQuota}</span></td><td>{formatNumber(user.monthlyTokens, copy)}</td><td><span className={statusClass(user.status)}>{user.status === "active" ? <CircleCheck size={14} /> : <CirclePause size={14} />}{user.status === "active" ? copy.active : copy.suspend}</span></td><td><div className="table-actions"><button className="small-button" onClick={() => onEdit(user)} type="button"><Pencil size={14} />{copy.edit}</button><button className="small-button" onClick={() => onToggle(user)} type="button">{user.status === "active" ? copy.suspend : copy.restore}</button></div></td></tr>)}</tbody></table></div></section>
  </>;
}

function UserEditDialog({ form, onChange, onClose, onSubmit, submitting, user }: { form: UserEditForm; onChange: (value: UserEditForm) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitting: boolean; user: UserRecord }) {
  const copy = useCopy();
  return <div aria-modal="true" className="dialog-backdrop" role="dialog"><form className="dialog-card" onSubmit={onSubmit}><div className="dialog-heading"><div><h2>{copy.editUser}</h2><p>{user.email}</p></div><button aria-label={copy.cancel} className="icon-button" onClick={onClose} type="button"><CircleX size={18} /></button></div><div className="form-grid user-form"><label>{copy.resetPassword}<input autoComplete="new-password" minLength={8} placeholder={copy.leavePasswordBlank} type="password" value={form.password} onChange={(event) => onChange({ ...form, password: event.target.value })} /></label><label>{copy.role}<select value={form.role} onChange={(event) => onChange({ ...form, role: event.target.value as UserRecord["role"] })}><option value="standard">{copy.standard}</option><option value="admin">{copy.admin}</option></select></label><label>{copy.status}<select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as UserRecord["status"] })}><option value="active">{copy.active}</option><option value="suspended">{copy.suspend}</option></select></label><label>{copy.rpm}<input min="1" required type="number" value={form.rpmLimit} onChange={(event) => onChange({ ...form, rpmLimit: event.target.value })} /></label><label>{copy.dailyQuota}<input min="1" required type="number" value={form.dailyLimit} onChange={(event) => onChange({ ...form, dailyLimit: event.target.value })} /></label></div><div className="dialog-actions"><button className="small-button" onClick={onClose} type="button">{copy.cancel}</button><button className="primary-button" disabled={submitting} type="submit"><Pencil size={16} />{copy.saveChanges}</button></div></form></div>;
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

type EmailSettings = { host: string; port: number; secure: boolean; username: string; fromEmail: string; fromName: string; enabled: boolean; passwordConfigured: boolean; updatedAt: string };
type EmailTemplate = { id: string; trigger: "suspicious_login" | "announcement" | "version_update"; name: string; subject: string; htmlBody: string; enabled: boolean; updatedAt: string };
type DynamicChannel = { id: string; slug: string; displayName: string; description: string; provider: string; providerKeyId: string | null; iconDataUrl: string; backgroundStart: string; backgroundEnd: string; accentColor: string; textColor: string; surfaceColor: string; typography: "sans" | "serif" | "mono"; animatedGradient: boolean; models: DynamicModel[]; enabled: boolean; sortOrder: number; updatedAt: string };
type DynamicModel = { id: string; label: string; description: string; upstreamModel: string };
type UserGroup = { id: string; slug: string; name: string; description: string; releaseRing: "beta" | "production"; memberCount: number; createdAt: string; updatedAt: string };
type BackgroundJob = { id: string; type: "email" | "backup" | "build"; status: string; payload: Record<string, unknown>; result: Record<string, unknown> | null; error: string | null; attempts: number; maxAttempts: number; logs: string[]; createdAt: string; startedAt: string | null; finishedAt: string | null };
type BackupDestination = { id: string; name: string; protocol: "local" | "webdav" | "s3"; scheduleCron: string; enabled: boolean; localDirectory: string; webdavUrl: string; s3Endpoint: string; s3Region: string; s3Bucket: string; s3Prefix: string; s3ForcePathStyle: boolean; credentialsConfigured: boolean; lastScheduledAt: string | null; updatedAt: string };

function InlineError({ message }: { message: string | null }) {
  return message ? <div className="alert enterprise-alert" role="alert"><CircleAlert size={17} /><span>{message}</span></div> : null;
}

function EmailPanel() {
  const copy = useCopy();
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [password, setPassword] = useState("");
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTrigger, setSelectedTrigger] = useState<EmailTemplate["trigger"]>("suspicious_login");
  const [preview, setPreview] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [announcement, setAnnouncement] = useState({ title: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = templates.find((template) => template.trigger === selectedTrigger);

  const load = useCallback(async () => {
    try {
      const [smtp, templatePayload] = await Promise.all([
        request<{ data: EmailSettings }>("email/settings"),
        request<{ data: EmailTemplate[] }>("email/templates"),
      ]);
      setSettings(smtp.data);
      setTemplates(templatePayload.data);
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); }
  }, [copy.operationFailed]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    const variables = selected.trigger === "suspicious_login"
      ? { email: "owner@example.com", ip: "203.0.113.42", time: new Date().toISOString(), userAgent: "Adaptive Chat / Android" }
      : selected.trigger === "announcement"
        ? { title: announcement.title || "Product announcement", message: announcement.message || "A concise update for Adaptive Chat users." }
        : { versionName: "2.0.0-beta", releaseNotes: "Faster channels and resilient backups.", downloadUrl: "https://chatapi.zengjunjie.com/downloads/adaptive-chat.apk" };
    const timer = window.setTimeout(() => {
      void request<{ data: { subject: string; html: string } }>("email/preview", {
        method: "POST",
        body: JSON.stringify({ trigger: selected.trigger, subject: selected.subject, htmlBody: selected.htmlBody, variables }),
      }).then((payload) => setPreview(payload.data.html)).catch((reason) => setError(reason instanceof Error ? reason.message : copy.operationFailed));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [announcement.message, announcement.title, copy.operationFailed, selected]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); }
    finally { setBusy(false); }
  }

  if (!settings || !selected) return <div className="loading"><LoaderCircle className="spin" size={20} />{copy.loading}</div>;
  return <div className="enterprise-stack">
    <InlineError message={error} />
    <section className="data-section"><SectionHeading title={copy.smtpTitle} detail={copy.smtpDetail} />
      <form className="form-grid enterprise-form" onSubmit={(event) => { event.preventDefault(); void perform(async () => {
        const payload = await request<{ data: EmailSettings }>("email/settings", { method: "PUT", body: JSON.stringify({ ...settings, password: password || undefined }) });
        setSettings(payload.data); setPassword("");
      }); }}>
        <label>SMTP host<input required={settings.enabled} value={settings.host} onChange={(event) => setSettings({ ...settings, host: event.target.value })} /></label>
        <label>Port<input min="1" max="65535" type="number" value={settings.port} onChange={(event) => setSettings({ ...settings, port: Number(event.target.value) })} /></label>
        <label>Username<input autoComplete="off" value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} /></label>
        <label>Password<input autoComplete="new-password" placeholder={settings.passwordConfigured ? "Configured - leave blank to keep" : "SMTP password"} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Sender email<input required={settings.enabled} type="email" value={settings.fromEmail} onChange={(event) => setSettings({ ...settings, fromEmail: event.target.value })} /></label>
        <label>Sender name<input required value={settings.fromName} onChange={(event) => setSettings({ ...settings, fromName: event.target.value })} /></label>
        <label className="checkbox-label"><input checked={settings.secure} type="checkbox" onChange={(event) => setSettings({ ...settings, secure: event.target.checked })} />Implicit TLS</label>
        <label className="checkbox-label"><input checked={settings.enabled} type="checkbox" onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />{copy.enabled}</label>
        <button className="primary-button form-action" disabled={busy} type="submit"><Save size={16} />{copy.save}</button>
      </form>
      <div className="inline-command"><input aria-label="Test recipient" placeholder="recipient@example.com" type="email" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} /><button className="small-button" disabled={busy || !testRecipient} onClick={() => void perform(async () => { await request("email/test", { method: "POST", body: JSON.stringify({ to: testRecipient }) }); })} type="button"><Send size={15} />{copy.sendTest}</button></div>
    </section>
    <div className="enterprise-two-column">
      <section className="data-section"><SectionHeading title={copy.templates} detail="{{variables}} are escaped before insertion" />
        <div className="segmented wrap-segments">{templates.map((template) => <button className={selectedTrigger === template.trigger ? "segment-active" : ""} key={template.id} onClick={() => setSelectedTrigger(template.trigger)} type="button">{template.name}</button>)}</div>
        <div className="stacked-form">
          <label>Subject<input value={selected.subject} onChange={(event) => setTemplates(templates.map((item) => item.id === selected.id ? { ...item, subject: event.target.value } : item))} /></label>
          <label>HTML<textarea rows={16} value={selected.htmlBody} onChange={(event) => setTemplates(templates.map((item) => item.id === selected.id ? { ...item, htmlBody: event.target.value } : item))} /></label>
          <label className="checkbox-label"><input checked={selected.enabled} type="checkbox" onChange={(event) => setTemplates(templates.map((item) => item.id === selected.id ? { ...item, enabled: event.target.checked } : item))} />{copy.enabled}</label>
          <button className="primary-button" disabled={busy} onClick={() => void perform(async () => { await request(`email/templates/${selected.trigger}`, { method: "PATCH", body: JSON.stringify({ subject: selected.subject, htmlBody: selected.htmlBody, enabled: selected.enabled }) }); await load(); })} type="button"><Save size={16} />{copy.save}</button>
        </div>
      </section>
      <section className="data-section preview-section"><SectionHeading title={copy.preview} detail="Scripts, forms, and top navigation are disabled" /><iframe className="email-preview" sandbox="" srcDoc={preview} title={copy.preview} /></section>
    </div>
    <section className="data-section"><SectionHeading title="Announcement dispatch" detail="Queue a rendered message for every active account" /><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await request("email/announcements", { method: "POST", body: JSON.stringify(announcement) }); setAnnouncement({ title: "", message: "" }); }); }}><label>Title<input required value={announcement.title} onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })} /></label><label className="wide-field">Message<input required value={announcement.message} onChange={(event) => setAnnouncement({ ...announcement, message: event.target.value })} /></label><button className="primary-button form-action" disabled={busy} type="submit"><Send size={16} />Send announcement</button></form></section>
  </div>;
}

const emptyChannelForm = {
  slug: "", displayName: "", description: "", provider: "", endpoint: "", secret: "", priority: "100", iconDataUrl: "",
  backgroundStart: "#FFF3A6", backgroundEnd: "#FFE066", accentColor: "#B7791F", textColor: "#2D2600", surfaceColor: "#FFFFFF",
  typography: "sans" as DynamicChannel["typography"], animatedGradient: true, enabled: true, sortOrder: "100",
  models: [{ id: "", label: "Standard", description: "", upstreamModel: "" }] as DynamicModel[],
};

function ChannelBuilderPanel() {
  const copy = useCopy();
  const [channels, setChannels] = useState<DynamicChannel[]>([]);
  const [form, setForm] = useState(emptyChannelForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setChannels((await request<{ data: DynamicChannel[] }>("dynamic-channels")).data); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); }
  }, [copy.operationFailed]);
  useEffect(() => { void load(); }, [load]);

  function edit(channel: DynamicChannel) {
    setEditingId(channel.id);
    setForm({ ...channel, endpoint: "", secret: "", priority: "100", sortOrder: String(channel.sortOrder), models: channel.models.map((model) => ({ ...model })) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const payload = { ...form, priority: Number(form.priority), sortOrder: Number(form.sortOrder), endpoint: form.endpoint || undefined, secret: form.secret || undefined };
      await request(editingId ? `dynamic-channels/${editingId}` : "dynamic-channels", { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setForm(emptyChannelForm); setEditingId(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); }
    finally { setBusy(false); }
  }

  return <div className="enterprise-stack"><InlineError message={error} />
    <div className="enterprise-two-column channel-layout">
      <section className="data-section"><SectionHeading title={copy.channelBuilder} detail={copy.channelBuilderDetail} />
        <form className="stacked-form" onSubmit={submit}>
          <div className="form-grid"><label>Channel ID<input disabled={Boolean(editingId)} pattern="[a-z0-9._-]+" required placeholder="qwen" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase(), provider: form.provider || event.target.value.toLowerCase() })} /></label><label>Display name<input required placeholder="Qwen" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label>Provider ID<input disabled={Boolean(editingId)} required placeholder="qwen" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value.toLowerCase() })} /></label><label>Priority<input min="0" type="number" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} /></label><label className="wide-field">Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label className="wide-field">OpenAI-compatible endpoint<input required={!editingId} type="url" placeholder={editingId ? "Leave blank to keep current endpoint" : "https://provider.example/v1"} value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} /></label><label>API key<input required={!editingId} type="password" autoComplete="new-password" placeholder={editingId ? "Leave blank to keep" : "Server-only secret"} value={form.secret} onChange={(event) => setForm({ ...form, secret: event.target.value })} /></label><label>Typography<select value={form.typography} onChange={(event) => setForm({ ...form, typography: event.target.value as DynamicChannel["typography"] })}><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option></select></label></div>
          <div className="color-grid">{(["backgroundStart", "backgroundEnd", "accentColor", "textColor", "surfaceColor"] as const).map((key) => <label key={key}>{key}<input type="color" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value.toUpperCase() })} /></label>)}</div>
          <label>Channel icon<input accept="image/png,image/jpeg,image/webp" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (!file || file.size > 1_000_000) { if (file) setError("Icons must be smaller than 1 MB."); return; } const reader = new FileReader(); reader.onload = () => setForm({ ...form, iconDataUrl: String(reader.result ?? "") }); reader.readAsDataURL(file); }} /></label>
          <label className="checkbox-label"><input checked={form.animatedGradient} type="checkbox" onChange={(event) => setForm({ ...form, animatedGradient: event.target.checked })} />Animated gradient</label>
          <div className="model-builder"><strong>Models</strong>{form.models.map((model, index) => <div className="model-builder-row" key={index}><input aria-label="Internal model ID" placeholder="qwen-standard" required value={model.id} onChange={(event) => setForm({ ...form, models: form.models.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value.toLowerCase() } : item) })} /><input aria-label="Model label" placeholder="Standard" required value={model.label} onChange={(event) => setForm({ ...form, models: form.models.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} /><input aria-label="Upstream model" placeholder="qwen-max" required value={model.upstreamModel} onChange={(event) => setForm({ ...form, models: form.models.map((item, itemIndex) => itemIndex === index ? { ...item, upstreamModel: event.target.value } : item) })} /><button aria-label="Remove model" className="icon-button danger-button" disabled={form.models.length === 1} onClick={() => setForm({ ...form, models: form.models.filter((_item, itemIndex) => itemIndex !== index) })} type="button"><Trash2 size={16} /></button></div>)}<button className="small-button" onClick={() => setForm({ ...form, models: [...form.models, { id: "", label: "", description: "", upstreamModel: "" }] })} type="button"><Plus size={15} />Add model</button></div>
          <div className="form-actions"><button className="primary-button" disabled={busy} type="submit"><Save size={16} />{editingId ? "Update channel" : "Publish channel"}</button>{editingId && <button className="small-button" onClick={() => { setEditingId(null); setForm(emptyChannelForm); }} type="button">{copy.cancel}</button>}</div>
        </form>
      </section>
      <section className="data-section sticky-preview"><SectionHeading title={copy.livePreview} detail="The Android client consumes these exact style tokens" /><div className={`native-preview ${form.animatedGradient ? "native-preview-animated" : ""}`} style={{ backgroundImage: `linear-gradient(135deg, ${form.backgroundStart}, ${form.backgroundEnd})`, color: form.textColor, fontFamily: form.typography === "mono" ? "monospace" : form.typography === "serif" ? "serif" : "sans-serif" }}><div className="native-preview-header">{form.iconDataUrl ? <img alt="" src={form.iconDataUrl} /> : <Bot size={24} color={form.accentColor} />}<div><strong>{form.displayName || "New channel"}</strong><span>{form.models[0]?.label || "Model"}</span></div></div><div className="native-preview-message" style={{ background: form.surfaceColor }}>How can I help?</div><div className="native-preview-composer" style={{ background: form.surfaceColor, borderColor: form.accentColor }}><span>Message {form.displayName || "channel"}</span><Send color={form.accentColor} size={18} /></div></div></section>
    </div>
    <section className="data-section"><SectionHeading title="Published dynamic channels" detail="Changes appear after the Android app refreshes configuration" /><div className="channel-list">{channels.map((channel) => <article className="channel-row" key={channel.id}><div className="channel-icon" style={{ background: channel.backgroundStart }}>{channel.iconDataUrl ? <img alt="" src={channel.iconDataUrl} /> : <Bot size={20} />}</div><div><strong>{channel.displayName}</strong><span>{channel.slug} · {channel.models.map((model) => model.label).join(", ")}</span></div><span className={channel.enabled ? "status status-good" : "status status-muted"}>{channel.enabled ? copy.enabled : copy.disabled}</span><button className="small-button" onClick={() => edit(channel)} type="button"><Pencil size={14} />{copy.edit}</button><button className="small-button" onClick={() => void request(`dynamic-channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !channel.enabled }) }).then(load)} type="button">{channel.enabled ? copy.disable : copy.enable}</button><button aria-label={`${copy.delete} ${channel.displayName}`} className="icon-button danger-button" onClick={() => void request(`dynamic-channels/${channel.id}`, { method: "DELETE" }).then(load)} type="button"><Trash2 size={16} /></button></article>)}</div></section>
  </div>;
}

function GroupsBuildsPanel({ users }: { users: UserRecord[] }) {
  const copy = useCopy();
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [memberships, setMemberships] = useState<Record<string, string[]>>({});
  const [groupForm, setGroupForm] = useState({ slug: "", name: "", description: "", releaseRing: "production" as UserGroup["releaseRing"] });
  const [buildForm, setBuildForm] = useState({ versionCode: "", versionName: "", releaseNotes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { const payload = await request<{ data: UserGroup[]; memberships: Record<string, string[]> }>("user-groups"); setGroups(payload.data); setMemberships(payload.memberships); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); } }, [copy.operationFailed]);
  useEffect(() => { void load(); }, [load]);
  async function saveMembership(userId: string, groupId: string, checked: boolean) { const current = memberships[userId] ?? []; const next = checked ? [...new Set([...current, groupId])] : current.filter((id) => id !== groupId); setMemberships({ ...memberships, [userId]: next }); try { await request(`users/${userId}/groups`, { method: "PUT", body: JSON.stringify({ groupIds: next }) }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); } }
  async function queueBuild(ring: "beta" | "production") { setBusy(true); setError(null); try { await request(`builds/${ring}`, { method: "POST", body: JSON.stringify({ versionCode: Number(buildForm.versionCode), versionName: buildForm.versionName, releaseNotes: buildForm.releaseNotes }) }); } catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); } finally { setBusy(false); } }
  return <div className="enterprise-stack"><InlineError message={error} /><section className="data-section"><SectionHeading title={copy.groupsTitle} detail={copy.groupsDetail} /><form className="form-grid" onSubmit={(event) => { event.preventDefault(); setBusy(true); void request("user-groups", { method: "POST", body: JSON.stringify(groupForm) }).then(() => { setGroupForm({ slug: "", name: "", description: "", releaseRing: "production" }); return load(); }).catch((reason) => setError(reason instanceof Error ? reason.message : copy.operationFailed)).finally(() => setBusy(false)); }}><label>Group ID<input required value={groupForm.slug} onChange={(event) => setGroupForm({ ...groupForm, slug: event.target.value.toLowerCase() })} /></label><label>{copy.name}<input required value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} /></label><label>Release ring<select value={groupForm.releaseRing} onChange={(event) => setGroupForm({ ...groupForm, releaseRing: event.target.value as UserGroup["releaseRing"] })}><option value="production">Production</option><option value="beta">Beta</option></select></label><label className="wide-field">{copy.description}<input value={groupForm.description} onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })} /></label><button className="primary-button form-action" disabled={busy} type="submit"><Plus size={16} />Create group</button></form>
      <div className="group-chips">{groups.map((group) => <div className="group-chip" key={group.id}><strong>{group.name}</strong><span>{group.releaseRing} · {group.memberCount} members</span></div>)}</div>
      <div className="table-wrap"><table><thead><tr><th>{copy.user}</th>{groups.map((group) => <th key={group.id}>{group.name}</th>)}</tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.email}</strong></td>{groups.map((group) => <td key={group.id}><input aria-label={`${user.email} ${group.name}`} checked={(memberships[user.id] ?? []).includes(group.id)} type="checkbox" onChange={(event) => void saveMembership(user.id, group.id, event.target.checked)} /></td>)}</tr>)}</tbody></table></div>
    </section><section className="data-section"><SectionHeading title={copy.buildPipeline} detail="Builds run outside the API process and publish ring-scoped OTA metadata" /><div className="form-grid"><label>{copy.versionCode}<input min="1" type="number" value={buildForm.versionCode} onChange={(event) => setBuildForm({ ...buildForm, versionCode: event.target.value })} /></label><label>{copy.versionName}<input placeholder="2.0.0-beta.1" value={buildForm.versionName} onChange={(event) => setBuildForm({ ...buildForm, versionName: event.target.value })} /></label><label className="wide-field">{copy.releaseNotes}<input value={buildForm.releaseNotes} onChange={(event) => setBuildForm({ ...buildForm, releaseNotes: event.target.value })} /></label><button className="small-button form-action" disabled={busy || !buildForm.versionCode || !buildForm.versionName} onClick={() => void queueBuild("beta")} type="button"><Hammer size={16} />{copy.buildBeta}</button><button className="primary-button form-action" disabled={busy || !buildForm.versionCode || !buildForm.versionName} onClick={() => void queueBuild("production")} type="button"><Rocket size={16} />{copy.publishProduction}</button></div></section></div>;
}

const emptyBackupForm = { name: "", protocol: "local" as BackupDestination["protocol"], scheduleCron: "0 2 * * *", enabled: true, localDirectory: "/backups", webdavUrl: "", s3Endpoint: "", s3Region: "us-east-1", s3Bucket: "", s3Prefix: "adaptive-chat", s3ForcePathStyle: false, encryptionPassphrase: "", username: "", password: "", accessKeyId: "", secretAccessKey: "" };

function BackupsPanel() {
  const copy = useCopy();
  const [destinations, setDestinations] = useState<BackupDestination[]>([]);
  const [form, setForm] = useState(emptyBackupForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setDestinations((await request<{ data: BackupDestination[] }>("backups")).data); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); } }, [copy.operationFailed]);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(null); try { const { encryptionPassphrase, username, password, accessKeyId, secretAccessKey, ...destination } = form; await request("backups", { method: "POST", body: JSON.stringify({ ...destination, credentials: { encryptionPassphrase, username: username || undefined, password: password || undefined, accessKeyId: accessKeyId || undefined, secretAccessKey: secretAccessKey || undefined } }) }); setForm(emptyBackupForm); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); } finally { setBusy(false); } }
  return <div className="enterprise-stack"><InlineError message={error} /><section className="data-section"><SectionHeading title={copy.backupDestinations} detail={copy.backupDetail} /><form className="form-grid backup-form" onSubmit={submit}><label>{copy.name}<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Protocol<select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as BackupDestination["protocol"] })}><option value="local">Local volume</option><option value="webdav">WebDAV</option><option value="s3">S3 compatible</option></select></label><label>Schedule (UTC cron)<input required value={form.scheduleCron} onChange={(event) => setForm({ ...form, scheduleCron: event.target.value })} /></label>{form.protocol === "local" && <label className="wide-field">Directory<input required value={form.localDirectory} onChange={(event) => setForm({ ...form, localDirectory: event.target.value })} /></label>}{form.protocol === "webdav" && <><label className="wide-field">WebDAV URL<input required type="url" value={form.webdavUrl} onChange={(event) => setForm({ ...form, webdavUrl: event.target.value })} /></label><label>Username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label><label>Password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label></>}{form.protocol === "s3" && <><label>S3 endpoint<input type="url" value={form.s3Endpoint} onChange={(event) => setForm({ ...form, s3Endpoint: event.target.value })} /></label><label>Region<input required value={form.s3Region} onChange={(event) => setForm({ ...form, s3Region: event.target.value })} /></label><label>Bucket<input required value={form.s3Bucket} onChange={(event) => setForm({ ...form, s3Bucket: event.target.value })} /></label><label>Prefix<input value={form.s3Prefix} onChange={(event) => setForm({ ...form, s3Prefix: event.target.value })} /></label><label>Access key<input required value={form.accessKeyId} onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })} /></label><label>Secret key<input required type="password" value={form.secretAccessKey} onChange={(event) => setForm({ ...form, secretAccessKey: event.target.value })} /></label></>}<label className="wide-field">Backup encryption passphrase<input minLength={12} required type="password" value={form.encryptionPassphrase} onChange={(event) => setForm({ ...form, encryptionPassphrase: event.target.value })} /></label><button className="primary-button form-action" disabled={busy} type="submit"><HardDrive size={16} />Add destination</button></form>
      <div className="channel-list">{destinations.map((item) => <article className="channel-row" key={item.id}><HardDrive size={20} /><div><strong>{item.name}</strong><span>{item.protocol} · {item.scheduleCron} UTC</span></div><span className={item.enabled ? "status status-good" : "status status-muted"}>{item.enabled ? copy.enabled : copy.disabled}</span><button className="small-button" onClick={() => void request("backups/trigger", { method: "POST", body: JSON.stringify({ configId: item.id }) })} type="button"><Play size={14} />{copy.trigger}</button><button aria-label={`${copy.delete} ${item.name}`} className="icon-button danger-button" onClick={() => void request(`backups/${item.id}`, { method: "DELETE" }).then(load)} type="button"><Trash2 size={16} /></button></article>)}</div></section><RecoveryGuide /></div>;
}

function RecoveryGuide() {
  const copy = useCopy();
  return <section className="data-section recovery-guide"><SectionHeading title={copy.recoveryGuide} detail="Disaster recovery procedure for Adaptive Chat backup format v1" /><div className="recovery-step"><span>1</span><div><strong>Stop stateful writers</strong><p>Run <code>docker compose stop api worker admin</code>. Keep PostgreSQL and Redis available.</p></div></div><div className="recovery-step"><span>2</span><div><strong>Decrypt and authenticate</strong><p>Run <code>node scripts/restore-backup.mjs decrypt snapshot.dump.acb snapshot.dump</code>. Enter the original destination passphrase when prompted. Authentication failure aborts without producing a dump.</p></div></div><div className="recovery-step"><span>3</span><div><strong>Restore PostgreSQL</strong><p>Run <code>docker compose exec -T postgres pg_restore --clean --if-exists --no-owner --dbname adaptive_chat &lt; snapshot.dump</code>.</p></div></div><div className="recovery-step"><span>4</span><div><strong>Restart and validate</strong><p>Run <code>docker compose up -d api worker admin</code>, then verify <code>/health</code>, sign-in, dynamic channels, and a test background job.</p></div></div><div className="recovery-note"><BookOpen size={18} /><span>Redis queue data is operational state. PostgreSQL background job records are authoritative and queued/running jobs are recovered automatically when the worker starts.</span></div></section>;
}

function JobsPanel() {
  const copy = useCopy();
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setJobs((await request<{ data: BackgroundJob[] }>("jobs", { cache: "no-store" })).data); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : copy.operationFailed); } }, [copy.operationFailed]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 5_000); return () => window.clearInterval(timer); }, [load]);
  return <div className="enterprise-stack"><InlineError message={error} /><section className="data-section"><SectionHeading title={copy.workerJobs} detail={copy.workerDetail} /><div className="table-wrap"><table><thead><tr><th>Job</th><th>Type</th><th>{copy.status}</th><th>Attempts</th><th>Created</th><th>Result / error</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><code>{job.id}</code></td><td>{job.type}</td><td><span className={job.status === "succeeded" ? "status status-good" : "status status-muted"}>{job.status === "running" && <LoaderCircle className="spin" size={14} />}{job.status}</span></td><td>{job.attempts} / {job.maxAttempts}</td><td>{formatDate(job.createdAt, copy, true)}</td><td className="job-result">{job.error ?? (job.result ? JSON.stringify(job.result) : job.logs.at(-1) ?? "Queued")}</td></tr>)}</tbody></table></div></section></div>;
}
