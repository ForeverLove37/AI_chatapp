"use client";

import {
  Activity,
  ArrowRightLeft,
  Bot,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleX,
  Cpu,
  Database,
  KeyRound,
  Layers3,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Provider = "openai" | "gemini" | "deepseek";
type Strategy = "round_robin" | "random";
type Section = "Overview" | "Users" | "Client keys" | "Provider keys" | "Routing" | "Connections";

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
  routing: { strategy: Strategy };
};

const sections: { name: Section; icon: typeof Activity }[] = [
  { name: "Overview", icon: Activity },
  { name: "Users", icon: Users },
  { name: "Client keys", icon: KeyRound },
  { name: "Provider keys", icon: Database },
  { name: "Routing", icon: Layers3 },
  { name: "Connections", icon: Wifi },
];

const number = new Intl.NumberFormat("en-US");
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function statusClass(status: string) {
  return status === "active" || status === "ok" || status === "success" ? "status status-good" : "status status-muted";
}

function secondsLabel(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3_600)}h`;
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/admin/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "The operation failed.");
  return payload;
}

export default function AdminPage() {
  const [section, setSection] = useState<Section>("Overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [userForm, setUserForm] = useState({ email: "", role: "standard", rpmLimit: "60", dailyLimit: "100000" });
  const [clientKeyForm, setClientKeyForm] = useState({ name: "", userId: "", rpmLimit: "60", dailyLimit: "100000" });
  const [providerForm, setProviderForm] = useState({ provider: "openai" as Provider, label: "", endpoint: "", secret: "", priority: "100" });
  const [mappingForm, setMappingForm] = useState({ id: "", provider: "openai" as Provider, upstreamModel: "", label: "", description: "", uiMode: "chatgpt", aliases: "" });

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
          role: userForm.role,
          rpmLimit: Number(userForm.rpmLimit),
          dailyLimit: Number(userForm.dailyLimit),
        }),
      });
      setUserForm({ email: "", role: "standard", rpmLimit: "60", dailyLimit: "100000" });
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

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Bot size={20} strokeWidth={2.4} /></div>
          <div><strong>Adaptive Chat</strong><span>Control room</span></div>
        </div>
        <nav aria-label="Admin sections" className="nav-list">
          {sections.map(({ name, icon: Icon }) => (
            <button className={`nav-item ${section === name ? "nav-item-active" : ""}`} key={name} onClick={() => setSection(name)} type="button">
              <Icon size={18} /><span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><div className="environment-dot" /><span>{overview?.storage ?? "Connecting"}</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">Operations</p><h1>{section}</h1></div>
          <div className="topbar-actions">
            {overview && <span className={statusClass(overview.health.status)}><CircleCheck size={14} /> API online</span>}
            <button aria-label="Refresh operational data" className="icon-button" disabled={refreshing} onClick={() => void loadOverview(true)} title="Refresh operational data" type="button">
              <RefreshCw className={refreshing ? "spin" : ""} size={18} />
            </button>
          </div>
        </header>

        <div className="content">
          {error && <div className="alert" role="alert"><CircleAlert size={18} /><span>{error}</span><button onClick={() => void loadOverview()} type="button">Retry</button></div>}
          {loading && !overview ? <div className="loading"><LoaderCircle className="spin" size={22} /> Loading operations data</div> : null}
          {overview && section === "Overview" && <OverviewPanel overview={overview} modelTraffic={modelTraffic} />}
          {overview && section === "Users" && <UsersPanel form={userForm} onChange={setUserForm} onSubmit={submitUser} onToggle={(user) => void mutate(() => request(`users/${user.id}`, { method: "PATCH", body: JSON.stringify({ status: user.status === "active" ? "suspended" : "active" }) }))} submitting={submitting} users={overview.users} />}
          {overview && section === "Client keys" && <ClientKeysPanel createdSecret={createdSecret} form={clientKeyForm} onChange={setClientKeyForm} onDismissSecret={() => setCreatedSecret(null)} onRevoke={(id) => void mutate(() => request(`api-keys/${id}`, { method: "DELETE" }))} onSubmit={submitClientKey} submitting={submitting} keys={overview.keys} users={overview.users} />}
          {overview && section === "Provider keys" && <ProviderKeysPanel form={providerForm} keys={overview.providerKeys} onChange={setProviderForm} onSubmit={submitProviderKey} onToggle={(key) => void mutate(() => request(`provider-keys/${key.id}`, { method: "PATCH", body: JSON.stringify({ status: key.status === "active" ? "disabled" : "active" }) }))} submitting={submitting} />}
          {overview && section === "Routing" && <RoutingPanel form={mappingForm} models={overview.models} onChange={setMappingForm} onSave={(id, patch) => void mutate(() => request(`models/${id}`, { method: "PATCH", body: JSON.stringify(patch) }))} onSetStrategy={(strategy) => void mutate(() => request("routing", { method: "PATCH", body: JSON.stringify({ strategy }) }))} onSubmit={submitMapping} strategy={overview.routing.strategy} submitting={submitting} />}
          {overview && section === "Connections" && <ConnectionsPanel overview={overview} />}
        </div>
      </section>
    </main>
  );
}

function OverviewPanel({ overview, modelTraffic }: { overview: Overview; modelTraffic: Array<Model & { calls: number; width: string }> }) {
  return <>
    <div className="metrics-grid">
      <Metric icon={Activity} label="Requests" tone="teal" value={number.format(overview.metrics.totalRequests)} detail="Persistent request log" />
      <Metric icon={ShieldCheck} label="Success rate" tone="green" value={`${overview.metrics.successRate}%`} detail={`${number.format(overview.metrics.successfulRequests)} completed`} />
      <Metric icon={Cpu} label="Token volume" tone="orange" value={compactNumber.format(overview.metrics.promptTokens + overview.metrics.completionTokens)} detail="Prompt and completion" />
      <Metric icon={Link2} label="Active streams" tone="blue" value={number.format(overview.health.activeStreams)} detail={`Uptime ${secondsLabel(overview.health.uptimeSeconds)}`} />
    </div>
    <div className="two-column">
      <section className="data-section"><SectionHeading title="Model traffic" detail="Request volume by internal model name" /><div className="traffic-list">{modelTraffic.map((model) => <div className="traffic-row" key={model.id}><div className="traffic-label"><span>{model.id}</span><strong>{number.format(model.calls)}</strong></div><div className="bar-track"><div className="bar-fill" style={{ width: model.width }} /></div></div>)}</div></section>
      <section className="data-section"><SectionHeading title="Routing state" detail="Configured upstream availability" /><div className="routing-summary">{modelTraffic.map((model) => <div className="routing-line" key={model.id}><div><strong>{model.label}</strong><span>{model.upstreamModel}</span></div><span className={model.upstreamConfigured ? "status status-good" : "status status-muted"}>{model.upstreamConfigured ? <CircleCheck size={14} /> : <CirclePause size={14} />}{model.upstreamConfigured ? "Ready" : "Unconfigured"}</span></div>)}</div></section>
    </div>
    <section className="data-section"><SectionHeading title="Service state" detail={`Last sampled ${new Date(overview.generatedAt).toLocaleTimeString()}`} /><div className="state-grid"><div><span>Provider keys</span><strong>{overview.providerKeys.filter((key) => key.status === "active").length}</strong></div><div><span>Client keys</span><strong>{overview.keys.filter((key) => key.status === "active").length}</strong></div><div><span>Active users</span><strong>{overview.users.filter((user) => user.status === "active").length}</strong></div><div><span>Failures</span><strong>{number.format(overview.metrics.failedRequests)}</strong></div></div></section>
  </>;
}

function UsersPanel({ form, onChange, onSubmit, onToggle, submitting, users }: { form: { email: string; role: string; rpmLimit: string; dailyLimit: string }; onChange: (value: { email: string; role: string; rpmLimit: string; dailyLimit: string }) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onToggle: (user: UserRecord) => void; submitting: boolean; users: UserRecord[] }) {
  return <>
    <section className="data-section"><SectionHeading title="Create user" detail="Accounts are created only by an administrator" /><form className="form-grid" onSubmit={onSubmit}><label>Email<input type="email" required value={form.email} onChange={(event) => onChange({ ...form, email: event.target.value })} /></label><label>Role<select value={form.role} onChange={(event) => onChange({ ...form, role: event.target.value })}><option value="standard">Standard</option><option value="admin">Admin</option></select></label><label>RPM<input min="1" type="number" value={form.rpmLimit} onChange={(event) => onChange({ ...form, rpmLimit: event.target.value })} /></label><label>Daily quota<input min="1" type="number" value={form.dailyLimit} onChange={(event) => onChange({ ...form, dailyLimit: event.target.value })} /></label><button className="primary-button form-action" disabled={submitting} type="submit"><UserPlus size={16} />Create user</button></form></section>
    <section className="data-section"><SectionHeading title="User access" detail="Status, role, and quotas" /><div className="table-wrap"><table><thead><tr><th>Identity</th><th>Role</th><th>Limits</th><th>Monthly tokens</th><th>Status</th><th /></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.email}</strong><span>{user.id}</span></td><td><span className="role-label">{user.role}</span></td><td>{user.rpmLimit} RPM<span>{number.format(user.dailyLimit)} daily</span></td><td>{number.format(user.monthlyTokens)}</td><td><span className={statusClass(user.status)}>{user.status === "active" ? <CircleCheck size={14} /> : <CirclePause size={14} />}{user.status}</span></td><td><button className="small-button" onClick={() => onToggle(user)} type="button">{user.status === "active" ? "Suspend" : "Restore"}</button></td></tr>)}</tbody></table></div></section>
  </>;
}

function ClientKeysPanel({ createdSecret, form, keys, onChange, onDismissSecret, onRevoke, onSubmit, submitting, users }: { createdSecret: string | null; form: { name: string; userId: string; rpmLimit: string; dailyLimit: string }; keys: ApiKey[]; onChange: (value: { name: string; userId: string; rpmLimit: string; dailyLimit: string }) => void; onDismissSecret: () => void; onRevoke: (id: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitting: boolean; users: UserRecord[] }) {
  return <>
    <section className="data-section"><SectionHeading title="Issue client key" detail="A secret is shown once and stored as a hash" /><form className="form-grid" onSubmit={onSubmit}><label>Name<input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></label><label>User<select value={form.userId} onChange={(event) => onChange({ ...form, userId: event.target.value })}><option value="">Unassigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label><label>RPM<input min="1" type="number" value={form.rpmLimit} onChange={(event) => onChange({ ...form, rpmLimit: event.target.value })} /></label><label>Daily quota<input min="1" type="number" value={form.dailyLimit} onChange={(event) => onChange({ ...form, dailyLimit: event.target.value })} /></label><button className="primary-button form-action" disabled={submitting} type="submit"><Plus size={16} />Issue key</button></form></section>
    {createdSecret && <section className="secret-notice"><div><ShieldCheck size={19} /><span>New client key</span></div><code>{createdSecret}</code><button className="icon-button" onClick={onDismissSecret} title="Dismiss new key" type="button"><CircleX size={17} /></button></section>}
    <section className="data-section"><SectionHeading title="Client keys" detail="Rate and daily quota usage are sourced from Redis" /><div className="table-wrap"><table><thead><tr><th>Name</th><th>Prefix</th><th>Usage</th><th>Status</th><th /></tr></thead><tbody>{keys.map((key) => <tr key={key.id}><td><strong>{key.name}</strong><span>{new Date(key.createdAt).toLocaleDateString()}</span></td><td><code>{key.prefix}</code></td><td>{key.rpmUsed} / {key.rpmLimit} RPM<span>{number.format(key.callsToday)} / {number.format(key.dailyLimit)} daily</span></td><td><span className={statusClass(key.status)}>{key.status === "active" ? <CircleCheck size={14} /> : <CirclePause size={14} />}{key.status}</span></td><td>{key.status === "active" && <button aria-label={`Revoke ${key.name}`} className="icon-button danger-button" onClick={() => onRevoke(key.id)} title={`Revoke ${key.name}`} type="button"><Trash2 size={17} /></button>}</td></tr>)}</tbody></table></div></section>
  </>;
}

function ProviderKeysPanel({ form, keys, onChange, onSubmit, onToggle, submitting }: { form: { provider: Provider; label: string; endpoint: string; secret: string; priority: string }; keys: ProviderKey[]; onChange: (value: { provider: Provider; label: string; endpoint: string; secret: string; priority: string }) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onToggle: (key: ProviderKey) => void; submitting: boolean }) {
  return <>
    <section className="data-section"><SectionHeading title="Add provider key" detail="Secrets are encrypted before PostgreSQL storage" /><form className="form-grid provider-form" onSubmit={onSubmit}><label>Provider<select value={form.provider} onChange={(event) => onChange({ ...form, provider: event.target.value as Provider })}><option value="openai">OpenAI-compatible</option><option value="gemini">Gemini</option><option value="deepseek">DeepSeek</option></select></label><label>Label<input required value={form.label} onChange={(event) => onChange({ ...form, label: event.target.value })} /></label><label className="wide-field">Endpoint<input required type="url" placeholder="https://provider.example/v1" value={form.endpoint} onChange={(event) => onChange({ ...form, endpoint: event.target.value })} /></label><label>Secret<input required type="password" autoComplete="new-password" value={form.secret} onChange={(event) => onChange({ ...form, secret: event.target.value })} /></label><label>Priority<input min="0" type="number" value={form.priority} onChange={(event) => onChange({ ...form, priority: event.target.value })} /></label><button className="primary-button form-action" disabled={submitting} type="submit"><Plus size={16} />Add provider key</button></form></section>
    <section className="data-section"><SectionHeading title="Key pool" detail="Lowest numeric priority is selected first; tied tiers use the routing strategy" /><div className="table-wrap"><table><thead><tr><th>Provider</th><th>Label</th><th>Endpoint</th><th>Priority</th><th>Last used</th><th>Status</th><th /></tr></thead><tbody>{keys.map((key) => <tr key={key.id}><td><span className={`provider-tag provider-${key.provider}`}>{key.provider}</span></td><td><strong>{key.label}</strong></td><td><code>{key.endpoint}</code></td><td>{key.priority}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}</td><td><span className={statusClass(key.status)}>{key.status === "active" ? <CircleCheck size={14} /> : <CirclePause size={14} />}{key.status}</span></td><td><button className="small-button" onClick={() => onToggle(key)} type="button">{key.status === "active" ? "Disable" : "Enable"}</button></td></tr>)}</tbody></table></div></section>
  </>;
}

function RoutingPanel({ form, models, onChange, onSave, onSetStrategy, onSubmit, strategy, submitting }: { form: { id: string; provider: Provider; upstreamModel: string; label: string; description: string; uiMode: string; aliases: string }; models: Model[]; onChange: (value: { id: string; provider: Provider; upstreamModel: string; label: string; description: string; uiMode: string; aliases: string }) => void; onSave: (id: string, patch: Partial<Pick<Model, "upstreamModel" | "enabled">>) => void; onSetStrategy: (strategy: Strategy) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; strategy: Strategy; submitting: boolean }) {
  return <>
    <section className="data-section"><SectionHeading title="Load balancing" detail="Applies within matching priority tiers" /><div className="strategy-row"><div className="segmented" role="group" aria-label="Routing strategy"><button className={strategy === "round_robin" ? "segment-active" : ""} disabled={submitting} onClick={() => onSetStrategy("round_robin")} type="button"><ArrowRightLeft size={16} />Round robin</button><button className={strategy === "random" ? "segment-active" : ""} disabled={submitting} onClick={() => onSetStrategy("random")} type="button">Randomized</button></div><span className="strategy-note">Current: {strategy === "round_robin" ? "round robin" : "randomized"}</span></div></section>
    <section className="data-section"><SectionHeading title="Model mappings" detail="Internal names sent by clients are translated before upstream dispatch" /><div className="mapping-list">{models.map((model) => <article className="mapping-row" key={model.id}><div className={`provider-swatch provider-${model.uiMode}`}>{model.label.slice(0, 1)}</div><div className="mapping-copy"><strong>{model.id}</strong><span>{model.provider} · {model.label}</span></div><label className="mapping-input"><span>Upstream model</span><input defaultValue={model.upstreamModel} key={`${model.id}-${model.upstreamModel}`} onBlur={(event) => { if (event.target.value !== model.upstreamModel) onSave(model.id, { upstreamModel: event.target.value }); }} /></label><button className={`small-button ${model.enabled ? "" : "button-muted"}`} onClick={() => onSave(model.id, { enabled: !model.enabled })} type="button">{model.enabled ? "Disable" : "Enable"}</button></article>)}</div></section>
    <section className="data-section"><SectionHeading title="Add mapping" detail="Expose a new internal model name without changing the mobile client" /><form className="form-grid mapping-form" onSubmit={onSubmit}><label>Internal name<input required placeholder="gemini-fast" value={form.id} onChange={(event) => onChange({ ...form, id: event.target.value })} /></label><label>Provider<select value={form.provider} onChange={(event) => { const provider = event.target.value as Provider; onChange({ ...form, provider, uiMode: provider === "openai" ? "chatgpt" : provider }); }}><option value="openai">OpenAI-compatible</option><option value="gemini">Gemini</option><option value="deepseek">DeepSeek</option></select></label><label>Upstream model<input required value={form.upstreamModel} onChange={(event) => onChange({ ...form, upstreamModel: event.target.value })} /></label><label>Label<input required value={form.label} onChange={(event) => onChange({ ...form, label: event.target.value })} /></label><label className="wide-field">Description<input required value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} /></label><label>Aliases<input placeholder="alias-one, alias-two" value={form.aliases} onChange={(event) => onChange({ ...form, aliases: event.target.value })} /></label><button className="primary-button form-action" disabled={submitting} type="submit"><Plus size={16} />Add mapping</button></form></section>
  </>;
}

function ConnectionsPanel({ overview }: { overview: Overview }) {
  return <div className="metrics-grid connection-grid"><Metric icon={Wifi} label="Live SSE" tone="blue" value={number.format(overview.health.activeStreams)} detail="Connections in flight" /><Metric icon={CircleCheck} label="Completed" tone="green" value={number.format(overview.metrics.successfulRequests)} detail="Persisted successes" /><Metric icon={CircleX} label="Failed" tone="orange" value={number.format(overview.metrics.failedRequests)} detail="Provider or relay failures" /><Metric icon={Activity} label="Service uptime" tone="teal" value={secondsLabel(overview.health.uptimeSeconds)} detail="Current process lifetime" /></div>;
}

function Metric({ icon: Icon, label, tone, value, detail }: { icon: typeof Activity; label: string; tone: string; value: string; detail: string }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-icon"><Icon size={18} /></div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{detail}</p></div></div>;
}
