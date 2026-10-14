import { createSignal, createMemo, Show } from "solid-js";

export default function WordCounterPlayground() {
  const [text, setText] = createSignal(
    "Paste or type your text here to count words, characters, sentences, and estimated reading time in real-time."
  );
  const [copied, setCopied] = createSignal(false);

  const stats = createMemo(() => {
    const raw = text();
    const trimmed = raw.trim();

    if (!trimmed) {
      return {
        words: 0,
        chars: 0,
        charsNoSpace: 0,
        sentences: 0,
        paragraphs: 0,
        readingTime: "0 min",
      };
    }

    const wordsArr = trimmed.match(/[\p{L}\p{N}_\-]+/gu) || [];
    const words = wordsArr.length;
    const chars = raw.length;
    const charsNoSpace = raw.replace(/\s+/g, "").length;
    const sentences = trimmed.split(/[.!?]+/).filter(Boolean).length || 1;
    const paragraphs = raw.split(/\n+/).filter((p) => p.trim().length > 0).length || 1;

    const readMin = Math.ceil(words / 200);
    const readingTime = readMin <= 1 ? "1 min" : `${readMin} mins`;

    return {
      words,
      chars,
      charsNoSpace,
      sentences,
      paragraphs,
      readingTime,
    };
  });

  const handleCopy = async () => {
    if (!text()) return;
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleClear = () => setText("");

  return (
    <div class="w-full max-w-3xl mx-auto flex flex-col gap-6 text-darkslate-100 p-2 md:p-4 font-sans">
      {/* Title */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-white tracking-tight">Word counter</h1>
          <p class="text-xs sm:text-sm text-darkslate-300 mt-1">
            Simple real-time text analysis for words, characters, and reading time.
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-2.5 sm:p-3.5 flex flex-col">
          <span class="text-[10px] sm:text-[11px] font-medium text-darkslate-300">Words</span>
          <span class="text-xl sm:text-2xl font-bold text-primary-400 mt-0.5 tabular-nums">
            {stats().words.toLocaleString()}
          </span>
        </div>

        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-2.5 sm:p-3.5 flex flex-col">
          <span class="text-[10px] sm:text-[11px] font-medium text-darkslate-300">Characters</span>
          <span class="text-xl sm:text-2xl font-bold text-white mt-0.5 tabular-nums">
            {stats().chars.toLocaleString()}
          </span>
        </div>

        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-2.5 sm:p-3.5 flex flex-col">
          <span class="text-[10px] sm:text-[11px] font-medium text-darkslate-300">No Spaces</span>
          <span class="text-xl sm:text-2xl font-bold text-darkslate-200 mt-0.5 tabular-nums">
            {stats().charsNoSpace.toLocaleString()}
          </span>
        </div>

        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-2.5 sm:p-3.5 flex flex-col">
          <span class="text-[10px] sm:text-[11px] font-medium text-darkslate-300">Sentences</span>
          <span class="text-xl sm:text-2xl font-bold text-white mt-0.5 tabular-nums">
            {stats().sentences.toLocaleString()}
          </span>
        </div>

        <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-2.5 sm:p-3.5 flex flex-col col-span-2 sm:col-span-1">
          <span class="text-[10px] sm:text-[11px] font-medium text-darkslate-300">Reading Time</span>
          <span class="text-xl sm:text-2xl font-bold text-primary-300 mt-0.5">
            {stats().readingTime}
          </span>
        </div>
      </div>

      {/* Editor & Actions */}
      <div class="flex flex-col gap-2">
        <textarea
          rows="10"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          placeholder="Type or paste your text..."
          class="w-full bg-darkslate-800/80 border border-darkslate-500 rounded-xl p-4 text-sm text-white placeholder-darkslate-400 focus:outline-none focus:border-primary-500 transition font-mono leading-relaxed resize-y"
        />

        <div class="flex items-center justify-between text-xs text-darkslate-300 pt-1">
          <span>{stats().paragraphs} paragraph{stats().paragraphs !== 1 ? "s" : ""}</span>
          <div class="flex gap-2">
            <Show when={text().length > 0}>
              <button
                onClick={handleClear}
                type="button"
                class="px-3 py-1.5 rounded-lg border border-darkslate-500 hover:bg-darkslate-600/60 hover:text-rose-300 transition text-darkslate-300"
              >
                Clear
              </button>
            </Show>
            <button
              onClick={handleCopy}
              aria-live="polite"
              type="button"
              class="px-3.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-medium transition"
            >
              {copied() ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
