import { For, Show, createEffect, createSignal } from "solid-js";
import MarkdownIt from "markdown-it";
import { getApiUrl } from "../../lib/api-config";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

const INITIAL_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Xin chào! Mình có thể giúp bạn phân tích ý tưởng, viết nội dung, giải thích code hoặc brainstorm giải pháp. Hãy gửi một câu hỏi để bắt đầu.",
};

const SUGGESTIONS = [
  "Giải thích ngắn gọn cách hoạt động của smart routing",
  "Review ý tưởng landing page cho một sản phẩm AI",
  "Viết checklist tối ưu một API production",
];

function formatMarkdown(content: string) {
  return markdown.render(content);
}

export default function ChatbotPlayground() {
  const [messages, setMessages] = createSignal<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  let messagesEl: HTMLDivElement | undefined;
  let textareaEl: HTMLTextAreaElement | undefined;

  createEffect(() => {
    messages();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  const resizeTextarea = () => {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 160)}px`;
  };

  const submitMessage = async () => {
    const content = input().trim();
    if (!content || isLoading()) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
    };
    const nextMessages = [...messages(), userMessage];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setIsLoading(true);
    if (textareaEl) textareaEl.style.height = "auto";

    try {
      const response = await fetch(getApiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success || !payload.message?.content) {
        throw new Error(payload?.error || "Không thể nhận phản hồi lúc này.");
      }
      setMessages([
        ...nextMessages,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: payload.message.content,
        },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Không thể nhận phản hồi lúc này.",
      );
    } finally {
      setIsLoading(false);
      requestAnimationFrame(() => textareaEl?.focus());
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  };

  const clearChat = () => {
    setMessages([INITIAL_MESSAGE]);
    setError("");
    setInput("");
    requestAnimationFrame(() => textareaEl?.focus());
  };

  const copyMessage = async (content: string) => {
    await navigator.clipboard?.writeText(content);
  };

  return (
    <div class="w-full max-w-5xl mx-auto flex flex-col gap-5 text-neutral-100 p-2 md:p-4 font-sans">
      <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-neutral-800/80">
        <div>
          <p class="text-[10px] font-medium tracking-[0.2em] uppercase text-sky-400 mb-2">
            vndo-ai playground
          </p>
          <h1 class="text-2xl md:text-3xl font-bold tracking-tight text-white">
            Smart chat
          </h1>
          <p class="text-sm text-neutral-400 mt-1 max-w-xl">
            Chat tự nhiên với routing tự động phía server để ưu tiên độ ổn định
            và khả năng đáp ứng.
          </p>
        </div>
        <button
          type="button"
          onClick={clearChat}
          class="rounded-lg border border-neutral-700 bg-neutral-900/70 px-3 py-2 text-xs font-medium text-neutral-300 transition hover:border-neutral-500 hover:text-white"
        >
          New conversation
        </button>
      </div>

      <div class="overflow-hidden rounded-2xl border border-neutral-800/90 bg-neutral-950/70 shadow-2xl shadow-black/20">
        <div
          ref={messagesEl}
          class="flex min-h-[420px] max-h-[58vh] flex-col gap-4 overflow-y-auto p-4 md:p-6"
        >
          <For each={messages()}>
            {(message) => (
              <div
                class={`flex w-full ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  class={`group max-w-[92%] md:max-w-[78%] rounded-2xl border px-4 py-3 ${
                    message.role === "user"
                      ? "border-sky-500/30 bg-sky-500/15 text-sky-50"
                      : "border-neutral-800 bg-neutral-900/80 text-neutral-200"
                  }`}
                >
                  <div class="mb-2 flex items-center justify-between gap-4 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                    <span>{message.role === "user" ? "You" : "vndo-ai"}</span>
                    <Show when={message.role === "assistant"}>
                      <button
                        type="button"
                        onClick={() => void copyMessage(message.content)}
                        class="opacity-0 transition group-hover:opacity-100 hover:text-white"
                        aria-label="Copy response"
                      >
                        Copy
                      </button>
                    </Show>
                  </div>
                  <Show
                    when={message.role === "assistant"}
                    fallback={
                      <p class="whitespace-pre-wrap text-sm leading-7">
                        {message.content}
                      </p>
                    }
                  >
                    <div
                      class="chat-markdown text-sm leading-7"
                      innerHTML={formatMarkdown(message.content)}
                    />
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={isLoading()}>
            <div class="flex justify-start">
              <div class="rounded-2xl border border-neutral-800 bg-neutral-900/80 px-4 py-3 text-sm text-neutral-400">
                <span class="inline-flex items-center gap-2">
                  <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                  Đang suy nghĩ…
                </span>
              </div>
            </div>
          </Show>
        </div>

        <Show when={messages().length === 1 && !isLoading()}>
          <div class="flex flex-wrap gap-2 border-t border-neutral-800/80 px-4 py-3 md:px-6">
            <For each={SUGGESTIONS}>
              {(suggestion) => (
                <button
                  type="button"
                  onClick={() => {
                    setInput(suggestion);
                    requestAnimationFrame(() => textareaEl?.focus());
                  }}
                  class="rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1.5 text-left text-xs text-neutral-400 transition hover:border-sky-500/50 hover:text-sky-300"
                >
                  {suggestion}
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="border-t border-neutral-800/80 p-3 md:p-4">
          <Show when={error()}>
            <p class="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error()}
            </p>
          </Show>
          <div class="flex items-end gap-2 rounded-xl border border-neutral-800 bg-neutral-900/80 p-2 focus-within:border-sky-500/60">
            <textarea
              ref={textareaEl}
              value={input()}
              onInput={(event) => {
                setInput(event.currentTarget.value);
                resizeTextarea();
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isLoading()}
              placeholder="Ask anything…"
              aria-label="Message"
              class="max-h-40 min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-white outline-none placeholder:text-neutral-600 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void submitMessage()}
              disabled={isLoading() || !input().trim()}
              class="rounded-lg bg-sky-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
          <p class="mt-2 px-1 text-[10px] text-neutral-600">
            Enter để gửi · Shift + Enter để xuống dòng
          </p>
        </div>
      </div>

      <style>{`
        .chat-markdown :global(p) { margin: 0 0 0.8rem; }
        .chat-markdown :global(p:last-child) { margin-bottom: 0; }
        .chat-markdown :global(h1), .chat-markdown :global(h2), .chat-markdown :global(h3) { color: #f5f5f5; font-weight: 650; margin: 1rem 0 0.5rem; line-height: 1.35; }
        .chat-markdown :global(h1:first-child), .chat-markdown :global(h2:first-child), .chat-markdown :global(h3:first-child) { margin-top: 0; }
        .chat-markdown :global(ul), .chat-markdown :global(ol) { margin: 0.6rem 0 0.8rem 1.2rem; }
        .chat-markdown :global(li) { padding-left: 0.2rem; margin: 0.25rem 0; }
        .chat-markdown :global(a) { color: #7dd3fc; text-decoration: underline; text-underline-offset: 3px; }
        .chat-markdown :global(strong) { color: #fff; font-weight: 650; }
        .chat-markdown :global(blockquote) { margin: 0.8rem 0; border-left: 2px solid #38bdf8; padding-left: 0.8rem; color: #a3a3a3; }
        .chat-markdown :global(code) { border-radius: 0.35rem; background: #171717; padding: 0.12rem 0.32rem; font-size: 0.9em; color: #bae6fd; }
        .chat-markdown :global(pre) { margin: 0.8rem 0; overflow-x: auto; border: 1px solid #262626; border-radius: 0.65rem; background: #0a0a0a; padding: 0.8rem; }
        .chat-markdown :global(pre code) { background: transparent; padding: 0; color: #d4d4d4; }
      `}</style>
    </div>
  );
}
