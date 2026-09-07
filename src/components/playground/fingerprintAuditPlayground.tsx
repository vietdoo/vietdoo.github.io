import { For, Show, createSignal, onMount } from "solid-js";
import { getApiUrl } from "../../lib/api-config";

type Risk = "low" | "medium" | "high" | "local";
type Signal = {
  id: string;
  label: string;
  value: string;
  detail: string;
  risk: Risk;
  localOnly?: boolean;
};

type FingerprintSnapshot = {
  signals: Signal[];
  score: number;
  uniqueSignals: number;
  localHash: string;
};

type UAData = {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
};

type ExtendedNavigator = Navigator & {
  userAgentData?: UAData;
  deviceMemory?: number;
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  globalPrivacyControl?: boolean;
  pdfViewerEnabled?: boolean;
};

const nav = () => navigator as ExtendedNavigator;

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "")
    return "Unavailable";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function riskLabel(risk: Risk) {
  return { low: "LOW", medium: "MEDIUM", high: "HIGH", local: "LOCAL ONLY" }[
    risk
  ];
}

function getWebGLInfo() {
  const canvas = document.createElement("canvas");
  const gl = (canvas.getContext("webgl") ||
    canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
  if (!gl) return { vendor: "Unavailable", renderer: "Unavailable" };
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");

  return {
    vendor: debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
      : String(gl.getParameter(gl.VENDOR)),
    renderer: debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER)),
  };
}

function getCanvasSignature() {
  const canvas = document.createElement("canvas");
  canvas.width = 280;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return "Unavailable";
  context.textBaseline = "top";
  context.font = "14px Arial";
  context.fillStyle = "#0e1726";
  context.fillRect(0, 0, 280, 64);
  context.fillStyle = "#8ff0d2";
  context.fillText("VNDO-AI / local canvas check", 7, 8);
  context.fillStyle = "rgba(242, 142, 97, 0.72)";
  context.arc(236, 31, 18, 0, Math.PI * 2);
  context.fill();
  return canvas.toDataURL().slice(-96);
}

async function digestLocal(value: string) {
  if (!crypto.subtle) return "local-only-unavailable";
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

async function readPermission(name: PermissionName) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return "unsupported";
  }
}

async function inspectClient(): Promise<FingerprintSnapshot> {
  const currentNav = nav();
  const screenData = window.screen;
  const webgl = getWebGLInfo();
  const uaData = currentNav.userAgentData;
  const connection = currentNav.connection;
  const permissionResults = await Promise.all([
    readPermission("geolocation"),
    readPermission("camera"),
    readPermission("microphone"),
    readPermission("notifications"),
  ]);
  const highEntropy = uaData?.getHighEntropyValues
    ? await uaData
        .getHighEntropyValues([
          "architecture",
          "bitness",
          "model",
          "platformVersion",
        ])
        .catch(() => ({}))
    : {};

  const signals: Signal[] = [
    {
      id: "ua",
      label: "User-Agent",
      value: currentNav.userAgent,
      detail: "Browser and operating-system string exposed to the page.",
      risk: "medium",
    },
    {
      id: "ua-brands",
      label: "User-Agent Client Hints",
      value:
        uaData?.brands
          ?.map((brand) => `${brand.brand} ${brand.version}`)
          .join(" · ") || "Unavailable",
      detail:
        "Reduced browser brand data when the browser supports Client Hints.",
      risk: "low",
    },
    {
      id: "platform",
      label: "Platform",
      value: formatValue(uaData?.platform || currentNav.platform),
      detail:
        "Coarse platform value; modern browsers may reduce its precision.",
      risk: "low",
    },
    {
      id: "high-entropy",
      label: "High-entropy hints",
      value:
        Object.entries(highEntropy)
          .filter(([, value]) => value)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" · ") || "Not exposed",
      detail:
        "Optional hints requested by this demo; no permission prompt is opened.",
      risk: "high",
      localOnly: true,
    },
    {
      id: "locale",
      label: "Language & locale",
      value: `${currentNav.language} · ${currentNav.languages.join(", ")}`,
      detail:
        "Preferred language list can narrow the set of matching browsers.",
      risk: "medium",
    },
    {
      id: "timezone",
      label: "Timezone",
      value: Intl.DateTimeFormat().resolvedOptions().timeZone,
      detail:
        "Timezone and UTC offset are available without asking for location permission.",
      risk: "medium",
    },
    {
      id: "display",
      label: "Display geometry",
      value: `${screenData.width}×${screenData.height} · viewport ${window.innerWidth}×${window.innerHeight} · DPR ${window.devicePixelRatio}`,
      detail:
        "Screen, viewport, pixel ratio, depth and orientation are exposed by the browser.",
      risk: "medium",
    },
    {
      id: "hardware",
      label: "Hardware hints",
      value: `${currentNav.hardwareConcurrency || "?"} logical cores · ${currentNav.deviceMemory || "?"} GB memory · ${currentNav.maxTouchPoints} touch points`,
      detail: "These are coarse hints and may be rounded or unavailable.",
      risk: "medium",
    },
    {
      id: "webgl",
      label: "WebGL renderer",
      value: `${webgl.vendor} · ${webgl.renderer}`,
      detail:
        "Graphics strings can be relatively distinctive. The raw value stays local.",
      risk: "high",
      localOnly: true,
    },
    {
      id: "canvas",
      label: "Canvas rendering check",
      value: getCanvasSignature(),
      detail:
        "A local rendering sample; this demo never sends the raw canvas output to AI.",
      risk: "high",
      localOnly: true,
    },
    {
      id: "network",
      label: "Network hints",
      value: connection
        ? `${connection.effectiveType || "?"} · ${connection.downlink ?? "?"} Mbps · RTT ${connection.rtt ?? "?"} ms · Save-Data ${connection.saveData ? "on" : "off"}`
        : "Network Information API unavailable",
      detail:
        "Approximate connection hints; this page does not probe IP or local addresses.",
      risk: "low",
    },
    {
      id: "privacy",
      label: "Privacy signals",
      value: `DNT ${currentNav.doNotTrack || "unset"} · GPC ${currentNav.globalPrivacyControl ? "on" : "off"} · cookies ${currentNav.cookieEnabled ? "on" : "off"}`,
      detail:
        "Signals that communicate browser privacy preferences and storage state.",
      risk: "low",
    },
    {
      id: "capabilities",
      label: "Browser capabilities",
      value: `PDF ${currentNav.pdfViewerEnabled ? "yes" : "no"} · WebGL ${webgl.renderer !== "Unavailable" ? "yes" : "no"} · SW ${"serviceWorker" in navigator ? "yes" : "no"}`,
      detail: "Feature availability, not hidden device access.",
      risk: "low",
    },
    {
      id: "permissions",
      label: "Permission states",
      value: `Location ${permissionResults[0]} · Camera ${permissionResults[1]} · Mic ${permissionResults[2]} · Notifications ${permissionResults[3]}`,
      detail:
        "Only permission state is checked; this demo never requests access.",
      risk: "medium",
    },
  ];

  const stableValue = signals
    .map((signal) => `${signal.id}:${signal.value}`)
    .join("|");
  const localHash = await digestLocal(stableValue);
  const score = Math.min(
    100,
    signals.reduce(
      (total, signal) =>
        total +
        (signal.risk === "high" ? 12 : signal.risk === "medium" ? 7 : 3),
      0,
    ),
  );
  return {
    signals,
    score,
    uniqueSignals: signals.filter(
      (signal) => signal.risk === "high" || signal.risk === "medium",
    ).length,
    localHash,
  };
}

function buildLocalSummary(snapshot: FingerprintSnapshot) {
  const high = snapshot.signals.filter(
    (signal) => signal.risk === "high",
  ).length;
  const medium = snapshot.signals.filter(
    (signal) => signal.risk === "medium",
  ).length;
  return `Mình thấy ${snapshot.signals.length} nhóm tín hiệu từ trình duyệt này. Có ${high} nhóm có thể tương đối đặc trưng (WebGL, canvas và các hint chi tiết) cùng ${medium} nhóm làm hẹp thêm tập thiết bị tương đồng (locale, timezone, màn hình, phần cứng). Đây là đánh giá về khả năng nhận diện của cấu hình trình duyệt, không phải danh tính của bạn. Raw signal và mã local không được gửi lên server trong bước kiểm tra này.`;
}

export default function FingerprintAuditPlayground() {
  const [snapshot, setSnapshot] = createSignal<FingerprintSnapshot>();
  const [summary, setSummary] = createSignal("");
  const [aiSummary, setAiSummary] = createSignal("");
  const [isInspecting, setIsInspecting] = createSignal(false);
  const [isAiLoading, setIsAiLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [copied, setCopied] = createSignal(false);

  const runInspection = async () => {
    if (isInspecting()) return;
    setIsInspecting(true);
    setError("");
    setAiSummary("");
    try {
      const result = await inspectClient();
      setSnapshot(result);
      setSummary(buildLocalSummary(result));
      await requestAiSummary(result);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not inspect this browser.",
      );
    } finally {
      setIsInspecting(false);
    }
  };

  const requestAiSummary = async (result: FingerprintSnapshot) => {
    setIsAiLoading(true);
    try {
      const response = await fetch(getApiUrl("/api/fingerprint-summary"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: result.score,
          uniqueSignals: result.uniqueSignals,
          categories: result.signals.map(({ id, risk, localOnly }) => ({
            id,
            risk,
            localOnly: Boolean(localOnly),
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && typeof payload.summary === "string") {
        setAiSummary(payload.summary);
      } else {
        setAiSummary(summary());
      }
    } catch {
      setAiSummary(summary());
    } finally {
      setIsAiLoading(false);
    }
  };

  const copyReport = async () => {
    const result = snapshot();
    if (!result) return;
    const report = [
      "Browser Fingerprint Audit",
      `Local demo hash: ${result.localHash}`,
      `Exposure score: ${result.score}/100`,
      ...result.signals.map((signal) => `${signal.label}: ${signal.value}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard access is unavailable in this browser.");
    }
  };

  const rerunInspection = () => {
    if (isInspecting()) return;
    setSnapshot();
    setSummary("");
    setAiSummary("");
    setError("");
    void runInspection();
  };

  onMount(() => {
    void runInspection();
  });

  return (
    <div class="fingerprint-audit w-full max-w-5xl mx-auto flex flex-col gap-6 p-2 md:p-4 text-darkslate-100 font-sans">
      <section class="fingerprint-hero rounded-2xl border border-darkslate-500 bg-darkslate-600/30 p-5 md:p-7 shadow-2xl shadow-black/20">
        <div class="fingerprint-hero-intro flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-primary-300">
            <span class="rounded-full border border-darkslate-400 bg-darkslate-800/70 px-2.5 py-1">
              Privacy-first audit
            </span>
            <span class="text-darkslate-400">No permission prompts</span>
          </div>
          <h1 class="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Browser Fingerprint Audit
          </h1>
          <p class="max-w-3xl text-sm leading-7 text-darkslate-300 md:text-base">
            Một phòng thí nghiệm minh bạch về browser fingerprinting. Công cụ
            chỉ đọc các tín hiệu mà trang web hiện tại được trình duyệt cho phép
            thấy, tạo mã minh họa ngay trên máy bạn và không cố xác định danh
            tính thật.
          </p>
        </div>

        <div class="fingerprint-ai-summary mt-6 rounded-xl border border-darkslate-500 bg-darkslate-800/70 p-4 md:p-5">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-5">
            <div class="max-w-2xl">
              <h2 class="text-xs font-semibold uppercase tracking-[0.16em] text-primary-300">
                AI summary
              </h2>
              <p class="mt-2 text-sm leading-7 text-darkslate-100">
                <Show
                  when={aiSummary()}
                  fallback={
                    isAiLoading()
                      ? "Đang phân tích các nhóm tín hiệu ở mức tổng quát…"
                      : "Audit sẽ tự chạy khi trang mở. Raw fingerprint và dữ liệu nhạy cảm không được gửi đi."
                  }
                >
                  {aiSummary()}
                </Show>
              </p>
            </div>
            <Show when={snapshot()}>
              <div class="shrink-0 rounded-lg border border-darkslate-400 bg-darkslate-900/70 px-3 py-2 text-right">
                <div class="font-mono text-2xl font-bold text-primary-200">
                  {snapshot()?.score}
                  <span class="text-sm text-primary-400">/100</span>
                </div>
                <div class="text-[10px] uppercase tracking-widest text-darkslate-400">
                  exposure score
                </div>
              </div>
            </Show>
          </div>
        </div>

        <div class="mt-5 flex flex-col gap-3 rounded-xl border border-darkslate-500 bg-darkslate-800/45 p-4 md:flex-row md:items-center md:justify-between">
          <div class="flex items-start gap-3 text-xs leading-6 text-darkslate-300">
            <span class="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-400 shadow-[0_0_0_4px_rgba(242,142,97,0.12)]" />
            <p>
              <span class="font-medium text-darkslate-100">
                {isInspecting()
                  ? "Đang chạy audit local…"
                  : "Audit local đã hoàn tất"}
              </span>
              <br />
              Chỉ đọc tín hiệu mà trang hiện tại được trình duyệt expose; không
              mở camera, mic, vị trí, file hay gửi raw fingerprint đi nơi khác.
            </p>
          </div>
          <button
            type="button"
            onClick={rerunInspection}
            disabled={isInspecting()}
            class="shrink-0 rounded-lg border border-darkslate-400 bg-darkslate-700/70 px-4 py-2.5 text-sm font-medium text-darkslate-100 transition hover:border-primary-400 hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isInspecting() ? "Đang kiểm tra…" : "Quét lại"}
          </button>
        </div>
      </section>

      <Show when={snapshot()}>
        {(result) => (
          <>
            <section class="fingerprint-stats grid grid-cols-2 gap-3 md:grid-cols-4">
              <div class="rounded-xl border border-darkslate-500 bg-darkslate-600/30 p-3">
                <div class="text-[10px] uppercase tracking-widest text-darkslate-400">
                  Signals
                </div>
                <div class="mt-1 text-2xl font-bold text-white">
                  {result().signals.length}
                </div>
              </div>
              <div class="rounded-xl border border-darkslate-500 bg-darkslate-600/30 p-3">
                <div class="text-[10px] uppercase tracking-widest text-darkslate-400">
                  Distinctive
                </div>
                <div class="mt-1 text-2xl font-bold text-white">
                  {result().uniqueSignals}
                </div>
              </div>
              <div class="rounded-xl border border-darkslate-500 bg-darkslate-600/30 p-3">
                <div class="text-[10px] uppercase tracking-widest text-darkslate-400">
                  Local hash
                </div>
                <div class="mt-1 truncate font-mono text-sm text-primary-200">
                  {result().localHash}
                </div>
              </div>
              <div class="rounded-xl border border-darkslate-500 bg-darkslate-600/30 p-3">
                <div class="text-[10px] uppercase tracking-widest text-darkslate-400">
                  Raw data sent
                </div>
                <div class="mt-1 text-2xl font-bold text-primary-200">0</div>
              </div>
            </section>

            <section class="fingerprint-inventory overflow-hidden rounded-2xl border border-darkslate-500 bg-darkslate-600/30">
              <div class="flex flex-col gap-3 border-b border-darkslate-500 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
                <div>
                  <h2 class="text-sm font-semibold text-white">
                    Client signal inventory
                  </h2>
                  <p class="mt-1 text-xs text-darkslate-400">
                    Raw values are rendered for you locally. High-entropy values
                    are never included in the AI request.
                  </p>
                </div>
                <div class="flex gap-2">
                  <button
                    type="button"
                    onClick={copyReport}
                    aria-live="polite"
                    class="rounded-md border border-darkslate-400 bg-darkslate-700/50 px-3 py-1.5 text-xs font-medium text-darkslate-200 transition hover:border-primary-300 hover:text-white active:scale-[0.98]"
                  >
                    {copied() ? "Copied" : "Copy report"}
                  </button>
                </div>
              </div>
              <div class="divide-y divide-darkslate-600/80">
                <For each={result().signals}>
                  {(signal) => (
                    <div class="grid gap-2 px-4 py-4 transition-colors hover:bg-darkslate-700/20 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-start md:px-5">
                      <div>
                        <div class="text-sm font-semibold text-darkslate-100">
                          {signal.label}
                        </div>
                        <div class="mt-1 text-[10px] uppercase tracking-widest text-darkslate-500">
                          {signal.id}
                        </div>
                      </div>
                      <div class="min-w-0">
                        <div class="break-words font-mono text-xs leading-6 text-primary-200">
                          {signal.value}
                        </div>
                        <div class="mt-1 text-xs leading-5 text-darkslate-400">
                          {signal.detail}
                        </div>
                      </div>
                      <div
                        class={`justify-self-start rounded-full border px-2 py-1 text-[9px] font-bold tracking-widest ${signal.risk === "high" ? "border-red-300/40 bg-red-300/10 text-red-200" : signal.risk === "medium" ? "border-amber-300/40 bg-amber-300/10 text-amber-200" : signal.risk === "local" ? "border-primary-300/40 bg-primary-300/10 text-primary-200" : "border-darkslate-400 text-darkslate-300"}`}
                      >
                        {riskLabel(signal.risk)}
                        {signal.localOnly ? " · LOCAL" : ""}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <p class="text-[11px] leading-6 text-darkslate-500">
              Không có canvas/audio probing nâng cao, WebRTC candidate probing,
              geolocation request, camera/mic request, cookie, localStorage,
              analytics event hoặc server-side visitor ID. Đây là công cụ quan
              sát và giáo dục, không phải hệ thống tracking.
            </p>
          </>
        )}
      </Show>

      <Show when={error()}>
        <div
          role="alert"
          class="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-xs leading-relaxed text-red-200"
        >
          {error()}
        </div>
      </Show>

      <footer class="flex flex-wrap gap-x-4 gap-y-2 border-t border-darkslate-800 pt-4 text-[11px] text-darkslate-500">
        <a
          href="https://web.dev/learn/privacy/fingerprinting"
          target="_blank"
          rel="noreferrer"
          class="hover:text-primary-200"
        >
          web.dev fingerprinting
        </a>
        <a
          href="https://developer.mozilla.org/en-US/docs/Glossary/Fingerprinting"
          target="_blank"
          rel="noreferrer"
          class="hover:text-primary-200"
        >
          MDN glossary
        </a>
        <a
          href="https://www.eff.org/pages/cover-your-tracks"
          target="_blank"
          rel="noreferrer"
          class="hover:text-primary-200"
        >
          EFF Cover Your Tracks
        </a>
      </footer>
    </div>
  );
}
