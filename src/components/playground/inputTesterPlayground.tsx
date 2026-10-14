import { createSignal, onMount, onCleanup, For, Show } from "solid-js";

interface KeyDef {
  code: string;
  label: string;
  width?: string;
}

const KEYBOARD_ROWS: KeyDef[][] = [
  // Function Row
  [
    { code: "Escape", label: "Esc", width: "w-10 md:w-12" },
    { code: "F1", label: "F1" },
    { code: "F2", label: "F2" },
    { code: "F3", label: "F3" },
    { code: "F4", label: "F4" },
    { code: "F5", label: "F5" },
    { code: "F6", label: "F6" },
    { code: "F7", label: "F7" },
    { code: "F8", label: "F8" },
    { code: "F9", label: "F9" },
    { code: "F10", label: "F10" },
    { code: "F11", label: "F11" },
    { code: "F12", label: "F12" },
  ],
  // Number Row
  [
    { code: "Backquote", label: "`" },
    { code: "Digit1", label: "1" },
    { code: "Digit2", label: "2" },
    { code: "Digit3", label: "3" },
    { code: "Digit4", label: "4" },
    { code: "Digit5", label: "5" },
    { code: "Digit6", label: "6" },
    { code: "Digit7", label: "7" },
    { code: "Digit8", label: "8" },
    { code: "Digit9", label: "9" },
    { code: "Digit0", label: "0" },
    { code: "Minus", label: "-" },
    { code: "Equal", label: "=" },
    { code: "Backspace", label: "Backspace", width: "flex-1" },
  ],
  // QWERTY Row
  [
    { code: "Tab", label: "Tab", width: "w-14 md:w-16" },
    { code: "KeyQ", label: "Q" },
    { code: "KeyW", label: "W" },
    { code: "KeyE", label: "E" },
    { code: "KeyR", label: "R" },
    { code: "KeyT", label: "T" },
    { code: "KeyY", label: "Y" },
    { code: "KeyU", label: "U" },
    { code: "KeyI", label: "I" },
    { code: "KeyO", label: "O" },
    { code: "KeyP", label: "P" },
    { code: "BracketLeft", label: "[" },
    { code: "BracketRight", label: "]" },
    { code: "Backslash", label: "\\", width: "flex-1" },
  ],
  // ASDF Row
  [
    { code: "CapsLock", label: "Caps", width: "w-16 md:w-20" },
    { code: "KeyA", label: "A" },
    { code: "KeyS", label: "S" },
    { code: "KeyD", label: "D" },
    { code: "KeyF", label: "F" },
    { code: "KeyG", label: "G" },
    { code: "KeyH", label: "H" },
    { code: "KeyJ", label: "J" },
    { code: "KeyK", label: "K" },
    { code: "KeyL", label: "L" },
    { code: "Semicolon", label: ";" },
    { code: "Quote", label: "'" },
    { code: "Enter", label: "Enter", width: "flex-1" },
  ],
  // ZXCV Row
  [
    { code: "ShiftLeft", label: "Shift", width: "w-20 md:w-24" },
    { code: "KeyZ", label: "Z" },
    { code: "KeyX", label: "X" },
    { code: "KeyC", label: "C" },
    { code: "KeyV", label: "V" },
    { code: "KeyB", label: "B" },
    { code: "KeyN", label: "N" },
    { code: "KeyM", label: "M" },
    { code: "Comma", label: "," },
    { code: "Period", label: "." },
    { code: "Slash", label: "/" },
    { code: "ShiftRight", label: "Shift", width: "flex-1" },
  ],
  // Bottom Row
  [
    { code: "ControlLeft", label: "Ctrl", width: "w-12 md:w-14" },
    { code: "MetaLeft", label: "Win", width: "w-12 md:w-14" },
    { code: "AltLeft", label: "Alt", width: "w-12 md:w-14" },
    { code: "Space", label: "Space", width: "flex-1" },
    { code: "AltRight", label: "Alt", width: "w-12 md:w-14" },
    { code: "MetaRight", label: "Win", width: "w-12 md:w-14" },
    { code: "ContextMenu", label: "Menu", width: "w-12 md:w-14" },
    { code: "ControlRight", label: "Ctrl", width: "w-12 md:w-14" },
  ],
];

export default function InputTesterPlayground() {
  const [activeKeys, setActiveKeys] = createSignal<Set<string>>(new Set());
  const [testedKeys, setTestedKeys] = createSignal<Set<string>>(new Set());
  const [lastKey, setLastKey] = createSignal<{
    key: string;
    code: string;
    keyCode: number;
  } | null>(null);

  // Mouse State
  const [activeMouseButtons, setActiveMouseButtons] = createSignal<Set<number>>(
    new Set(),
  );
  const [testedMouseButtons, setTestedMouseButtons] = createSignal<Set<number>>(
    new Set(),
  );
  const [scrollDelta, setScrollDelta] = createSignal<number>(0);

  const handleKeyDown = (e: KeyboardEvent) => {
    // Prevent default browser shortcuts for Tab, Alt, etc. if active in window
    if (["Tab", "AltLeft", "AltRight", "F1", "F3", "F5"].includes(e.code)) {
      e.preventDefault();
    }

    const code = e.code;
    setLastKey({ key: e.key, code: e.code, keyCode: e.keyCode });

    setActiveKeys((prev) => {
      const next = new Set(prev);
      next.add(code);
      return next;
    });

    setTestedKeys((prev) => {
      const next = new Set(prev);
      next.add(code);
      return next;
    });
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    const code = e.code;
    setActiveKeys((prev) => {
      const next = new Set(prev);
      next.delete(code);
      return next;
    });
  };

  const handleMouseDown = (e: MouseEvent) => {
    const btn = e.button; // 0: Left, 1: Middle, 2: Right, 3: Back, 4: Forward
    setActiveMouseButtons((prev) => new Set(prev).add(btn));
    setTestedMouseButtons((prev) => new Set(prev).add(btn));
  };

  const handleMouseUp = (e: MouseEvent) => {
    const btn = e.button;
    setActiveMouseButtons((prev) => {
      const next = new Set(prev);
      next.delete(btn);
      return next;
    });
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    setScrollDelta((prev) => prev + (e.deltaY > 0 ? 1 : -1));
  };

  const handleReset = () => {
    setActiveKeys(new Set<string>());
    setTestedKeys(new Set<string>());
    setLastKey(null);
    setActiveMouseButtons(new Set<number>());
    setTestedMouseButtons(new Set<number>());
    setScrollDelta(0);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    });
  });

  return (
    <div class="input-tester-page w-full max-w-4xl mx-auto flex flex-col gap-6 text-darkslate-100 p-2 md:p-4 font-sans select-none">
      {/* Title Header */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Input tester
          </h1>
          <p class="text-xs sm:text-sm text-darkslate-300 mt-1">
            Test keyboard keys, mouse clicks, and scroll wheel events.
          </p>
        </div>

        <button
          onClick={handleReset}
          type="button"
          class="px-3.5 py-1.5 rounded-lg border border-darkslate-500 bg-darkslate-600/30 hover:bg-darkslate-600/60 hover:text-white transition text-darkslate-200 text-xs font-medium self-start sm:self-auto"
        >
          Reset test
        </button>
      </div>

      {/* Last Key Pressed Info Banner */}
      <div class="bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-6">
          <div>
            <span class="text-darkslate-400 block text-[10px]">Key</span>
            <span class="font-mono text-sm font-semibold text-white">
              {lastKey()
                ? lastKey()?.key === " "
                  ? "Space"
                  : lastKey()?.key
                : "-"}
            </span>
          </div>

          <div>
            <span class="text-darkslate-400 block text-[10px]">Code</span>
            <span class="font-mono text-sm font-semibold text-primary-300">
              {lastKey() ? lastKey()?.code : "-"}
            </span>
          </div>

          <div>
            <span class="text-darkslate-400 block text-[10px]">KeyCode</span>
            <span class="font-mono text-sm font-semibold text-darkslate-200">
              {lastKey() ? lastKey()?.keyCode : "-"}
            </span>
          </div>
        </div>

        <div class="text-darkslate-400 text-[11px]">
          Tested keys:{" "}
          <span class="text-primary-300 font-semibold">
            {testedKeys().size}
          </span>
        </div>
      </div>

      {/* Virtual Keyboard */}
      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between text-xs text-darkslate-300 md:hidden px-1">
          <span class="text-[11px] text-darkslate-400 italic">
            ↔ Scroll horizontally to view full keyboard layout
          </span>
        </div>
        <div class="bg-darkslate-800/80 border border-darkslate-500 rounded-2xl p-3 md:p-5 flex flex-col gap-2 overflow-x-auto">
          <For each={KEYBOARD_ROWS}>
            {(row) => (
              <div class="flex gap-1.5 min-w-[640px]">
                <For each={row}>
                  {(k) => {
                    const isActive = () => activeKeys().has(k.code);
                    const isTested = () => testedKeys().has(k.code);

                    return (
                      <div
                        class={`h-10 md:h-11 rounded-lg border text-xs font-mono font-medium flex items-center justify-center transition-all duration-75 ${
                          k.width || "flex-1 min-w-[34px]"
                        } ${
                          isActive()
                            ? "bg-primary-500 border-primary-400 text-white shadow-md scale-[0.97]"
                            : isTested()
                              ? "bg-primary-500/20 border-primary-500/50 text-primary-300"
                              : "bg-darkslate-700/60 border-darkslate-500 text-darkslate-200"
                        }`}
                      >
                        {k.label}
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Mouse Click & Scroll Tester */}
      <div class="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Mouse Interactive Test Box */}
        <div
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          class="md:col-span-8 bg-darkslate-800/80 border border-darkslate-500 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[160px] cursor-pointer hover:border-darkslate-400 transition"
        >
          <span class="text-xs text-darkslate-300 mb-2">Mouse Test Zone</span>
          <span class="text-xs text-darkslate-400 text-center">
            Click left, right, middle wheel, or scroll here
          </span>
        </div>

        {/* Mouse Buttons Status Display */}
        <div class="md:col-span-4 bg-darkslate-600/30 border border-darkslate-500 rounded-2xl p-4 flex flex-col gap-3 text-xs justify-between">
          <span class="font-medium text-white border-b border-darkslate-500 pb-2">
            Mouse Status
          </span>

          <div class="grid grid-cols-3 gap-2 text-center">
            {/* Left Click */}
            <div
              class={`p-2.5 rounded-lg border flex flex-col items-center justify-center ${
                activeMouseButtons().has(0)
                  ? "bg-primary-500 border-primary-400 text-white"
                  : testedMouseButtons().has(0)
                    ? "bg-primary-500/20 border-primary-500/50 text-primary-300"
                    : "bg-darkslate-700/60 border-darkslate-500 text-darkslate-300"
              }`}
            >
              <span class="text-[10px]">Left</span>
              <span class="font-bold mt-0.5">LMB</span>
            </div>

            {/* Middle Click */}
            <div
              class={`p-2.5 rounded-lg border flex flex-col items-center justify-center ${
                activeMouseButtons().has(1)
                  ? "bg-primary-500 border-primary-400 text-white"
                  : testedMouseButtons().has(1)
                    ? "bg-primary-500/20 border-primary-500/50 text-primary-300"
                    : "bg-darkslate-700/60 border-darkslate-500 text-darkslate-300"
              }`}
            >
              <span class="text-[10px]">Middle</span>
              <span class="font-bold mt-0.5">MMB</span>
            </div>

            {/* Right Click */}
            <div
              class={`p-2.5 rounded-lg border flex flex-col items-center justify-center ${
                activeMouseButtons().has(2)
                  ? "bg-primary-500 border-primary-400 text-white"
                  : testedMouseButtons().has(2)
                    ? "bg-primary-500/20 border-primary-500/50 text-primary-300"
                    : "bg-darkslate-700/60 border-darkslate-500 text-darkslate-300"
              }`}
            >
              <span class="text-[10px]">Right</span>
              <span class="font-bold mt-0.5">RMB</span>
            </div>
          </div>

          <div class="flex justify-between items-center bg-darkslate-700/40 p-2.5 rounded-lg border border-darkslate-500 text-darkslate-300">
            <span>Scroll Wheel Delta</span>
            <span class="font-mono font-semibold text-primary-300 tabular-nums">
              {scrollDelta()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
