"use client";

import {
  Bot,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  Edit3,
  FileImage,
  GitFork,
  Globe2,
  ImagePlus,
  LogOut,
  MessageSquarePlus,
  Mic,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Save,
  Send,
  Settings,
  Square,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AvatarCropDialog } from "./AvatarCropDialog";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://chatapi.zengjunjie.com").replace(/\/$/, "");
const AUTO_SCROLL_EDGE_PX = 56;

type Language = "en" | "zh";
type LanguagePreference = "system" | Language;
type Theme = "system" | "light" | "dark";
type Role = "user" | "assistant" | "system";
type UserProfile = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role?: "admin" | "standard";
  status?: "active" | "suspended";
  groups?: string[];
  permissions?: { expertMode?: boolean };
};

type ChannelModel = { id: string; label: string; description: string; expert?: boolean; provider?: string };
type Channel = {
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
    customCss: string;
  };
  models: ChannelModel[];
};
type RemoteConfig = {
  defaultSystemPrompt: string;
  featureFlags: { webSearch: boolean; reasoningBlocks: boolean; attachments: boolean };
  channels: Channel[];
  expertMode?: { allowed: boolean; enabled: boolean; models: ChannelModel[] };
};
type Attachment = { fileName: string; mimeType: string; dataUrl: string };
type ChatMessage = {
  id: string;
  sessionId: string;
  role: Role;
  content: string;
  attachments: Attachment[];
  reasoning: string;
  modelId: string;
  errorText: string;
  isStreaming: boolean;
  parentMessageId: string | null;
  createdAt: number;
  updatedAt: number;
};
type ChatSession = {
  id: string;
  title: string;
  channelId: string;
  modelId: string;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};
type Confirmation = { kind: "delete" | "branch"; title: string; body: string; confirm: string; run: () => void };

const COPY = {
  en: {
    product: "Adaptive Chat", synchronized: "Synchronized workspace", email: "Email", password: "Password",
    signIn: "Sign in", signingIn: "Signing in", noRegistration: "Accounts are created by an administrator.",
    newChat: "New conversation", conversations: "Conversations", noHistory: "No conversations yet", signOut: "Sign out",
    channel: "Channel", model: "Model", light: "Light", dark: "Dark", system: "System", language: "Language",
    settings: "Settings", settingsTitle: "Workspace settings", profile: "Profile", displayName: "Display name", avatar: "Avatar", chooseAvatar: "Choose avatar", removeAvatar: "Remove avatar", saveProfile: "Save profile", saving: "Saving", saved: "Saved", appearance: "Appearance", expertMode: "Expert mode", expertModeDetail: "Show the raw upstream model list assigned to your account.", expertModeOn: "Expert models enabled", expertModeOff: "Expert models hidden", fontSize: "Font size", fontSizeDetail: "Adjust interface text", feedback: "Feedback", feedbackDetail: "Send a note to the product team", feedbackPrompt: "What would you like to share?", sendFeedback: "Send feedback", feedbackSent: "Feedback sent.", sendingFeedback: "Sending feedback",
    welcome: "How can I help?", welcomeDetail: "Choose a channel and start a synchronized conversation.",
    placeholder: "Message Adaptive Chat", send: "Send", stop: "Stop generation", attach: "Attach image", voice: "Voice input",
    webSearch: "Web search", webSearchOn: "Web search enabled for this prompt", remove: "Remove attachment",
    copy: "Copy", edit: "Edit", delete: "Delete", redo: "Redo", branch: "Branch", listen: "Listen",
    reasoning: "Reasoning process", thinking: "Thinking", waiting: "Waiting for the first token",
    deleteMessage: "Delete message?", deleteMessageBody: "The message will be permanently removed. A user prompt and its paired AI response are deleted together.",
    deleteChat: "Delete conversation?", deleteChatBody: "The conversation and all of its messages will be permanently removed.",
    createBranch: "Create conversation branch?", createBranchBody: "A separate synchronized conversation will be created from this point.",
    cancel: "Cancel", confirm: "Confirm", editing: "Editing message", stopEditing: "Cancel editing", close: "Close", small: "Small", large: "Large",
    syncError: "Unable to synchronize conversations.", loginError: "Unable to sign in.", requestError: "The response could not be completed.",
    menu: "Open conversations", closeSidebar: "Close conversations", collapseSidebar: "Collapse sidebar", expandSidebar: "Expand sidebar", account: "Account", profileError: "Unable to update your profile.", feedbackError: "Unable to send feedback.", avatarTooLarge: "Avatar images must be 2 MB or smaller.", avatarTypeError: "Choose a JPEG, PNG, or WEBP avatar image.", cropAvatar: "Crop avatar", cropAvatarDetail: "Drag to reposition the image, then adjust the scale.", zoom: "Zoom", reset: "Reset", applyCrop: "Apply crop", processingCrop: "Processing", cropError: "The cropped avatar could not be created.",
  },
  zh: {
    product: "Adaptive Chat", synchronized: "跨端同步工作区", email: "邮箱", password: "密码",
    signIn: "登录", signingIn: "正在登录", noRegistration: "账号仅由管理员创建。",
    newChat: "新建会话", conversations: "会话", noHistory: "暂无会话", signOut: "退出登录",
    channel: "频道", model: "模型", light: "浅色", dark: "深色", system: "跟随系统", language: "语言",
    settings: "设置", settingsTitle: "工作区设置", profile: "个人资料", displayName: "显示名称", avatar: "头像", chooseAvatar: "选择头像", removeAvatar: "移除头像", saveProfile: "保存资料", saving: "正在保存", saved: "已保存", appearance: "外观", expertMode: "专家模式", expertModeDetail: "显示管理员为你的账户分配的上游原始模型。", expertModeOn: "已启用专家模型", expertModeOff: "已隐藏专家模型", fontSize: "文字大小", fontSizeDetail: "调整界面文字", feedback: "反馈", feedbackDetail: "向产品团队发送反馈", feedbackPrompt: "想和我们分享什么？", sendFeedback: "发送反馈", feedbackSent: "反馈已发送。", sendingFeedback: "正在发送反馈",
    welcome: "有什么可以帮你？", welcomeDetail: "选择频道并开始一段跨端同步的对话。",
    placeholder: "发送消息给 Adaptive Chat", send: "发送", stop: "停止生成", attach: "添加图片", voice: "语音输入",
    webSearch: "网页搜索", webSearchOn: "本次提问已启用网页搜索", remove: "移除附件",
    copy: "复制", edit: "编辑", delete: "删除", redo: "重新生成", branch: "创建分支", listen: "朗读",
    reasoning: "推理过程", thinking: "正在思考", waiting: "正在等待首个响应片段",
    deleteMessage: "删除消息？", deleteMessageBody: "该消息将被永久删除。删除用户消息时，其配对的 AI 回复也会一并删除。",
    deleteChat: "删除会话？", deleteChatBody: "该会话及其全部消息将被永久删除。",
    createBranch: "创建会话分支？", createBranchBody: "将从当前位置创建一个独立且同步的新会话。",
    cancel: "取消", confirm: "确认", editing: "正在编辑消息", stopEditing: "取消编辑", close: "关闭", small: "小", large: "大",
    syncError: "无法同步会话。", loginError: "无法登录。", requestError: "未能完成响应。",
    menu: "打开会话列表", closeSidebar: "关闭会话列表", collapseSidebar: "收起侧边栏", expandSidebar: "展开侧边栏", account: "账号", profileError: "无法更新个人资料。", feedbackError: "无法发送反馈。", avatarTooLarge: "头像不能超过 2 MB。", avatarTypeError: "请选择 JPEG、PNG 或 WEBP 图片。", cropAvatar: "裁剪头像", cropAvatarDetail: "拖动图片调整位置，然后设置缩放比例。", zoom: "缩放", reset: "重置", applyCrop: "应用裁剪", processingCrop: "正在处理", cropError: "无法生成裁剪后的头像。",
  },
} as const;

function id() {
  return crypto.randomUUID();
}

async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined;
    throw new Error(typeof error?.message === "string" ? error.message : `Request failed with HTTP ${response.status}.`);
  }
  return payload as T;
}

function snapshotBody(session: ChatSession) {
  const { id: _id, ...snapshot } = session;
  return JSON.stringify(snapshot);
}

function openAiContent(message: ChatMessage) {
  if (!message.attachments.length) return message.content;
  return [
    ...(message.content ? [{ type: "text", text: message.content }] : []),
    ...message.attachments.map((attachment) => ({
      type: "image_url",
      image_url: { url: attachment.dataUrl, detail: "auto" },
    })),
  ];
}

function parseThinking(value: string, complete: boolean) {
  let cursor = 0;
  let inThinking = false;
  let content = "";
  let reasoning = "";
  const markers = ["<think>", "</think>"];
  while (cursor < value.length) {
    if (value.startsWith(markers[0], cursor)) {
      inThinking = true;
      cursor += markers[0].length;
      continue;
    }
    if (value.startsWith(markers[1], cursor)) {
      inThinking = false;
      cursor += markers[1].length;
      continue;
    }
    const next = markers
      .map((marker) => value.indexOf(marker, cursor))
      .filter((position) => position >= 0)
      .sort((left, right) => left - right)[0];
    if (next !== undefined) {
      const stable = value.slice(cursor, next);
      if (inThinking) reasoning += stable; else content += stable;
      cursor = next;
      continue;
    }
    let remainder = value.slice(cursor);
    if (!complete) {
      const held = markers.reduce((longest, marker) => {
        for (let size = Math.min(marker.length - 1, remainder.length); size > longest; size -= 1) {
          if (marker.startsWith(remainder.slice(-size))) return size;
        }
        return longest;
      }, 0);
      remainder = remainder.slice(0, remainder.length - held);
    }
    if (inThinking) reasoning += remainder; else content += remainder;
    break;
  }
  return { content, reasoning };
}

function channelVariables(channel: Channel, theme: Theme) {
  const declarations = Object.fromEntries(
    [...channel.style.customCss.matchAll(/([\w-]{1,64})\s*:\s*([^;{}]{1,512})/g)]
      .map((match) => [match[1].toLowerCase(), match[2].trim()]),
  );
  const color = (name: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(declarations[name] ?? "")
    ? declarations[name]
    : fallback;
  const start = color("--chat-background-start", channel.style.backgroundStart);
  const end = color("--chat-background-end", channel.style.backgroundEnd);
  const surface = color("--chat-surface", channel.style.surfaceColor);
  const geminiDark = theme === "dark" && channel.id.toLowerCase() === "gemini";
  return {
    "--channel-start": geminiDark ? "#080d12" : theme === "dark" ? "#151817" : start,
    "--channel-end": geminiDark ? "#11191a" : theme === "dark" ? "#202523" : end,
    "--channel-flow-one": geminiDark ? "#13233b" : theme === "dark" ? "#18211f" : "#fce8f3",
    "--channel-flow-two": geminiDark ? "#291c2e" : theme === "dark" ? "#222326" : "#e9e7fb",
    "--channel-flow-three": geminiDark ? "#102d27" : theme === "dark" ? "#1b2722" : "#e6f4ea",
    "--channel-accent": color("--chat-accent", channel.style.accentColor),
    "--channel-text": theme === "dark" ? "#f2f5f3" : color("--chat-text", channel.style.textColor),
    "--channel-surface": theme === "dark" ? "#222725" : surface,
    "--channel-font": channel.style.typography === "mono"
      ? "ui-monospace, SFMono-Regular, Menlo, monospace"
      : channel.style.typography === "serif" ? "Georgia, serif" : "Inter, Arial, sans-serif",
  } as CSSProperties;
}

function ChannelIcon({ channel }: { channel: Channel }) {
  const src = channel.icon.type === "data_url"
    ? channel.icon.value
    : ["chatgpt", "gemini", "deepseek"].includes(channel.id) ? `/channel-icons/${channel.id}` : "";
  return src
    ? <img className="channel-icon" src={src} alt="" />
    : <span className="channel-initial" aria-hidden="true">{channel.displayName.slice(0, 1).toUpperCase()}</span>;
}

function Markdown({ value }: { value: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
    </div>
  );
}

function profileLabel(profile: UserProfile | null, email: string) {
  return profile?.displayName?.trim() || profile?.email || email || "User";
}

function UserAvatar({ profile, email, previewUrl = "" }: { profile: UserProfile | null; email: string; previewUrl?: string }) {
  const label = profileLabel(profile, email);
  const src = previewUrl || profile?.avatarUrl || "";
  let hash = 0;
  for (const character of label.toLowerCase()) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  const style = { "--avatar-hue": String(Math.abs(hash) % 360) } as CSSProperties;
  return src
    ? <img className="user-avatar" src={src} alt={label} />
    : <span className="user-avatar user-avatar-fallback" style={style} aria-label={label}>{label.slice(0, 1).toUpperCase()}</span>;
}

function localizeProfileError(message: string, copy: (typeof COPY)[Language]) {
  if (copy === COPY.zh) {
    if (message === "Avatar images must be 2 MB or smaller.") return copy.avatarTooLarge;
    if (message === "Choose a JPEG, PNG, or WEBP avatar image.") return copy.avatarTypeError;
    if (message === "Choose a valid JPEG, PNG, or WEBP avatar image.") return copy.avatarTypeError;
    if (message === "The avatar image could not be decoded.") return "无法解析头像图片。";
    if (message === "The avatar image could not be processed.") return "无法处理头像图片。";
    if (message === "Unable to update your profile.") return copy.profileError;
  }
  return message;
}

export default function WebChat() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editingId, setEditingId] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [expertMode, setExpertMode] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("system");
  const [language, setLanguage] = useState<LanguagePreference>("system");
  const [systemDark, setSystemDark] = useState(false);
  const [systemLanguage, setSystemLanguage] = useState<Language>("en");
  const [fontScale, setFontScale] = useState(1);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [profileStatus, setProfileStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [settingsError, setSettingsError] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [compactLayout, setCompactLayout] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const messageViewport = useRef<HTMLDivElement>(null);
  const autoScrollPaused = useRef(false);
  const activeAbortController = useRef<AbortController | null>(null);
  const generationInFlight = useRef(false);
  const streamingRef = useRef(false);
  const configRequestSequence = useRef(0);
  const pendingSnapshots = useRef(new Map<string, ChatSession>());
  const pendingSelections = useRef(new Map<string, { channelId: string; modelId: string; updatedAt: number }>());
  const selectionWrites = useRef(new Map<string, Promise<void>>());
  const [dispatchSelection, setDispatchSelection] = useState<{ sessionId: string; channelId: string; modelId: string } | null>(null);
  const effectiveTheme: Exclude<Theme, "system"> = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const effectiveLanguage: Language = language === "system" ? systemLanguage : language;
  const copy = COPY[effectiveLanguage];
  streamingRef.current = streaming;

  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  const lockedSelection = streaming && dispatchSelection?.sessionId === selected?.id ? dispatchSelection : null;
  const visibleChannelId = lockedSelection?.channelId ?? selected?.channelId;
  const visibleModelId = lockedSelection?.modelId ?? selected?.modelId;
  const channel = config?.channels.find((item) => item.id === visibleChannelId)
    ?? config?.channels[0];
  const model = channel?.models.find((item) => item.id === visibleModelId) ?? channel?.models[0];

  const loadSessions = useCallback(async (currentToken: string, quiet = false) => {
    try {
      const result = await api<{ data: ChatSession[] }>("/v1/sessions", currentToken);
      const merged = result.data.map((session) => {
        const snapshot = pendingSnapshots.current.get(session.id);
        if (snapshot && snapshot.updatedAt > session.updatedAt) return snapshot;
        if (snapshot && snapshot.updatedAt <= session.updatedAt) pendingSnapshots.current.delete(session.id);
        const pending = pendingSelections.current.get(session.id);
        if (!pending) return session;
        if (session.updatedAt >= pending.updatedAt
          && session.channelId === pending.channelId && session.modelId === pending.modelId) {
          pendingSelections.current.delete(session.id);
          return session;
        }
        return { ...session, ...pending };
      });
      setSessions(merged);
      setSelectedId((current) => merged.some((session) => session.id === current)
        ? current
        : merged[0]?.id ?? "");
      if (!quiet) setError("");
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : copy.syncError);
    }
  }, [copy.syncError]);

  const loadProfile = useCallback(async (currentToken: string) => {
    const result = await api<{ data: UserProfile }>("/v1/users/profile", currentToken);
    setProfile(result.data);
    setEmail(result.data.email);
    localStorage.setItem("adaptive-chat-email", result.data.email);
    localStorage.setItem("adaptive-chat-profile", JSON.stringify(result.data));
    return result.data;
  }, []);

  const loadRemoteConfig = useCallback(async (currentToken?: string, expert = false) => {
    const requestSequence = ++configRequestSequence.current;
    const query = expert ? "?expert_mode=true" : "";
    const next = await api<RemoteConfig>(`/v1/config${query}`, currentToken);
    if (requestSequence === configRequestSequence.current) setConfig(next);
    return next;
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem("adaptive-chat-token") ?? "";
    const storedEmail = localStorage.getItem("adaptive-chat-email") ?? "";
    const storedTheme = localStorage.getItem("adaptive-chat-theme") as Theme | null;
    const storedLanguage = localStorage.getItem("adaptive-chat-language") as LanguagePreference | null;
    const storedFontScale = Number(localStorage.getItem("adaptive-chat-font-scale") ?? "1");
    const storedProfile = localStorage.getItem("adaptive-chat-profile");
    const storedExpertMode = localStorage.getItem("adaptive-chat-expert-mode") === "true";
    const storedSidebarCollapsed = localStorage.getItem("adaptive-chat-sidebar-collapsed");
    setToken(storedToken);
    setExpertMode(storedExpertMode);
    setEmail(storedEmail);
    if (storedTheme === "system" || storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
    if (storedLanguage === "system" || storedLanguage === "en" || storedLanguage === "zh") setLanguage(storedLanguage);
    if (Number.isFinite(storedFontScale)) setFontScale(Math.min(1.3, Math.max(0.85, storedFontScale)));
    setSidebarCollapsed(storedSidebarCollapsed === "true");
    if (storedProfile) {
      try { setProfile(JSON.parse(storedProfile) as UserProfile); } catch { localStorage.removeItem("adaptive-chat-profile"); }
    }
    void loadRemoteConfig().catch(() => undefined);
  }, [loadRemoteConfig]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemPreferences = () => {
      setSystemDark(media.matches);
      setSystemLanguage(navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en");
    };
    updateSystemPreferences();
    media.addEventListener("change", updateSystemPreferences);
    return () => media.removeEventListener("change", updateSystemPreferences);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const updateLayout = () => {
      setCompactLayout(media.matches);
      if (!media.matches) setSidebarOpen(false);
    };
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadSessions(token);
    void (async () => {
      try {
        const currentProfile = await loadProfile(token);
        const allowed = Boolean(currentProfile.permissions?.expertMode || currentProfile.groups?.some((group) => group.toLowerCase() === "expert"));
        const enabled = allowed && (localStorage.getItem("adaptive-chat-expert-mode") === "true");
        setExpertMode(enabled);
        await loadRemoteConfig(token, enabled).catch(() => undefined);
        if (!allowed) localStorage.removeItem("adaptive-chat-expert-mode");
      } catch {
        // The session poll below will surface an authentication failure if it is no longer valid.
      }
    })();
    const interval = window.setInterval(() => {
      if (!streamingRef.current && !document.hidden) void loadSessions(token, true);
    }, 2_000);
    const profileInterval = window.setInterval(() => {
      if (!document.hidden) void loadProfile(token).catch(() => undefined);
    }, 30_000);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(profileInterval);
    };
  }, [loadProfile, loadRemoteConfig, loadSessions, token]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    localStorage.setItem("adaptive-chat-theme", theme);
  }, [effectiveTheme, theme]);

  useEffect(() => {
    document.documentElement.lang = effectiveLanguage === "zh" ? "zh-CN" : "en";
    localStorage.setItem("adaptive-chat-language", language);
  }, [effectiveLanguage, language]);

  useEffect(() => {
    localStorage.setItem("adaptive-chat-font-scale", String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    localStorage.setItem("adaptive-chat-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  useEffect(() => {
    autoScrollPaused.current = false;
    const viewport = messageViewport.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected?.id]);

  useEffect(() => {
    if (!streaming || autoScrollPaused.current) return;
    const viewport = messageViewport.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => {
      if (!autoScrollPaused.current) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected?.messages, streaming, waiting]);

  const handleMessageScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    autoScrollPaused.current = distanceFromBottom > AUTO_SCROLL_EDGE_PX;
  }, []);

  const persist = useCallback(async (session: ChatSession) => {
    await api(`/v1/sessions/${encodeURIComponent(session.id)}`, token, { method: "PUT", body: snapshotBody(session) });
    const pending = pendingSnapshots.current.get(session.id);
    if (pending?.updatedAt === session.updatedAt) pendingSnapshots.current.delete(session.id);
  }, [token]);

  const replaceSession = useCallback((session: ChatSession, optimistic = true) => {
    if (optimistic) pendingSnapshots.current.set(session.id, session);
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt));
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || password.length < 8 || loginPending) return;
    setLoginPending(true);
    setLoginError("");
    try {
      const result = await api<{ token: string; user: UserProfile }>("/v1/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      localStorage.setItem("adaptive-chat-token", result.token);
      localStorage.setItem("adaptive-chat-email", result.user.email);
      localStorage.setItem("adaptive-chat-profile", JSON.stringify(result.user));
      setEmail(result.user.email);
      setProfile(result.user);
      setPassword("");
      setToken(result.token);
    } catch (cause) {
      setLoginError(cause instanceof Error ? cause.message : copy.loginError);
    } finally {
      setLoginPending(false);
    }
  }

  function logout() {
    localStorage.removeItem("adaptive-chat-token");
    localStorage.removeItem("adaptive-chat-email");
    localStorage.removeItem("adaptive-chat-profile");
    setToken("");
    setProfile(null);
    setSessions([]);
    setSelectedId("");
    setDraft("");
    setSettingsOpen(false);
    setExpertMode(false);
    setDispatchSelection(null);
    pendingSnapshots.current.clear();
  }

  async function toggleExpertMode(enabled: boolean) {
    const allowed = Boolean(profile?.permissions?.expertMode || profile?.groups?.some((group) => group.toLowerCase() === "expert"));
    if (!allowed || !token || streaming) return;
    const previous = expertMode;
    setExpertMode(enabled);
    localStorage.setItem("adaptive-chat-expert-mode", String(enabled));
    setSettingsError("");
    try {
      await loadRemoteConfig(token, enabled);
    } catch (cause) {
      setExpertMode(previous);
      localStorage.setItem("adaptive-chat-expert-mode", String(previous));
      setSettingsError(cause instanceof Error ? cause.message : copy.requestError);
    }
  }

  function openSettings() {
    setProfileDraft(profile?.displayName ?? "");
    setAvatarFile(null);
    setAvatarCropFile(null);
    setAvatarPreview("");
    setRemoveAvatar(false);
    setProfileStatus("idle");
    setFeedbackStatus("idle");
    setSettingsError("");
    setSidebarOpen(false);
    setSettingsOpen(true);
  }

  function selectAvatar(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setSettingsError(copy.avatarTypeError);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSettingsError(copy.avatarTooLarge);
      return;
    }
    setSettingsError("");
    setAvatarCropFile(file);
  }

  function applyAvatarCrop(file: File) {
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setAvatarCropFile(null);
    setRemoveAvatar(false);
    setProfileStatus("idle");
  }

  async function saveProfile() {
    if (profileStatus === "saving") return;
    setProfileStatus("saving");
    setSettingsError("");
    try {
      const form = new FormData();
      form.set("displayName", profileDraft.trim());
      if (avatarFile) form.set("avatar", avatarFile, avatarFile.name);
      if (removeAvatar) form.set("removeAvatar", "true");
      const result = await api<{ data: UserProfile }>("/v1/users/profile", token, { method: "PATCH", body: form });
      setProfile(result.data);
      setEmail(result.data.email);
      localStorage.setItem("adaptive-chat-profile", JSON.stringify(result.data));
      localStorage.setItem("adaptive-chat-email", result.data.email);
      setAvatarFile(null);
      setAvatarPreview("");
      setRemoveAvatar(false);
      setProfileStatus("saved");
    } catch (cause) {
      setProfileStatus("idle");
      setSettingsError(cause instanceof Error ? localizeProfileError(cause.message, copy) : copy.profileError);
    }
  }

  async function submitSettingsFeedback() {
    if (feedbackDraft.trim().length < 3 || feedbackStatus === "sending") return;
    setFeedbackStatus("sending");
    setSettingsError("");
    try {
      await api("/v1/app/feedback", token, {
        method: "POST",
        body: JSON.stringify({
          message: feedbackDraft.trim(),
          category: "general",
          appVersion: "web",
          locale: language === "system" ? "system" : effectiveLanguage === "zh" ? "zh-CN" : "en",
        }),
      });
      setFeedbackDraft("");
      setFeedbackStatus("sent");
    } catch (cause) {
      setFeedbackStatus("idle");
      setSettingsError(cause instanceof Error ? cause.message : copy.feedbackError);
    }
  }

  async function createSession(preferredChannel = channel) {
    if (!config || !preferredChannel) return undefined;
    const timestamp = Date.now();
    const next: ChatSession = {
      id: id(),
      title: copy.newChat,
      channelId: preferredChannel.id,
      modelId: preferredChannel.models[0].id,
      systemPrompt: config.defaultSystemPrompt,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    replaceSession(next);
    setSelectedId(next.id);
    setSidebarOpen(false);
    await persist(next);
    return next;
  }

  async function updateSelection(channelId: string, modelId?: string) {
    if (streaming || generationInFlight.current) return;
    const nextChannel = config?.channels.find((item) => item.id === channelId);
    if (!nextChannel) return;
    const target = selected ?? await createSession(nextChannel);
    if (!target) return;
    const next = {
      ...target,
      channelId,
      modelId: modelId && nextChannel.models.some((item) => item.id === modelId) ? modelId : nextChannel.models[0].id,
      updatedAt: Date.now(),
    };
    pendingSelections.current.set(next.id, { channelId: next.channelId, modelId: next.modelId, updatedAt: next.updatedAt });
    replaceSession(next);
    const previous = selectionWrites.current.get(next.id) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(() => persist(next)).then(() => {
      const pending = pendingSelections.current.get(next.id);
      if (pending?.updatedAt === next.updatedAt) pendingSelections.current.delete(next.id);
    });
    selectionWrites.current.set(next.id, write);
    await write;
    if (selectionWrites.current.get(next.id) === write) selectionWrites.current.delete(next.id);
  }

  async function streamAssistant(base: ChatSession, assistantId: string, source: ChatMessage[], searchEnabled: boolean) {
    setStreaming(true);
    setWaiting(true);
    setError("");
    let working = base;
    let rawContent = "";
    let explicitReasoning = "";
    const controller = new AbortController();
    activeAbortController.current = controller;
    try {
      const contextMessages = source
        .filter((message) => message.role !== "assistant" || message.content || message.reasoning)
        .slice(-24)
        .map((message) => ({ role: message.role, content: openAiContent(message) }));
      const response = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(searchEnabled ? { "X-Web-Search": "true" } : {}),
        },
        body: JSON.stringify({
          model: base.modelId,
          expert_mode: Boolean(expertMode && profile?.permissions?.expertMode),
          stream: true,
          messages: [
            ...(base.systemPrompt ? [{ role: "system", content: base.systemPrompt }] : []),
            ...contextMessages,
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? `Request failed with HTTP ${response.status}.`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      const applyDelta = (content: string, reasoning: string, done: boolean) => {
        rawContent += content;
        explicitReasoning += reasoning;
        const parsed = parseThinking(rawContent, done);
        const timestamp = Date.now();
        working = {
          ...working,
          updatedAt: timestamp,
          messages: working.messages.map((message) => message.id === assistantId ? {
            ...message,
            content: parsed.content,
            reasoning: `${explicitReasoning}${parsed.reasoning}`,
            isStreaming: !done,
            updatedAt: timestamp,
          } : message),
        };
        replaceSession(working);
        if (content || reasoning) setWaiting(false);
      };
      const processFrame = (frame: string) => {
        const lines = frame.split(/\r?\n/);
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) return;
        if (event === "error") {
          const payload = JSON.parse(data) as { error?: string };
          throw new Error(payload.error ?? copy.requestError);
        }
        if (data === "[DONE]") {
          completed = true;
          applyDelta("", "", true);
          return;
        }
        const payload = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string; reasoning?: string; reasoning_content?: string } }>;
        };
        const delta = payload.choices?.[0]?.delta;
        if (delta) applyDelta(delta.content ?? "", delta.reasoning_content ?? delta.reasoning ?? "", false);
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0].length ?? 2;
          buffer = buffer.slice(boundary + separator);
          processFrame(frame);
          boundary = buffer.search(/\r?\n\r?\n/);
        }
        if (done) break;
      }
      if (buffer.trim()) processFrame(buffer);
      if (!completed) applyDelta("", "", true);
    } catch (cause) {
      const aborted = controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError");
      const message = cause instanceof Error ? cause.message : copy.requestError;
      const timestamp = Date.now();
      working = {
        ...working,
        updatedAt: timestamp,
        messages: working.messages.map((item) => item.id === assistantId
          ? { ...item, isStreaming: false, errorText: aborted ? "" : message, updatedAt: timestamp }
          : item),
      };
      replaceSession(working);
      if (!aborted) setError(message);
    } finally {
      setWaiting(false);
      setStreaming(false);
      if (activeAbortController.current === controller) activeAbortController.current = null;
      await persist(working).catch(() => setError(copy.syncError));
      setWebSearch(false);
      setDispatchSelection((current) => current?.sessionId === base.id ? null : current);
      generationInFlight.current = false;
    }
  }

  function stopGeneration() {
    activeAbortController.current?.abort();
  }

  async function send() {
    if (streaming || generationInFlight.current || (!draft.trim() && !attachments.length) || !config) return;
    const editIndex = editingId
      ? (selected?.messages.findIndex((message) => message.id === editingId && message.role === "user") ?? -1)
      : -1;
    if (editingId && editIndex < 0) return;
    const active = selected ?? await createSession();
    if (!active) return;
    generationInFlight.current = true;
    setDispatchSelection({ sessionId: active.id, channelId: active.channelId, modelId: active.modelId });
    const timestamp = Date.now();
    let userMessage: ChatMessage;
    let source: ChatMessage[];
    if (editingId) {
      userMessage = {
        ...active.messages[editIndex],
        content: draft.trim(),
        attachments,
        errorText: "",
        updatedAt: timestamp,
      };
      source = [...active.messages.slice(0, editIndex), userMessage];
    } else {
      userMessage = {
        id: id(), sessionId: active.id, role: "user", content: draft.trim(), attachments,
        reasoning: "", modelId: "", errorText: "", isStreaming: false, parentMessageId: null,
        createdAt: timestamp, updatedAt: timestamp,
      };
      source = [...active.messages, userMessage];
    }
    const assistant: ChatMessage = {
      id: id(), sessionId: active.id, role: "assistant", content: "", attachments: [], reasoning: "",
      modelId: active.modelId, errorText: "", isStreaming: true, parentMessageId: userMessage.id,
      createdAt: timestamp + 1, updatedAt: timestamp + 1,
    };
    const next: ChatSession = {
      ...active,
      title: userMessage.content || userMessage.attachments[0]?.fileName || copy.newChat,
      updatedAt: timestamp,
      messages: [...source, assistant],
    };
    replaceSession(next);
    setDraft("");
    setAttachments([]);
    setEditingId("");
    await persist(next).catch((cause) => setError(cause instanceof Error ? cause.message : copy.syncError));
    await streamAssistant(next, assistant.id, source, webSearch);
  }

  async function redo(message: ChatMessage) {
    if (!selected || streaming || generationInFlight.current) return;
    if (selected.messages.at(-1)?.id !== message.id || message.role !== "assistant") return;
    const index = selected.messages.findIndex((item) => item.id === message.id);
    if (index < 0) return;
    const timestamp = Date.now();
    const assistant = { ...message, content: "", reasoning: "", errorText: "", isStreaming: true, updatedAt: timestamp };
    const source = selected.messages.slice(0, index);
    const next = { ...selected, updatedAt: timestamp, messages: [...source, assistant] };
    generationInFlight.current = true;
    setDispatchSelection({ sessionId: next.id, channelId: next.channelId, modelId: next.modelId });
    replaceSession(next);
    await persist(next).catch((cause) => setError(cause instanceof Error ? cause.message : copy.syncError));
    await streamAssistant(next, assistant.id, source, false);
  }

  function startEdit(message: ChatMessage) {
    setEditingId(message.id);
    setDraft(message.content);
    setAttachments(message.attachments);
  }

  async function removeMessage(message: ChatMessage) {
    const result = await api<{ data?: { deletedIds: string[]; updatedAt: number } }>(
      `/v1/messages/${encodeURIComponent(message.id)}`,
      token,
      { method: "DELETE" },
    );
    const deleted = new Set(result.data?.deletedIds ?? [message.id]);
    setSessions((current) => current.map((session) => session.id === message.sessionId
      ? { ...session, updatedAt: result.data?.updatedAt ?? Date.now(), messages: session.messages.filter((item) => !deleted.has(item.id)) }
      : session));
  }

  function confirmMessageDeletion(message: ChatMessage) {
    setConfirmation({
      kind: "delete",
      title: copy.deleteMessage,
      body: copy.deleteMessageBody,
      confirm: copy.delete,
      run: () => void removeMessage(message).catch((cause) => setError(cause instanceof Error ? cause.message : copy.syncError)),
    });
  }

  async function removeSession(session: ChatSession) {
    await api(`/v1/sessions/${encodeURIComponent(session.id)}`, token, { method: "DELETE" });
    setSessions((current) => current.filter((item) => item.id !== session.id));
    if (selectedId === session.id) setSelectedId("");
  }

  function confirmSessionDeletion(session: ChatSession) {
    setConfirmation({
      kind: "delete",
      title: copy.deleteChat,
      body: copy.deleteChatBody,
      confirm: copy.delete,
      run: () => void removeSession(session).catch((cause) => setError(cause instanceof Error ? cause.message : copy.syncError)),
    });
  }

  async function createBranch(message: ChatMessage) {
    if (!selected) return;
    const last = selected.messages.findIndex((item) => item.id === message.id);
    if (last < 0) return;
    const timestamp = Date.now();
    const source = selected.messages.slice(0, last + 1);
    const ids = new Map(source.map((item) => [item.id, id()]));
    const branch: ChatSession = {
      ...selected,
      id: id(),
      title: `${selected.title.slice(0, 44)} (${copy.branch})`,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: source.map((item, index) => ({
        ...item,
        id: ids.get(item.id)!,
        sessionId: "",
        parentMessageId: item.parentMessageId ? ids.get(item.parentMessageId) ?? null : null,
        isStreaming: false,
        createdAt: timestamp + index,
        updatedAt: timestamp + index,
      })),
    };
    branch.messages = branch.messages.map((item) => ({ ...item, sessionId: branch.id }));
    replaceSession(branch);
    setSelectedId(branch.id);
    await persist(branch);
  }

  function confirmBranch(message: ChatMessage) {
    setConfirmation({
      kind: "branch",
      title: copy.createBranch,
      body: copy.createBranchBody,
      confirm: copy.branch,
      run: () => void createBranch(message).catch((cause) => setError(cause instanceof Error ? cause.message : copy.syncError)),
    });
  }

  async function listen(message: ChatMessage) {
    const response = await fetch(`${API_BASE}/v1/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: message.content }),
    });
    if (!response.ok) throw new Error(copy.requestError);
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
    await audio.play();
  }

  async function selectFiles(files: FileList | null) {
    if (!files) return;
    const selectedFiles = [...files].filter((file) => file.type.startsWith("image/")).slice(0, 4);
    const loaded = await Promise.all(selectedFiles.map((file) => new Promise<Attachment>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ fileName: file.name, mimeType: file.type, dataUrl: String(reader.result) });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    setAttachments((current) => [...current, ...loaded].slice(0, 4));
  }

  function voiceInput() {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => { lang: string; start(): void; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void };
      webkitSpeechRecognition?: new () => { lang: string; start(): void; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void };
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = effectiveLanguage === "zh" ? "zh-CN" : "en-US";
    recognition.onresult = (event) => setDraft((current) => `${current}${current ? " " : ""}${event.results[0][0].transcript}`);
    recognition.start();
  }

  const shellStyle = useMemo(() => ({
    ...(channel ? channelVariables(channel, effectiveTheme) : {}),
    "--font-scale": String(fontScale),
  }) as CSSProperties, [channel, effectiveTheme, fontScale]);
  const terminalMessage = selected?.messages.at(-1);
  const terminalAssistantId = terminalMessage?.role === "assistant" ? terminalMessage.id : undefined;
  const terminalUserId = [...(selected?.messages ?? [])].reverse().find((message) => message.role === "user")?.id;
  const sidebarVisible = compactLayout ? sidebarOpen : !sidebarCollapsed;
  const sidebarToggleLabel = sidebarVisible
    ? compactLayout ? copy.closeSidebar : copy.collapseSidebar
    : compactLayout ? copy.menu : copy.expandSidebar;

  function toggleSidebar() {
    if (compactLayout) {
      setSidebarOpen((current) => !current);
      return;
    }
    setSidebarCollapsed((current) => !current);
  }

  if (!token) {
    return (
      <main className="login-page">
        <section className="login-panel">
          <img src="/brand" alt="" className="brand-logo" />
          <div>
            <h1>{copy.product}</h1>
            <p>{copy.synchronized}</p>
          </div>
          <form onSubmit={login}>
            <label>{copy.email}<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>{copy.password}<input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            {loginError && <div className="inline-error">{loginError}</div>}
            <button className="primary-command" disabled={loginPending} type="submit">
              {loginPending ? <RefreshCw className="spin" size={18} /> : <Network size={18} />}
              {loginPending ? copy.signingIn : copy.signIn}
            </button>
          </form>
          <small>{copy.noRegistration}</small>
          <button className="language-switch" onClick={() => setLanguage(effectiveLanguage === "en" ? "zh" : "en")}>{effectiveLanguage === "en" ? "中文" : "English"}</button>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`chat-shell channel-${channel?.id ?? "chatgpt"} ${channel?.style.animatedGradient ? "animated-channel" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      data-theme={effectiveTheme}
      style={shellStyle}
    >
      <aside id="conversation-sidebar" className={`conversation-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <img src="/brand" alt="" />
          <div><strong>{copy.product}</strong><span>{copy.synchronized}</span></div>
        </div>
        <button className="new-conversation" onClick={() => void createSession()}><MessageSquarePlus size={18} />{copy.newChat}</button>
        <div className="sidebar-label">{copy.conversations}</div>
        <nav className="session-list">
          {!sessions.length && <span className="empty-history">{copy.noHistory}</span>}
          {sessions.map((session) => (
            <div className={`session-row ${session.id === selected?.id ? "session-selected" : ""}`} key={session.id}>
              <button onClick={() => { setSelectedId(session.id); setSidebarOpen(false); }}>{session.title}</button>
              <button className="session-delete" title={copy.delete} aria-label={copy.delete} onClick={() => confirmSessionDeletion(session)}><Trash2 size={16} /></button>
            </div>
          ))}
        </nav>
        <div className="sidebar-account">
          <UserAvatar profile={profile} email={email} />
          <div><strong>{profileLabel(profile, email)}</strong><span>{profile?.email ?? email}</span></div>
          <button className="icon-command" title={copy.settings} aria-label={copy.settings} onClick={openSettings}><Settings size={18} /></button>
          <button className="icon-command" title={copy.signOut} aria-label={copy.signOut} onClick={logout}><LogOut size={18} /></button>
        </div>
      </aside>

      <button
        type="button"
        className="icon-command sidebar-toggle"
        title={sidebarToggleLabel}
        aria-label={sidebarToggleLabel}
        aria-controls="conversation-sidebar"
        aria-expanded={sidebarVisible}
        onClick={toggleSidebar}
      >
        {sidebarVisible ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
      </button>

      <section className="conversation-workspace">
        <header className="chat-header">
          <div className="channel-model-controls">
            <label>
              <span>{copy.channel}</span>
              <div className="select-wrap">
                {channel && <ChannelIcon channel={channel} />}
                <select disabled={streaming} value={channel?.id ?? ""} onChange={(event) => void updateSelection(event.target.value)}>
                  {(config?.channels ?? []).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <label>
              <span>{copy.model}</span>
              <div className="select-wrap model-select">
                <Sparkles size={17} />
                <select disabled={streaming} value={model?.id ?? ""} onChange={(event) => channel && void updateSelection(channel.id, event.target.value)}>
                  {(channel?.models ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
          </div>
          <div className="header-actions">
            <div className="top-language-select" title={copy.language}>
              <Globe2 size={17} />
              <select aria-label={copy.language} value={effectiveLanguage} onChange={(event) => setLanguage(event.target.value as Language)}>
                <option value="en">English</option>
                <option value="zh">简体中文</option>
              </select>
              <ChevronDown size={14} />
            </div>
            <button className="icon-command quick-setting" title={effectiveTheme === "light" ? copy.dark : copy.light} aria-label={effectiveTheme === "light" ? copy.dark : copy.light} onClick={() => setTheme(effectiveTheme === "light" ? "dark" : "light")}>
              {effectiveTheme === "light" ? <Moon size={19} /> : <Sun size={19} />}
            </button>
          </div>
        </header>

        <div className="message-viewport" ref={messageViewport} onScroll={handleMessageScroll}>
          {!selected?.messages.length ? (
            <div className="welcome-state">
              {channel && <div className="welcome-icon"><ChannelIcon channel={channel} /></div>}
              <h1>{copy.welcome}</h1>
              <p>{copy.welcomeDetail}</p>
            </div>
          ) : (
            <div className="message-list">
              {selected.messages.map((message) => {
                const user = message.role === "user";
                return (
                  <article className={`message ${user ? "user-message" : "assistant-message"}`} key={message.id} onContextMenu={(event) => event.preventDefault()}>
                    {!user && message.reasoning && (
                      <details className="reasoning-card" open={message.isStreaming}>
                        <summary><Bot size={16} />{copy.reasoning}{message.isStreaming && <span className="thinking-dot" />}</summary>
                        <Markdown value={message.reasoning} />
                      </details>
                    )}
                    <div className="message-bubble">
                      {user && <div className="user-identity"><UserAvatar profile={profile} email={email} /><strong>{profileLabel(profile, email)}</strong></div>}
                      {!user && <div className="message-model">{channel?.displayName} · {channel?.models.find((item) => item.id === message.modelId)?.label ?? message.modelId}</div>}
                      {message.attachments.length > 0 && <div className="message-attachments">{message.attachments.map((item) => <img key={item.dataUrl} src={item.dataUrl} alt={item.fileName} />)}</div>}
                      {message.content && <Markdown value={message.content} />}
                      {message.isStreaming && !message.content && !message.reasoning && <div className="waiting-state"><span /><span /><span />{copy.waiting}</div>}
                      {message.errorText && <div className="message-error">{message.errorText}</div>}
                    </div>
                    <div className="message-actions">
                      {user ? (
                        <>
                          <button title={copy.copy} onClick={() => void navigator.clipboard.writeText(message.content)}><Copy size={15} />{copy.copy}</button>
                          {message.id === terminalUserId && <button title={copy.edit} disabled={streaming} onClick={() => startEdit(message)}><Edit3 size={15} />{copy.edit}</button>}
                          <button title={copy.delete} disabled={streaming} onClick={() => confirmMessageDeletion(message)}><Trash2 size={15} />{copy.delete}</button>
                        </>
                      ) : (
                        <>
                          {message.id === terminalAssistantId && <button title={copy.redo} disabled={streaming} onClick={() => void redo(message)}><RefreshCw size={15} />{copy.redo}</button>}
                          <button title={copy.copy} disabled={!message.content} onClick={() => void navigator.clipboard.writeText(message.content)}><Clipboard size={15} />{copy.copy}</button>
                          <button title={copy.branch} disabled={streaming} onClick={() => confirmBranch(message)}><GitFork size={15} />{copy.branch}</button>
                          <button title={copy.listen} disabled={!message.content} onClick={() => void listen(message).catch(() => setError(copy.requestError))}><Volume2 size={15} />{copy.listen}</button>
                          <button title={copy.delete} disabled={streaming} onClick={() => confirmMessageDeletion(message)}><Trash2 size={15} />{copy.delete}</button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="composer-zone">
          {error && <div className="composer-error"><span>{error}</span><button title="Close" aria-label="Close" onClick={() => setError("")}><X size={17} /></button></div>}
          {editingId && <div className="editing-banner"><Edit3 size={16} />{copy.editing}<button title={copy.stopEditing} aria-label={copy.stopEditing} onClick={() => { setEditingId(""); setDraft(""); setAttachments([]); }}><X size={16} /></button></div>}
          {attachments.length > 0 && (
            <div className="attachment-strip">
              {attachments.map((item) => <div key={item.dataUrl}><img src={item.dataUrl} alt="" /><span>{item.fileName}</span><button title={copy.remove} aria-label={copy.remove} onClick={() => setAttachments((current) => current.filter((value) => value.dataUrl !== item.dataUrl))}><X size={15} /></button></div>)}
            </div>
          )}
          <div className="composer">
            <textarea rows={1} value={draft} placeholder={copy.placeholder} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
            }} />
            <div className="composer-tools">
              <input ref={fileInput} hidden type="file" accept="image/*" multiple onChange={(event) => void selectFiles(event.target.files)} />
              <button title={copy.attach} aria-label={copy.attach} onClick={() => fileInput.current?.click()}><FileImage size={19} /></button>
              <button title={copy.voice} aria-label={copy.voice} onClick={voiceInput}><Mic size={19} /></button>
              {config?.featureFlags.webSearch && <button className={webSearch ? "tool-active" : ""} title={webSearch ? copy.webSearchOn : copy.webSearch} aria-label={copy.webSearch} onClick={() => setWebSearch((value) => !value)}><Globe2 size={19} /></button>}
              <button className="send-command" title={streaming ? copy.stop : copy.send} aria-label={streaming ? copy.stop : copy.send} disabled={!streaming && (!draft.trim() && !attachments.length)} onClick={() => streaming ? stopGeneration() : void send()}>
                {streaming ? <Square size={16} fill="currentColor" /> : <Send size={19} />}
              </button>
            </div>
          </div>
        </footer>
      </section>

      {sidebarOpen && <button className="sidebar-scrim mobile-only" aria-label={copy.closeSidebar} onClick={() => setSidebarOpen(false)} />}
      {settingsOpen && (
        <div
          className="settings-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}
        >
          <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header className="settings-heading">
              <div><span>{copy.settings}</span><h2 id="settings-title">{copy.settingsTitle}</h2></div>
              <button className="icon-command" title={copy.close} aria-label={copy.close} onClick={() => setSettingsOpen(false)}><X size={19} /></button>
            </header>

            <div className="settings-section">
              <div className="settings-section-heading"><UserRound size={18} /><div><strong>{copy.profile}</strong><span>{profile?.email ?? email}</span></div></div>
              <div className="profile-editor">
                <div className="settings-avatar">
                  <UserAvatar
                    profile={removeAvatar && profile ? { ...profile, avatarUrl: null } : profile}
                    email={email}
                    previewUrl={avatarPreview}
                  />
                </div>
                <div className="avatar-commands">
                  <input ref={avatarInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { selectAvatar(event.target.files); event.currentTarget.value = ""; }} />
                  <button type="button" onClick={() => avatarInput.current?.click()}><ImagePlus size={17} />{copy.chooseAvatar}</button>
                  <button
                    type="button"
                    disabled={!avatarFile && (!profile?.avatarUrl || removeAvatar)}
                    onClick={() => { setAvatarFile(null); setAvatarPreview(""); setRemoveAvatar(true); setProfileStatus("idle"); }}
                  ><Trash2 size={17} />{copy.removeAvatar}</button>
                </div>
              </div>
              <label className="settings-field">{copy.displayName}<input maxLength={80} autoComplete="name" value={profileDraft} onChange={(event) => { setProfileDraft(event.target.value); setProfileStatus("idle"); }} /></label>
              <button className="settings-primary" type="button" disabled={profileStatus === "saving"} onClick={() => void saveProfile()}>
                {profileStatus === "saving" ? <RefreshCw className="spin" size={17} /> : profileStatus === "saved" ? <Check size={17} /> : <Save size={17} />}
                {profileStatus === "saving" ? copy.saving : profileStatus === "saved" ? copy.saved : copy.saveProfile}
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-section-heading"><Sun size={18} /><strong>{copy.appearance}</strong></div>
              <div className="settings-segments">
                {(["system", "light", "dark"] as Theme[]).map((value) => (
                  <button key={value} type="button" aria-pressed={theme === value} className={theme === value ? "segment-active" : ""} onClick={() => setTheme(value)}>
                    {value === "system" ? copy.system : value === "light" ? copy.light : copy.dark}
                  </button>
                ))}
              </div>
            </div>

            {Boolean(profile?.permissions?.expertMode || profile?.groups?.some((group) => group.toLowerCase() === "expert")) && (
              <div className="settings-section expert-settings-section">
                <div className="settings-section-heading"><Sparkles size={18} /><div><strong>{copy.expertMode}</strong><span>{copy.expertModeDetail}</span></div></div>
                <label className="toggle-row">
                  <span>{expertMode ? copy.expertModeOn : copy.expertModeOff}</span>
                  <input type="checkbox" checked={expertMode} disabled={streaming} onChange={(event) => void toggleExpertMode(event.target.checked)} />
                </label>
              </div>
            )}

            <div className="settings-section">
              <div className="settings-section-heading"><Globe2 size={18} /><strong>{copy.language}</strong></div>
              <div className="settings-segments">
                {(["system", "en", "zh"] as LanguagePreference[]).map((value) => (
                  <button key={value} type="button" aria-pressed={language === value} className={language === value ? "segment-active" : ""} onClick={() => setLanguage(value)}>
                    {value === "system" ? copy.system : value === "en" ? "English" : "中文"}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-heading"><Settings size={18} /><div><strong>{copy.fontSize}</strong><span>{copy.fontSizeDetail}</span></div></div>
              <div className="font-scale-control"><span>{copy.small}</span><input aria-label={copy.fontSize} type="range" min="0.85" max="1.3" step="0.05" value={fontScale} onChange={(event) => setFontScale(Number(event.target.value))} /><span>{copy.large}</span></div>
            </div>

            <div className="settings-section">
              <div className="settings-section-heading"><MessageSquarePlus size={18} /><div><strong>{copy.feedback}</strong><span>{copy.feedbackDetail}</span></div></div>
              <textarea className="feedback-field" rows={4} maxLength={4000} value={feedbackDraft} placeholder={copy.feedbackPrompt} onChange={(event) => { setFeedbackDraft(event.target.value); setFeedbackStatus("idle"); }} />
              <button className="settings-primary" type="button" disabled={feedbackDraft.trim().length < 3 || feedbackStatus === "sending"} onClick={() => void submitSettingsFeedback()}>
                {feedbackStatus === "sending" ? <RefreshCw className="spin" size={17} /> : feedbackStatus === "sent" ? <Check size={17} /> : <Send size={17} />}
                {feedbackStatus === "sending" ? copy.sendingFeedback : feedbackStatus === "sent" ? copy.feedbackSent : copy.sendFeedback}
              </button>
            </div>

            {settingsError && <div className="settings-error">{settingsError}</div>}
          </section>
        </div>
      )}
      {avatarCropFile && <AvatarCropDialog
        file={avatarCropFile}
        copy={{ title: copy.cropAvatar, detail: copy.cropAvatarDetail, zoom: copy.zoom, reset: copy.reset, cancel: copy.cancel, apply: copy.applyCrop, processing: copy.processingCrop, error: copy.cropError }}
        onApply={applyAvatarCrop}
        onCancel={() => setAvatarCropFile(null)}
      />}
      {confirmation && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className={`confirm-icon ${confirmation.kind === "branch" ? "branch-confirm-icon" : ""}`}>
              {confirmation.kind === "branch" ? <GitFork size={20} /> : <Trash2 size={20} />}
            </div>
            <h2 id="confirm-title">{confirmation.title}</h2>
            <p>{confirmation.body}</p>
            <div className="dialog-actions">
              <button onClick={() => setConfirmation(null)}>{copy.cancel}</button>
              <button className={confirmation.kind === "branch" ? "branch-command" : "danger-command"} onClick={() => { const action = confirmation.run; setConfirmation(null); action(); }}>
                {confirmation.kind === "branch" ? <GitFork size={16} /> : <Trash2 size={16} />}{confirmation.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
