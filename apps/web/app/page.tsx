"use client";

import {
  Bot,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  Edit3,
  FileImage,
  Globe2,
  LogOut,
  Menu,
  MessageSquarePlus,
  Mic,
  Moon,
  Network,
  PanelLeftClose,
  RefreshCw,
  Send,
  Sparkles,
  Sun,
  Trash2,
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

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://chatapi.zengjunjie.com").replace(/\/$/, "");
const AUTO_SCROLL_EDGE_PX = 56;

type Language = "en" | "zh";
type Theme = "light" | "dark";
type Role = "user" | "assistant" | "system";

type ChannelModel = { id: string; label: string; description: string };
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
type Confirmation = { title: string; body: string; confirm: string; run: () => void };

const COPY = {
  en: {
    product: "Adaptive Chat", synchronized: "Synchronized workspace", email: "Email", password: "Password",
    signIn: "Sign in", signingIn: "Signing in", noRegistration: "Accounts are created by an administrator.",
    newChat: "New conversation", conversations: "Conversations", noHistory: "No conversations yet", signOut: "Sign out",
    channel: "Channel", model: "Model", light: "Light theme", dark: "Dark theme", language: "Language",
    welcome: "How can I help?", welcomeDetail: "Choose a channel and start a synchronized conversation.",
    placeholder: "Message Adaptive Chat", send: "Send", attach: "Attach image", voice: "Voice input",
    webSearch: "Web search", webSearchOn: "Web search enabled for this prompt", remove: "Remove attachment",
    copy: "Copy", edit: "Edit", delete: "Delete", redo: "Redo", branch: "Branch", listen: "Listen",
    reasoning: "Reasoning process", thinking: "Thinking", waiting: "Waiting for the first token",
    deleteMessage: "Delete message?", deleteMessageBody: "The message will be permanently removed. A user prompt and its paired AI response are deleted together.",
    deleteChat: "Delete conversation?", deleteChatBody: "The conversation and all of its messages will be permanently removed.",
    createBranch: "Create conversation branch?", createBranchBody: "A separate synchronized conversation will be created from this point.",
    cancel: "Cancel", confirm: "Confirm", editing: "Editing message", stopEditing: "Cancel editing",
    syncError: "Unable to synchronize conversations.", loginError: "Unable to sign in.", requestError: "The response could not be completed.",
    menu: "Open conversations", closeSidebar: "Close conversations", account: "Account",
  },
  zh: {
    product: "Adaptive Chat", synchronized: "跨端同步工作区", email: "邮箱", password: "密码",
    signIn: "登录", signingIn: "正在登录", noRegistration: "账号仅由管理员创建。",
    newChat: "新建会话", conversations: "会话", noHistory: "暂无会话", signOut: "退出登录",
    channel: "频道", model: "模型", light: "浅色主题", dark: "深色主题", language: "语言",
    welcome: "有什么可以帮你？", welcomeDetail: "选择频道并开始一段跨端同步的对话。",
    placeholder: "发送消息给 Adaptive Chat", send: "发送", attach: "添加图片", voice: "语音输入",
    webSearch: "网页搜索", webSearchOn: "本次提问已启用网页搜索", remove: "移除附件",
    copy: "复制", edit: "编辑", delete: "删除", redo: "重新生成", branch: "创建分支", listen: "朗读",
    reasoning: "推理过程", thinking: "正在思考", waiting: "正在等待首个响应片段",
    deleteMessage: "删除消息？", deleteMessageBody: "该消息将被永久删除。删除用户消息时，其配对的 AI 回复也会一并删除。",
    deleteChat: "删除会话？", deleteChatBody: "该会话及其全部消息将被永久删除。",
    createBranch: "创建会话分支？", createBranchBody: "将从当前位置创建一个独立且同步的新会话。",
    cancel: "取消", confirm: "确认", editing: "正在编辑消息", stopEditing: "取消编辑",
    syncError: "无法同步会话。", loginError: "无法登录。", requestError: "未能完成响应。",
    menu: "打开会话列表", closeSidebar: "关闭会话列表", account: "账号",
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
      ...(init.body ? { "Content-Type": "application/json" } : {}),
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
  return {
    "--channel-start": theme === "dark" ? "#151817" : start,
    "--channel-end": theme === "dark" ? "#202523" : end,
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
  const [streaming, setStreaming] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [language, setLanguage] = useState<Language>("en");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messageViewport = useRef<HTMLDivElement>(null);
  const autoScrollPaused = useRef(false);
  const copy = COPY[language];

  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  const channel = config?.channels.find((item) => item.id === selected?.channelId)
    ?? config?.channels[0];
  const model = channel?.models.find((item) => item.id === selected?.modelId) ?? channel?.models[0];

  const loadSessions = useCallback(async (currentToken: string, quiet = false) => {
    try {
      const result = await api<{ data: ChatSession[] }>("/v1/sessions", currentToken);
      setSessions(result.data);
      setSelectedId((current) => result.data.some((session) => session.id === current)
        ? current
        : result.data[0]?.id ?? "");
      if (!quiet) setError("");
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : copy.syncError);
    }
  }, [copy.syncError]);

  useEffect(() => {
    const storedToken = localStorage.getItem("adaptive-chat-token") ?? "";
    const storedEmail = localStorage.getItem("adaptive-chat-email") ?? "";
    const storedTheme = localStorage.getItem("adaptive-chat-theme") as Theme | null;
    const storedLanguage = localStorage.getItem("adaptive-chat-language") as Language | null;
    setToken(storedToken);
    setEmail(storedEmail);
    if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
    if (storedLanguage === "en" || storedLanguage === "zh") setLanguage(storedLanguage);
    void api<RemoteConfig>("/v1/config").then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadSessions(token);
    const interval = window.setInterval(() => {
      if (!streaming && !document.hidden) void loadSessions(token, true);
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [loadSessions, streaming, token]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("adaptive-chat-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    localStorage.setItem("adaptive-chat-language", language);
  }, [language]);

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
  }, [token]);

  const replaceSession = useCallback((session: ChatSession) => {
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt));
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || password.length < 8 || loginPending) return;
    setLoginPending(true);
    setLoginError("");
    try {
      const result = await api<{ token: string; user: { email: string } }>("/v1/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      localStorage.setItem("adaptive-chat-token", result.token);
      localStorage.setItem("adaptive-chat-email", result.user.email);
      setEmail(result.user.email);
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
    setToken("");
    setSessions([]);
    setSelectedId("");
    setDraft("");
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
    replaceSession(next);
    await persist(next);
  }

  async function streamAssistant(base: ChatSession, assistantId: string, source: ChatMessage[], searchEnabled: boolean) {
    setStreaming(true);
    setWaiting(true);
    setError("");
    let working = base;
    let rawContent = "";
    let explicitReasoning = "";
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
          stream: true,
          messages: [
            ...(base.systemPrompt ? [{ role: "system", content: base.systemPrompt }] : []),
            ...contextMessages,
          ],
        }),
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
      const message = cause instanceof Error ? cause.message : copy.requestError;
      const timestamp = Date.now();
      working = {
        ...working,
        updatedAt: timestamp,
        messages: working.messages.map((item) => item.id === assistantId
          ? { ...item, isStreaming: false, errorText: message, updatedAt: timestamp }
          : item),
      };
      replaceSession(working);
      setError(message);
    } finally {
      setWaiting(false);
      setStreaming(false);
      await persist(working).catch(() => setError(copy.syncError));
      setWebSearch(false);
    }
  }

  async function send() {
    if (streaming || (!draft.trim() && !attachments.length) || !config) return;
    const active = selected ?? await createSession();
    if (!active) return;
    const timestamp = Date.now();
    let userMessage: ChatMessage;
    let source: ChatMessage[];
    if (editingId) {
      const index = active.messages.findIndex((message) => message.id === editingId && message.role === "user");
      if (index < 0) return;
      userMessage = {
        ...active.messages[index],
        content: draft.trim(),
        attachments,
        errorText: "",
        updatedAt: timestamp,
      };
      source = [...active.messages.slice(0, index), userMessage];
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
    await persist(next);
    await streamAssistant(next, assistant.id, source, webSearch);
  }

  async function redo(message: ChatMessage) {
    if (!selected || streaming) return;
    const index = selected.messages.findIndex((item) => item.id === message.id);
    if (index < 0) return;
    const timestamp = Date.now();
    const assistant = { ...message, content: "", reasoning: "", errorText: "", isStreaming: true, updatedAt: timestamp };
    const source = selected.messages.slice(0, index);
    const next = { ...selected, updatedAt: timestamp, messages: [...source, assistant] };
    replaceSession(next);
    await persist(next);
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
    recognition.lang = language === "zh" ? "zh-CN" : "en-US";
    recognition.onresult = (event) => setDraft((current) => `${current}${current ? " " : ""}${event.results[0][0].transcript}`);
    recognition.start();
  }

  const shellStyle = useMemo(() => channel ? channelVariables(channel, theme) : {}, [channel, theme]);
  const terminalUserId = [...(selected?.messages ?? [])].reverse().find((message) => message.role === "user")?.id;

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
          <button className="language-switch" onClick={() => setLanguage(language === "en" ? "zh" : "en")}>{language === "en" ? "中文" : "English"}</button>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`chat-shell channel-${channel?.id ?? "chatgpt"} ${channel?.style.animatedGradient ? "animated-channel" : ""}`}
      style={shellStyle}
    >
      <aside className={`conversation-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <img src="/brand" alt="" />
          <div><strong>{copy.product}</strong><span>{copy.synchronized}</span></div>
          <button className="icon-command mobile-only" title={copy.closeSidebar} aria-label={copy.closeSidebar} onClick={() => setSidebarOpen(false)}><PanelLeftClose size={20} /></button>
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
          <div><span>{copy.account}</span><strong>{email}</strong></div>
          <button className="icon-command" title={copy.signOut} aria-label={copy.signOut} onClick={logout}><LogOut size={18} /></button>
        </div>
      </aside>

      <section className="conversation-workspace">
        <header className="chat-header">
          <button className="icon-command mobile-only" title={copy.menu} aria-label={copy.menu} onClick={() => setSidebarOpen(true)}><Menu size={21} /></button>
          <div className="channel-model-controls">
            <label>
              <span>{copy.channel}</span>
              <div className="select-wrap">
                {channel && <ChannelIcon channel={channel} />}
                <select value={channel?.id ?? ""} onChange={(event) => void updateSelection(event.target.value)}>
                  {(config?.channels ?? []).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <label>
              <span>{copy.model}</span>
              <div className="select-wrap model-select">
                <Sparkles size={17} />
                <select value={model?.id ?? ""} onChange={(event) => channel && void updateSelection(channel.id, event.target.value)}>
                  {(channel?.models ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
          </div>
          <div className="header-actions">
            <button className="icon-command" title={copy.language} aria-label={copy.language} onClick={() => setLanguage(language === "en" ? "zh" : "en")}>{language === "en" ? "中" : "EN"}</button>
            <button className="icon-command" title={theme === "light" ? copy.dark : copy.light} aria-label={theme === "light" ? copy.dark : copy.light} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
              {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
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
                          <button title={copy.redo} disabled={streaming} onClick={() => void redo(message)}><RefreshCw size={15} />{copy.redo}</button>
                          <button title={copy.copy} disabled={!message.content} onClick={() => void navigator.clipboard.writeText(message.content)}><Clipboard size={15} />{copy.copy}</button>
                          <button title={copy.branch} disabled={streaming} onClick={() => confirmBranch(message)}><Network size={15} />{copy.branch}</button>
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
              <button className="send-command" title={copy.send} aria-label={copy.send} disabled={streaming || (!draft.trim() && !attachments.length)} onClick={() => void send()}>
                {streaming ? <RefreshCw className="spin" size={19} /> : <Send size={19} />}
              </button>
            </div>
          </div>
        </footer>
      </section>

      {sidebarOpen && <button className="sidebar-scrim mobile-only" aria-label={copy.closeSidebar} onClick={() => setSidebarOpen(false)} />}
      {confirmation && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="confirm-icon"><Trash2 size={20} /></div>
            <h2 id="confirm-title">{confirmation.title}</h2>
            <p>{confirmation.body}</p>
            <div className="dialog-actions">
              <button onClick={() => setConfirmation(null)}>{copy.cancel}</button>
              <button className="danger-command" onClick={() => { const action = confirmation.run; setConfirmation(null); action(); }}><Trash2 size={16} />{confirmation.confirm}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
