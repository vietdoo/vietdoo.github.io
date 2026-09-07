import { For, Show, createMemo, createSignal, onMount } from "solid-js";

type Model = {
  id: string;
  label: string;
  provider: string;
  capabilities: string[];
  priority: number;
  credentialConfigured: boolean;
  enabled: boolean;
};

type AiLog = {
  id: number;
  requestId: string;
  kind: string;
  status: string;
  capabilities: string[];
  attemptedProviders: string[];
  attemptCount: number;
  usedFallback: boolean;
  inputChars: number;
  durationMs: number;
  provider: string | null;
  modelLabel: string | null;
  errorCode: string | null;
  errorStatus: number | null;
  createdAt: string;
};

type AiSummary = {
  headline: string;
  bullets: string[];
  tone: "positive" | "neutral" | "attention";
  generatedAt: string;
  expiresAt: string;
  cached: boolean;
  degraded: boolean;
  sourceWindow: number;
  cacheTtlSeconds: number;
};

type View = "overview" | "logs" | "models";

const navItems: Array<{ id: View; label: string; short: string }> = [
  { id: "overview", label: "Overview", short: "○" },
  { id: "logs", label: "AI request logs", short: "≋" },
  { id: "models", label: "Model controls", short: "◇" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(value: number) {
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

function titleCase(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function AdminDashboard() {
  const [authenticated, setAuthenticated] = createSignal(false);
  const [checking, setChecking] = createSignal(true);
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [passwordVisible, setPasswordVisible] = createSignal(false);
  const [loginError, setLoginError] = createSignal("");
  const [loginLoading, setLoginLoading] = createSignal(false);
  const [view, setView] = createSignal<View>("overview");
  const [models, setModels] = createSignal<Model[]>([]);
  const [logs, setLogs] = createSignal<AiLog[]>([]);
  const [totalLogs, setTotalLogs] = createSignal(0);
  const [selectedLog, setSelectedLog] = createSignal<AiLog | null>(null);
  const [loadingData, setLoadingData] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const [toggleLoading, setToggleLoading] = createSignal("");
  const [dataError, setDataError] = createSignal("");
  const [aiSummary, setAiSummary] = createSignal<AiSummary | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = createSignal(false);
  const [aiSummaryError, setAiSummaryError] = createSignal("");

  const summary = createMemo(() => {
    const current = logs();
    return {
      total: totalLogs(),
      successful: current.filter((log) => log.status === "success").length,
      fallback: current.filter((log) => log.usedFallback).length,
      average: current.length
        ? Math.round(
            current.reduce((sum, log) => sum + log.durationMs, 0) /
              current.length,
          )
        : 0,
    };
  });

  const enabledModels = createMemo(
    () => models().filter((model) => model.enabled).length,
  );

  async function loadAiSummary() {
    setAiSummaryLoading(true);
    setAiSummaryError("");
    try {
      const response = await fetch("/api/admin/summary", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) throw new Error("Summary is temporarily unavailable.");
      const body = await response.json();
      setAiSummary(body.summary ?? null);
      if (body.warning) setDataError(body.warning);
    } catch (error) {
      setAiSummaryError(
        error instanceof Error
          ? error.message
          : "Summary is temporarily unavailable.",
      );
    } finally {
      setAiSummaryLoading(false);
    }
  }

  async function loadData(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoadingData(true);
    setDataError("");
    try {
      const [modelsResponse, logsResponse] = await Promise.all([
        fetch("/api/admin/models", { credentials: "same-origin" }),
        fetch("/api/admin/logs?limit=50", { credentials: "same-origin" }),
      ]);
      if (modelsResponse.status === 401 || logsResponse.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!modelsResponse.ok || !logsResponse.ok) {
        throw new Error("Could not load admin data.");
      }
      const modelsBody = await modelsResponse.json();
      const logsBody = await logsResponse.json();
      setModels(modelsBody.models ?? []);
      setLogs(logsBody.logs ?? []);
      setTotalLogs(logsBody.total ?? 0);
      setDataError(logsBody.warning ?? "");
      setAuthenticated(true);
      void loadAiSummary();
    } catch (error) {
      setDataError(
        error instanceof Error ? error.message : "Could not load admin data.",
      );
    } finally {
      setLoadingData(false);
      setRefreshing(false);
    }
  }

  async function login(event: SubmitEvent) {
    event.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username: username().trim(),
          password: password(),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Invalid username or password.");
      }
      setUsername("");
      setPassword("");
      setPasswordVisible(false);
      await loadData();
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Unable to sign in.",
      );
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    setAuthenticated(false);
    setModels([]);
    setLogs([]);
    setAiSummary(null);
    setAiSummaryError("");
    setView("overview");
  }

  async function toggleModel(model: Model) {
    setToggleLoading(model.id);
    setDataError("");
    try {
      const response = await fetch("/api/admin/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ modelId: model.id, enabled: !model.enabled }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not update model.");
      setModels((current) =>
        current.map((item) => (item.id === model.id ? body.model : item)),
      );
    } catch (error) {
      setDataError(
        error instanceof Error ? error.message : "Could not update model.",
      );
    } finally {
      setToggleLoading("");
    }
  }

  onMount(() => {
    fetch("/api/admin/models", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.ok) {
          setAuthenticated(true);
          await loadData();
        }
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  });

  return (
    <div class="admin-app">
      <Show
        when={!checking()}
        fallback={
          <div class="admin-loading-shell" role="status" aria-live="polite">
            <aside class="admin-loading-sidebar" aria-hidden="true">
              <div class="admin-loading-brand">
                <span class="brand-mark small">V</span>
                <span class="admin-loading-brand-lines">
                  <i />
                  <i />
                </span>
              </div>
              <div class="admin-loading-nav-lines">
                <i />
                <i />
                <i />
              </div>
              <div class="admin-loading-sidebar-footer">
                <i />
                <i />
              </div>
            </aside>
            <main class="admin-loading-main">
              <div class="admin-loading-header" aria-hidden="true">
                <div>
                  <i class="admin-loading-line eyebrow-line" />
                  <i class="admin-loading-line title-line" />
                </div>
                <i class="admin-loading-avatar" />
              </div>
              <div class="admin-loading-content" aria-hidden="true">
                <div class="admin-loading-hero">
                  <i class="admin-loading-line hero-kicker" />
                  <i class="admin-loading-line hero-title" />
                  <i class="admin-loading-line hero-copy" />
                </div>
                <div class="admin-loading-metrics">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div class="admin-loading-table">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div class="admin-loading-message">
                <span class="admin-spinner" />
                <span>Preparing secure workspace</span>
              </div>
            </main>
          </div>
        }
      >
        <Show
          when={authenticated()}
          fallback={
            <main class="admin-login-page">
              <div class="login-glow login-glow-one" />
              <div class="login-glow login-glow-two" />
              <section class="login-card">
                <div class="brand-mark">V</div>
                <span class="eyebrow">VNDO / PRIVATE CONSOLE</span>
                <h1>Private workspace.</h1>
                <p>
                  Review request activity and keep the routing layer in order.
                </p>
                <form onSubmit={login} class="login-form">
                  <label for="admin-username">Username</label>
                  <input
                    id="admin-username"
                    name="username"
                    type="text"
                    value={username()}
                    onInput={(event) => setUsername(event.currentTarget.value)}
                    placeholder="Enter your username"
                    autocomplete="username"
                    spellcheck={false}
                    required
                  />
                  <label for="admin-password">Password</label>
                  <div class="password-field">
                    <input
                      id="admin-password"
                      name="password"
                      type={passwordVisible() ? "text" : "password"}
                      value={password()}
                      onInput={(event) =>
                        setPassword(event.currentTarget.value)
                      }
                      placeholder="Enter your password"
                      autocomplete="current-password"
                      spellcheck={false}
                      required
                    />
                    <button
                      class="password-visibility"
                      type="button"
                      onClick={() => setPasswordVisible((visible) => !visible)}
                      aria-label={
                        passwordVisible() ? "Hide password" : "Show password"
                      }
                    >
                      {passwordVisible() ? "Hide" : "Show"}
                    </button>
                  </div>
                  <Show when={loginError()}>
                    <div class="form-error">{loginError()}</div>
                  </Show>
                  <button
                    class="primary-button login-button"
                    type="submit"
                    disabled={loginLoading()}
                  >
                    {loginLoading() ? "Checking access…" : "Enter dashboard"}
                    <span>↗</span>
                  </button>
                </form>
                <div class="login-footnote">
                  <span class="status-dot" /> End-to-end protected session
                </div>
              </section>
            </main>
          }
        >
          <div class="admin-shell">
            <aside class="admin-sidebar">
              <div class="sidebar-top">
                <a href="/" class="admin-brand">
                  <span class="brand-mark small">V</span>
                  <span>
                    <strong>vndo-ai</strong>
                    <em>control room</em>
                  </span>
                </a>
                <span class="live-chip">
                  <i /> LIVE
                </span>
              </div>
              <div class="sidebar-section-label">Workspace</div>
              <nav class="admin-nav">
                <For each={navItems}>
                  {(item) => (
                    <button
                      classList={{
                        "nav-item": true,
                        active: view() === item.id,
                      }}
                      onClick={() => setView(item.id)}
                    >
                      <span class="nav-icon">{item.short}</span>
                      <span>{item.label}</span>
                      {item.id === "logs" && <b>{totalLogs()}</b>}
                    </button>
                  )}
                </For>
              </nav>
              <div class="sidebar-divider" />
              <div class="sidebar-section-label">System</div>
              <div class="system-card">
                <span class="system-icon">⌁</span>
                <div>
                  <strong>Smart routing</strong>
                  <small>{enabledModels()} active routes</small>
                </div>
                <i class="system-online" />
              </div>
              <div class="sidebar-bottom">
                <a href="/playground" class="back-link">
                  ← Back to playground
                </a>
                <button class="logout-button" onClick={logout}>
                  Sign out <span>↗</span>
                </button>
              </div>
            </aside>

            <main class="admin-main">
              <header class="admin-header">
                <div>
                  <span class="eyebrow">VNDO / ADMIN</span>
                  <h1>
                    {view() === "overview"
                      ? "Control room"
                      : view() === "logs"
                        ? "AI request logs"
                        : "Model controls"}
                  </h1>
                </div>
                <div class="header-actions">
                  <span class="header-time">Operational workspace</span>
                  <button
                    class="icon-button"
                    onClick={() => loadData(true)}
                    aria-label="Refresh data"
                    disabled={refreshing()}
                  >
                    {refreshing() ? "…" : "↻"}
                  </button>
                  <div class="avatar">A</div>
                </div>
              </header>
              <Show when={dataError()}>
                <div class="admin-alert">{dataError()}</div>
              </Show>
              <Show
                when={loadingData()}
                fallback={
                  <>
                    <Show when={view() === "overview"}>
                      <section class="dashboard-content">
                        <div class="hero-panel">
                          <div>
                            <span class="eyebrow accent">
                              SYSTEM STATUS / 01
                            </span>
                            <h2>Everything in one view.</h2>
                            <p>
                              Observe your AI layer, keep your routes healthy,
                              and stay close to every request.
                            </p>
                          </div>
                          <div class="hero-status-note">
                            <span class="hero-status-label">
                              ROUTING HEALTH
                            </span>
                            <strong>
                              <i class="status-dot" /> Operational
                            </strong>
                            <small>{enabledModels()} active routes</small>
                          </div>
                        </div>
                        <div class="metric-grid">
                          <div class="metric-card">
                            <span>Total requests</span>
                            <strong>{summary().total}</strong>
                            <small>All recorded AI traffic</small>
                          </div>
                          <div class="metric-card">
                            <span>Current success</span>
                            <strong>
                              {summary().successful}
                              <small class="inline-muted">
                                {" "}
                                / {logs().length || 0}
                              </small>
                            </strong>
                            <small>Last 50 requests</small>
                          </div>
                          <div class="metric-card">
                            <span>Fallback events</span>
                            <strong>{summary().fallback}</strong>
                            <small>Automatic provider switches</small>
                          </div>
                          <div class="metric-card">
                            <span>Avg. latency</span>
                            <strong>
                              {summary().average}
                              <small class="inline-muted"> ms</small>
                            </strong>
                            <small>Observed in current window</small>
                          </div>
                        </div>
                        <section
                          classList={{
                            "ai-summary-card": true,
                            attention: aiSummary()?.tone === "attention",
                            positive: aiSummary()?.tone === "positive",
                          }}
                          aria-live="polite"
                        >
                          <div class="ai-summary-heading">
                            <div>
                              <span class="eyebrow accent">AI SUMMARY</span>
                              <h3>
                                {aiSummaryLoading()
                                  ? "Reading current activity…"
                                  : (aiSummary()?.headline ??
                                    "Summary unavailable")}
                              </h3>
                            </div>
                            <span class="ai-summary-badge">
                              {aiSummaryLoading()
                                ? "Working"
                                : aiSummary()?.cached
                                  ? "Cached · 5 min"
                                  : aiSummary()?.degraded
                                    ? "Rules fallback"
                                    : "Fresh insight"}
                            </span>
                          </div>
                          <Show
                            when={!aiSummaryLoading() && aiSummary()}
                            fallback={
                              <Show
                                when={aiSummaryLoading()}
                                fallback={
                                  <div class="ai-summary-error">
                                    {aiSummaryError() ||
                                      "Metrics remain available while the summary is unavailable."}
                                    <button
                                      class="text-button"
                                      onClick={() => void loadAiSummary()}
                                    >
                                      Try again <span>↻</span>
                                    </button>
                                  </div>
                                }
                              >
                                <div class="ai-summary-loading">
                                  <span class="summary-pulse" />
                                  Comparing recent request outcomes with the
                                  current routing state.
                                </div>
                              </Show>
                            }
                          >
                            {(currentSummary) => (
                              <>
                                <ul class="ai-summary-list">
                                  <For each={currentSummary().bullets}>
                                    {(bullet) => <li>{bullet}</li>}
                                  </For>
                                </ul>
                                <div class="ai-summary-footer">
                                  <span>
                                    Based on latest{" "}
                                    {currentSummary().sourceWindow} requests
                                  </span>
                                  <Show when={currentSummary().degraded}>
                                    <span>Deterministic fallback</span>
                                  </Show>
                                </div>
                              </>
                            )}
                          </Show>
                        </section>
                        <div class="section-heading">
                          <div>
                            <span class="eyebrow">RECENT ACTIVITY</span>
                            <h3>Latest AI requests</h3>
                          </div>
                          <button
                            class="text-button"
                            onClick={() => setView("logs")}
                          >
                            View all <span>→</span>
                          </button>
                        </div>
                        <LogTable
                          logs={logs().slice(0, 8)}
                          onSelect={setSelectedLog}
                          compact
                        />
                        <div class="section-heading model-heading">
                          <div>
                            <span class="eyebrow">ROUTING LAYER</span>
                            <h3>Model fleet</h3>
                          </div>
                          <button
                            class="text-button"
                            onClick={() => setView("models")}
                          >
                            Manage models <span>→</span>
                          </button>
                        </div>
                        <ModelGrid
                          models={models().slice(0, 3)}
                          onToggle={toggleModel}
                          toggleLoading={toggleLoading()}
                        />
                      </section>
                    </Show>
                    <Show when={view() === "logs"}>
                      <section class="dashboard-content">
                        <div class="page-intro">
                          <div>
                            <span class="eyebrow">
                              OBSERVABILITY / REQUESTS
                            </span>
                            <h2>Every request, accounted for.</h2>
                            <p>
                              Privacy-safe audit records from the smart routing
                              layer.
                            </p>
                          </div>
                          <button
                            class="primary-button small-button"
                            onClick={() => loadData(true)}
                          >
                            Refresh logs <span>↻</span>
                          </button>
                        </div>
                        <div class="log-summary">
                          <span>
                            <i class="green-dot" /> {totalLogs()} total records
                          </span>
                          <span>Showing latest {logs().length}</span>
                        </div>
                        <LogTable logs={logs()} onSelect={setSelectedLog} />
                      </section>
                    </Show>
                    <Show when={view() === "models"}>
                      <section class="dashboard-content">
                        <div class="page-intro">
                          <div>
                            <span class="eyebrow">ROUTING LAYER / MODELS</span>
                            <h2>Shape the fleet.</h2>
                            <p>
                              Toggle routes without touching the client. Smart
                              routing handles the rest.
                            </p>
                          </div>
                        </div>
                        <div class="model-callout">
                          <span class="callout-icon">◎</span>
                          <div>
                            <strong>Automatic routing is on</strong>
                            <p>
                              Requests are matched to capabilities, priority and
                              provider health. Disabled routes are skipped
                              immediately.
                            </p>
                          </div>
                        </div>
                        <ModelGrid
                          models={models()}
                          onToggle={toggleModel}
                          toggleLoading={toggleLoading()}
                        />
                      </section>
                    </Show>
                  </>
                }
              >
                <div
                  class="dashboard-loading-shell"
                  role="status"
                  aria-live="polite"
                >
                  <div class="dashboard-loading-heading">
                    <div>
                      <i class="admin-loading-line eyebrow-line" />
                      <i class="admin-loading-line title-line" />
                    </div>
                    <i class="admin-loading-button" />
                  </div>
                  <div class="dashboard-loading-hero">
                    <div>
                      <i class="admin-loading-line hero-kicker" />
                      <i class="admin-loading-line hero-title" />
                      <i class="admin-loading-line hero-copy" />
                    </div>
                    <i class="admin-loading-status" />
                  </div>
                  <div class="admin-loading-metrics">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div class="dashboard-loading-message">
                    <span class="admin-spinner" />
                    <span>Loading workspace data…</span>
                  </div>
                </div>
              </Show>
            </main>
          </div>
          <Show when={selectedLog()}>
            {(log) => (
              <div
                class="drawer-backdrop"
                onClick={(event) => {
                  if (event.target === event.currentTarget)
                    setSelectedLog(null);
                }}
              >
                <aside class="log-drawer">
                  <button
                    class="drawer-close"
                    onClick={() => setSelectedLog(null)}
                    title="Close"
                    aria-label="Close request details"
                  >
                    ×
                  </button>
                  <span class="eyebrow">REQUEST DETAIL</span>
                  <h2>{titleCase(log().kind)}</h2>
                  <span
                    classList={{
                      "status-pill": true,
                      success: log().status === "success",
                      failure: log().status !== "success",
                    }}
                  >
                    {log().status}
                  </span>
                  <div class="detail-list">
                    <div>
                      <span>Request ID</span>
                      <strong>{log().requestId}</strong>
                    </div>
                    <div>
                      <span>Created</span>
                      <strong>{formatDate(log().createdAt)}</strong>
                    </div>
                    <div>
                      <span>Duration</span>
                      <strong>{formatDuration(log().durationMs)}</strong>
                    </div>
                    <div>
                      <span>Attempts</span>
                      <strong>
                        {log().attemptCount}{" "}
                        {log().usedFallback ? "(fallback)" : ""}
                      </strong>
                    </div>
                    <div>
                      <span>Capabilities</span>
                      <strong>{log().capabilities.join(" · ") || "—"}</strong>
                    </div>
                    <div>
                      <span>Route</span>
                      <strong>
                        {log().modelLabel ?? log().provider ?? "—"}
                      </strong>
                    </div>
                    <Show when={log().errorCode}>
                      <div>
                        <span>Error</span>
                        <strong class="error-text">
                          {log().errorCode}
                          {log().errorStatus ? ` / ${log().errorStatus}` : ""}
                        </strong>
                      </div>
                    </Show>
                  </div>
                </aside>
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function LogTable(props: {
  logs: AiLog[];
  onSelect: (log: AiLog) => void;
  compact?: boolean;
}) {
  return (
    <div class="log-table-wrap">
      <table class="log-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Request</th>
            <th>Type</th>
            <th>Capability</th>
            <th>Route</th>
            <th>Latency</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          <Show
            when={props.logs.length}
            fallback={
              <tr>
                <td colspan="7" class="empty-state">
                  No AI request logs yet.
                </td>
              </tr>
            }
          >
            <For each={props.logs}>
              {(log) => (
                <tr onClick={() => props.onSelect(log)}>
                  <td>
                    <span
                      classList={{
                        "status-pill": true,
                        success: log.status === "success",
                        failure: log.status !== "success",
                      }}
                    >
                      {log.status === "success" ? "OK" : log.status}
                    </span>
                  </td>
                  <td>
                    <strong class="request-id">
                      {log.requestId.slice(0, 12)}…
                    </strong>
                    {log.usedFallback && (
                      <span class="fallback-label">fallback</span>
                    )}
                  </td>
                  <td>{titleCase(log.kind)}</td>
                  <td>
                    <div class="capability-list">
                      <For
                        each={log.capabilities.slice(0, props.compact ? 2 : 4)}
                      >
                        {(cap) => <span>{cap}</span>}
                      </For>
                    </div>
                  </td>
                  <td>{log.modelLabel ?? log.provider ?? "—"}</td>
                  <td>{formatDuration(log.durationMs)}</td>
                  <td>{formatDate(log.createdAt)}</td>
                </tr>
              )}
            </For>
          </Show>
        </tbody>
      </table>
    </div>
  );
}

function providerName(provider: string) {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "orcarouter") return "OrcaRouter";
  return titleCase(provider);
}

function providerMark(provider: string) {
  if (provider === "openrouter") return "OR";
  if (provider === "orcarouter") return "O";
  return provider.slice(0, 2).toUpperCase();
}

function groupModelsByProvider(models: Model[]) {
  const grouped = new Map<string, Model[]>();
  for (const model of models) {
    const current = grouped.get(model.provider) ?? [];
    current.push(model);
    grouped.set(model.provider, current);
  }
  return Array.from(grouped.entries())
    .map(([provider, providerModels]) => ({
      provider,
      models: providerModels.toSorted((a, b) => b.priority - a.priority),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

function ModelGrid(props: {
  models: Model[];
  onToggle: (model: Model) => void;
  toggleLoading: string;
}) {
  return (
    <div class="provider-sessions">
      <For each={groupModelsByProvider(props.models)}>
        {(group) => (
          <section class="provider-session">
            <header class="provider-session-header">
              <div class="provider-session-mark">
                {providerMark(group.provider)}
              </div>
              <div class="provider-session-copy">
                <span class="eyebrow">PROVIDER SESSION</span>
                <h3>{providerName(group.provider)}</h3>
                <p>
                  {group.models.filter((model) => model.enabled).length} active
                  routes
                  <span>·</span> {group.models.length} registered models
                </p>
              </div>
              <div class="provider-session-health">
                <i
                  classList={{
                    "session-health-dot": true,
                    offline: !group.models.some(
                      (model) => model.credentialConfigured,
                    ),
                  }}
                />
                <span>
                  {group.models.some((model) => model.credentialConfigured)
                    ? "Credential ready"
                    : "Credential missing"}
                </span>
              </div>
            </header>
            <div class="model-grid provider-model-grid">
              <For each={group.models}>
                {(model) => (
                  <article
                    classList={{
                      "model-card": true,
                      "is-disabled": !model.enabled,
                    }}
                  >
                    <div class="model-card-top">
                      <div class="model-logo">
                        {providerMark(model.provider)}
                      </div>
                      <span
                        classList={{
                          "model-status": true,
                          online: model.enabled && model.credentialConfigured,
                        }}
                      >
                        {!model.credentialConfigured
                          ? "Unconfigured"
                          : model.enabled
                            ? "Enabled"
                            : "Disabled"}
                      </span>
                    </div>
                    <div class="model-card-title">
                      <span class="model-id-label">ORIGINAL MODEL ID</span>
                      <h3 title={model.id}>{model.id}</h3>
                      <p>{model.label}</p>
                    </div>
                    <div class="capability-list card-capabilities">
                      <For each={model.capabilities}>
                        {(capability) => <span>{capability}</span>}
                      </For>
                    </div>
                    <div class="model-card-footer">
                      <span>
                        Priority <strong>{model.priority}</strong>
                      </span>
                      <button
                        classList={{ "switch-button": true, on: model.enabled }}
                        onClick={() => props.onToggle(model)}
                        disabled={
                          props.toggleLoading === model.id ||
                          !model.credentialConfigured
                        }
                        role="switch"
                        aria-checked={model.enabled}
                        aria-label={`${model.enabled ? "Disable" : "Enable"} ${model.id}`}
                        title={
                          !model.credentialConfigured
                            ? "Provider credential is not configured"
                            : undefined
                        }
                      >
                        <i />
                      </button>
                    </div>
                    <Show when={!model.credentialConfigured}>
                      <small class="missing-key">
                        Provider key not configured
                      </small>
                    </Show>
                  </article>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
