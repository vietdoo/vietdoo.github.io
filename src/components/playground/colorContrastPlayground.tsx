import { createSignal, createMemo, Show, For } from "solid-js";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleanHex = hex.replace("#", "").trim();
  let fullHex = cleanHex;
  if (cleanHex.length === 3) {
    fullHex = cleanHex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (fullHex.length !== 6) return null;
  const r = parseInt(fullHex.substring(0, 2), 16);
  const g = parseInt(fullHex.substring(2, 4), 16);
  const b = parseInt(fullHex.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

function getLuminance(r: number, g: number, b: number): number {
  const a = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function calcRatio(fg: string, bg: string): number | null {
  const rgb1 = hexToRgb(fg);
  const rgb2 = hexToRgb(bg);
  if (!rgb1 || !rgb2) return null;
  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const PRESETS = [
  { name: "White on Dark Slate", fg: "#FFFFFF", bg: "#0F172A" },
  { name: "Primary on Dark", fg: "#38BDF8", bg: "#0F172A" },
  { name: "Dark Text on Light", fg: "#1E293B", bg: "#F8FAFC" },
  { name: "Muted Text on Slate", fg: "#94A3B8", bg: "#1E293B" },
  { name: "Amber on Dark", fg: "#F59E0B", bg: "#18181B" },
  { name: "Rose on Dark", fg: "#FB7185", bg: "#0F172A" },
];

export default function ColorContrastPlayground() {
  const [fgColor, setFgColor] = createSignal("#38BDF8");
  const [bgColor, setBgColor] = createSignal("#0F172A");

  const ratio = createMemo(() => {
    const r = calcRatio(fgColor(), bgColor());
    return r !== null ? Math.floor(r * 100) / 100 : null;
  });

  const swapColors = () => {
    const temp = fgColor();
    setFgColor(bgColor());
    setBgColor(temp);
  };

  const getStatus = (target: number) => {
    const r = ratio();
    if (r === null) return { pass: false, text: "Invalid" };
    if (r >= target) return { pass: true, text: "PASS" };
    return { pass: false, text: "FAIL" };
  };

  return (
    <div class="color-contrast-page w-full max-w-3xl mx-auto flex flex-col gap-6 text-darkslate-100 p-2 md:p-4 font-sans">
      {/* Header */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Color Contrast Checker
          </h1>
          <p class="text-xs sm:text-sm text-darkslate-300 mt-1">
            Calculate contrast ratios between text and background colors according
            to WCAG 2.1 guidelines.
          </p>
        </div>
      </div>

      {/* Preset Buttons */}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium text-darkslate-300 mr-1">
          Presets:
        </span>
        <For each={PRESETS}>
          {(preset) => (
            <button
              type="button"
              onClick={() => {
                setFgColor(preset.fg);
                setBgColor(preset.bg);
              }}
              class="px-2.5 py-1 text-xs rounded-lg border border-darkslate-500 bg-darkslate-600/30 text-darkslate-200 hover:bg-darkslate-600/60 hover:text-white transition"
            >
              {preset.name}
            </button>
          )}
        </For>
      </div>

      {/* Color Selectors & Ratio Card */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        {/* Foreground Color Picker */}
        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-4 flex flex-col gap-3">
          <label class="text-xs font-medium text-darkslate-300">
            Text Color (Foreground)
          </label>
          <div class="flex items-center gap-3">
            <input
              type="color"
              value={fgColor()}
              onInput={(e) => setFgColor(e.currentTarget.value.toUpperCase())}
              class="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0 p-0"
            />
            <input
              type="text"
              value={fgColor()}
              onInput={(e) => setFgColor(e.currentTarget.value.toUpperCase())}
              class="flex-1 bg-darkslate-800 border border-darkslate-500 rounded-lg px-3 py-2 text-sm text-white font-mono uppercase focus:outline-none focus:border-primary-500"
            />
          </div>
        </div>

        {/* Ratio Display */}
        <div class="bg-darkslate-800 border border-darkslate-500 rounded-xl p-4 flex flex-col items-center justify-center text-center gap-2 relative">
          <button
            type="button"
            onClick={swapColors}
            title="Swap foreground and background colors"
            class="absolute top-2 right-2 p-1.5 rounded-lg border border-darkslate-500 text-darkslate-300 hover:text-white hover:bg-darkslate-600/50 transition text-xs"
          >
            Swap
          </button>
          <span class="text-[11px] font-medium uppercase tracking-wider text-darkslate-300">
            Contrast Ratio
          </span>
          <Show
            when={ratio() !== null}
            fallback={
              <span class="text-xl font-bold text-rose-400">Invalid Hex</span>
            }
          >
            <span class="text-4xl font-extrabold text-primary-400 tabular-nums">
              {ratio()}:1
            </span>
          </Show>
        </div>

        {/* Background Color Picker */}
        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-4 flex flex-col gap-3">
          <label class="text-xs font-medium text-darkslate-300">
            Background Color
          </label>
          <div class="flex items-center gap-3">
            <input
              type="color"
              value={bgColor()}
              onInput={(e) => setBgColor(e.currentTarget.value.toUpperCase())}
              class="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0 p-0"
            />
            <input
              type="text"
              value={bgColor()}
              onInput={(e) => setBgColor(e.currentTarget.value.toUpperCase())}
              class="flex-1 bg-darkslate-800 border border-darkslate-500 rounded-lg px-3 py-2 text-sm text-white font-mono uppercase focus:outline-none focus:border-primary-500"
            />
          </div>
        </div>
      </div>

      {/* WCAG Compliance Scores */}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Normal Text */}
        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-4 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-white">Normal Text</span>
            <span
              class={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                getStatus(4.5).pass
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-rose-500/20 text-rose-300 border-rose-500/40"
              }`}
            >
              {getStatus(4.5).text}
            </span>
          </div>
          <p class="text-[11px] text-darkslate-300">
            Minimum 4.5:1 ratio required for WCAG AA (small text under 18pt).
          </p>
          <div class="text-xs text-darkslate-400 mt-auto pt-1 flex justify-between">
            <span>AAA (7:1)</span>
            <span
              class={
                getStatus(7).pass
                  ? "text-emerald-400 font-semibold"
                  : "text-darkslate-400"
              }
            >
              {getStatus(7).pass ? "Pass" : "Fail"}
            </span>
          </div>
        </div>

        {/* Large Text */}
        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-4 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-white">Large Text</span>
            <span
              class={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                getStatus(3.0).pass
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-rose-500/20 text-rose-300 border-rose-500/40"
              }`}
            >
              {getStatus(3.0).text}
            </span>
          </div>
          <p class="text-[11px] text-darkslate-300">
            Minimum 3.0:1 ratio required for WCAG AA (bold 14pt+ or regular
            18pt+).
          </p>
          <div class="text-xs text-darkslate-400 mt-auto pt-1 flex justify-between">
            <span>AAA (4.5:1)</span>
            <span
              class={
                getStatus(4.5).pass
                  ? "text-emerald-400 font-semibold"
                  : "text-darkslate-400"
              }
            >
              {getStatus(4.5).pass ? "Pass" : "Fail"}
            </span>
          </div>
        </div>

        {/* Graphical UI */}
        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-4 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-white">UI Components</span>
            <span
              class={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                getStatus(3.0).pass
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-rose-500/20 text-rose-300 border-rose-500/40"
              }`}
            >
              {getStatus(3.0).text}
            </span>
          </div>
          <p class="text-[11px] text-darkslate-300">
            Minimum 3.0:1 ratio for user interface controls and graphical
            objects.
          </p>
          <div class="text-xs text-darkslate-400 mt-auto pt-1 flex justify-between">
            <span>AA (3.0:1)</span>
            <span
              class={
                getStatus(3.0).pass
                  ? "text-emerald-400 font-semibold"
                  : "text-darkslate-400"
              }
            >
              {getStatus(3.0).pass ? "Pass" : "Fail"}
            </span>
          </div>
        </div>
      </div>

      {/* Preview Container */}
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-darkslate-300">Live Preview</span>
        <div
          class="color-contrast-preview rounded-xl border border-darkslate-500 p-6 flex flex-col gap-4 transition-colors duration-200"
          style={{ "background-color": bgColor(), color: fgColor() }}
        >
          <div>
            <h2 class="text-2xl font-bold leading-snug">Sample Heading Text</h2>
            <p class="text-sm mt-2 leading-relaxed max-w-xl opacity-90">
              Accessibility ensures that digital content can be comfortably read
              by everyone, including people with visual impairments. Good color
              contrast is a fundamental part of inclusive design.
            </p>
          </div>

          <div class="flex items-center gap-3 pt-2">
            <button
              type="button"
              class="px-4 py-2 text-xs font-semibold rounded-lg shadow-sm border border-current"
              style={{ "background-color": fgColor(), color: bgColor() }}
            >
              Primary Button
            </button>
            <span class="text-xs border-b border-current pb-0.5 cursor-pointer">
              Interactive Link Text
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
