import { createSignal, createMemo, Show } from "solid-js";

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  try {
    return decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  } catch {
    return atob(base64);
  }
}

const SAMPLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IsSQ4buVIEh14buRYyBWaeG7h3QiLCJyb2xlIjoiU29mdHdhcmUgRW5naW5lZXIiLCJpYXQiOjE3NzAwMDAwMDAsImV4cCI6MjA4MTAwMDAwMH0.signature_sample_hash";

export default function JwtDecoderPlayground() {
  const [token, setToken] = createSignal(SAMPLE_JWT);
  const [copiedHeader, setCopiedHeader] = createSignal(false);
  const [copiedPayload, setCopiedPayload] = createSignal(false);

  const decoded = createMemo(() => {
    const raw = token().trim();
    if (!raw) {
      return {
        valid: false,
        error: "",
        headerStr: "",
        payloadStr: "",
        signature: "",
        expDate: null,
        isExpired: false,
      };
    }

    const parts = raw.split(".");
    if (parts.length !== 3) {
      return {
        valid: false,
        error: "Invalid JWT structure (must contain 3 dot-separated parts).",
        headerStr: "",
        payloadStr: "",
        signature: "",
        expDate: null,
        isExpired: false,
      };
    }

    let headerStr = "";
    let payloadStr = "";
    let parseErr = "";
    let expDate: Date | null = null;
    let isExpired = false;

    try {
      const headerObj = JSON.parse(base64UrlDecode(parts[0]));
      headerStr = JSON.stringify(headerObj, null, 2);
    } catch {
      parseErr = "Invalid Header JSON";
    }

    try {
      const payloadObj = JSON.parse(base64UrlDecode(parts[1]));
      payloadStr = JSON.stringify(payloadObj, null, 2);

      if (typeof payloadObj?.exp === "number") {
        expDate = new Date(payloadObj.exp * 1000);
        isExpired = expDate.getTime() < Date.now();
      }
    } catch {
      if (!parseErr) parseErr = "Invalid Payload JSON";
    }

    if (parseErr) {
      return {
        valid: false,
        error: parseErr,
        headerStr,
        payloadStr,
        signature: parts[2] || "",
        expDate: null,
        isExpired: false,
      };
    }

    return {
      valid: true,
      error: "",
      headerStr,
      payloadStr,
      signature: parts[2] || "",
      expDate,
      isExpired,
    };
  });

  const handleCopy = async (textToCopy: string, setCopied: (v: boolean) => void) => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleClear = () => setToken("");
  const handleSample = () => setToken(SAMPLE_JWT);

  return (
    <div class="w-full max-w-4xl mx-auto flex flex-col gap-6 text-darkslate-100 p-2 md:p-4 font-sans">
      {/* Title */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-white tracking-tight">JWT Decoder</h1>
          <p class="text-xs sm:text-sm text-darkslate-300 mt-1">
            Decode and inspect JSON Web Token headers, payloads, and signatures.
          </p>
        </div>

        {/* Status Pill */}
        <Show when={token().trim().length > 0}>
          <Show
            when={decoded().valid}
            fallback={
              <span class="px-2.5 py-1 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium self-start sm:self-auto">
                Invalid JWT
              </span>
            }
          >
            <Show
              when={!decoded().isExpired}
              fallback={
                <span class="px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium self-start sm:self-auto">
                  Expired Token ({decoded().expDate?.toLocaleDateString()})
                </span>
              }
            >
              <span class="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium self-start sm:self-auto">
                Valid JWT
              </span>
            </Show>
          </Show>
        </Show>
      </div>

      {/* Main Layout */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left: Raw Token */}
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-darkslate-300">Encoded Token</span>
            <div class="flex gap-2 text-xs">
              <button
                onClick={handleSample}
                class="text-darkslate-300 hover:text-white transition"
              >
                Sample
              </button>
              <button
                onClick={handleClear}
                class="text-darkslate-300 hover:text-rose-300 transition"
              >
                Clear
              </button>
            </div>
          </div>

          <textarea
            rows="12"
            value={token()}
            onInput={(e) => setToken(e.currentTarget.value)}
            placeholder="Paste JWT token..."
            class="w-full bg-darkslate-800/80 border border-darkslate-500 rounded-xl p-3.5 text-xs text-white placeholder-darkslate-400 focus:outline-none focus:border-primary-500 transition font-mono leading-relaxed resize-y"
          />

          <Show when={decoded().error}>
            <p class="text-xs text-rose-400">{decoded().error}</p>
          </Show>
        </div>

        {/* Right: Header & Payload */}
        <div class="flex flex-col gap-4">
          {/* Header */}
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-darkslate-300">Header</span>
              <button
                onClick={() => handleCopy(decoded().headerStr, setCopiedHeader)}
                disabled={!decoded().headerStr}
                aria-live="polite"
                class="text-darkslate-300 hover:text-white transition disabled:opacity-40"
              >
                {copiedHeader() ? "Copied" : "Copy"}
              </button>
            </div>
            <pre class="w-full bg-darkslate-800/80 border border-darkslate-500 rounded-xl p-3 text-xs text-darkslate-100 font-mono overflow-x-auto min-h-[90px]">
              {decoded().headerStr || "// Header"}
            </pre>
          </div>

          {/* Payload */}
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-darkslate-300">Payload</span>
              <button
                onClick={() => handleCopy(decoded().payloadStr, setCopiedPayload)}
                disabled={!decoded().payloadStr}
                aria-live="polite"
                class="text-darkslate-300 hover:text-white transition disabled:opacity-40"
              >
                {copiedPayload() ? "Copied" : "Copy"}
              </button>
            </div>
            <pre class="w-full bg-darkslate-800/80 border border-darkslate-500 rounded-xl p-3 text-xs text-darkslate-100 font-mono overflow-x-auto min-h-[140px]">
              {decoded().payloadStr || "// Payload"}
            </pre>
          </div>

          {/* Signature */}
          <div class="flex flex-col gap-1 text-xs">
            <span class="font-medium text-darkslate-300">Signature</span>
            <div class="bg-darkslate-800/80 border border-darkslate-500 rounded-xl p-3 text-xs text-darkslate-300 font-mono break-all">
              {decoded().signature || "// Signature"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
