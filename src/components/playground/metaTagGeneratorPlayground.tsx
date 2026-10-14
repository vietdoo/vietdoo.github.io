import { createSignal, createMemo, Show } from "solid-js";

export default function MetaTagGeneratorPlayground() {
  const [title, setTitle] = createSignal("VietDoo - Developer & Designer");
  const [description, setDescription] = createSignal(
    "Personal portfolio and playground of creative tech experiments, web apps, and design explorations.",
  );
  const [url, setUrl] = createSignal("https://vietdoo.vndo.vn");
  const [image, setImage] = createSignal(
    "https://vietdoo.vndo.vn/apple-touch-icon.png",
  );
  const [author, setAuthor] = createSignal("VietDoo");
  const [twitter, setTwitter] = createSignal("@vietdoo");
  const [themeColor, setThemeColor] = createSignal("#0f172a");
  const [imageLoadError, setImageLoadError] = createSignal(false);

  const [copied, setCopied] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"code" | "preview">("preview");

  const generatedCode = createMemo(() => {
    const t = title().trim();
    const d = description().trim();
    const u = url().trim();
    const img = image().trim();
    const a = author().trim();
    const tw = twitter().trim();
    const color = themeColor().trim();

    return `<!-- Primary Meta Tags -->
<title>${t}</title>
<meta name="title" content="${t}" />
<meta name="description" content="${d}" />
${a ? `<meta name="author" content="${a}" />\n` : ""}${color ? `<meta name="theme-color" content="${color}" />\n` : ""}
<!-- Open Graph / Facebook -->
<meta property="og:type" content="website" />
<meta property="og:url" content="${u}" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
${img ? `<meta property="og:image" content="${img}" />\n` : ""}
<!-- Twitter -->
<meta property="twitter:card" content="summary_large_image" />
<meta property="twitter:url" content="${u}" />
<meta property="twitter:title" content="${t}" />
<meta property="twitter:description" content="${d}" />
${img ? `<meta property="twitter:image" content="${img}" />\n` : ""}${tw ? `<meta property="twitter:creator" content="${tw}" />` : ""}`.trim();
  });

  const domain = createMemo(() => {
    try {
      const parsed = new URL(url());
      return parsed.hostname;
    } catch {
      return url() || "example.com";
    }
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div class="meta-tag-generator-page w-full max-w-3xl mx-auto flex flex-col gap-6 text-darkslate-100 p-2 md:p-4 font-sans">
      {/* Title */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Meta tag generator
          </h1>
          <p class="text-xs sm:text-sm text-darkslate-300 mt-1">
            Create standard SEO, Open Graph, and Twitter Card meta tags with live
            social previews.
          </p>
        </div>
      </div>

      {/* Form Fields */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-4">
        {/* Title */}
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-semibold text-darkslate-200">
            Page Title
          </label>
          <input
            type="text"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder="Title of your web page"
            class="bg-darkslate-800 border border-darkslate-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
          />
        </div>

        {/* Description */}
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-semibold text-darkslate-200">
            Meta Description
          </label>
          <textarea
            rows="3"
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="Brief summary of page content for search engines..."
            class="bg-darkslate-800 border border-darkslate-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500 resize-none"
          />
        </div>

        {/* Page URL */}
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-semibold text-darkslate-200">
            Page URL
          </label>
          <input
            type="text"
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
            placeholder="https://example.com"
            class="bg-darkslate-800 border border-darkslate-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
          />
        </div>

        {/* Image URL */}
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-semibold text-darkslate-200">
            OG Image URL
          </label>
          <input
            type="text"
            value={image()}
            onInput={(e) => {
              setImage(e.currentTarget.value);
              setImageLoadError(false);
            }}
            placeholder="https://example.com/og.png"
            class="bg-darkslate-800 border border-darkslate-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
          />
        </div>

        {/* Author */}
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-semibold text-darkslate-200">Author</label>
          <input
            type="text"
            value={author()}
            onInput={(e) => setAuthor(e.currentTarget.value)}
            placeholder="Author name"
            class="bg-darkslate-800 border border-darkslate-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
          />
        </div>

        {/* Twitter Handle */}
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-semibold text-darkslate-200">
            Twitter Handle
          </label>
          <input
            type="text"
            value={twitter()}
            onInput={(e) => setTwitter(e.currentTarget.value)}
            placeholder="@username"
            class="bg-darkslate-800 border border-darkslate-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
          />
        </div>
      </div>

      {/* Output Section with Tabs */}
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between border-b border-darkslate-500 pb-2">
          <div class="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              class={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                activeTab() === "preview"
                  ? "bg-primary-500 text-white"
                  : "bg-darkslate-600/30 text-darkslate-300 hover:text-white"
              }`}
            >
              Social Previews
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("code")}
              class={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                activeTab() === "code"
                  ? "bg-primary-500 text-white"
                  : "bg-darkslate-600/30 text-darkslate-300 hover:text-white"
              }`}
            >
              Generated Code
            </button>
          </div>

          <Show when={activeTab() === "code"}>
            <button
              type="button"
              onClick={handleCopy}
              aria-live="polite"
              class="px-3 py-1 text-xs font-medium rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition"
            >
              {copied() ? "Copied HTML" : "Copy Tags"}
            </button>
          </Show>
        </div>

        {/* Social Card & Google Previews */}
        <Show when={activeTab() === "preview"}>
          <div class="flex flex-col gap-6 pt-2">
            {/* Google Search Result Preview */}
            <div class="flex flex-col gap-2">
              <span class="text-xs font-semibold text-darkslate-300">
                Google Search Result
              </span>
              <div class="bg-white rounded-xl p-4 text-left shadow-md flex flex-col gap-1 border border-slate-200">
                <span class="text-xs text-slate-600 truncate">
                  {url() || "https://example.com"}
                </span>
                <h3 class="text-lg font-medium text-blue-800 hover:underline truncate cursor-pointer">
                  {title() || "Page Title"}
                </h3>
                <p class="text-xs text-slate-700 leading-normal line-clamp-2">
                  {description() ||
                    "Meta description snippet will appear here in search engine results..."}
                </p>
              </div>
            </div>

            {/* Social Card / Twitter Card Preview */}
            <div class="flex flex-col gap-2">
              <span class="text-xs font-semibold text-darkslate-300">
                Social Media Card (Open Graph / Twitter)
              </span>
              <div class="bg-darkslate-800 rounded-xl overflow-hidden border border-darkslate-500 flex flex-col">
                <Show
                  when={image().trim().length > 0}
                  fallback={
                    <div class="h-36 bg-darkslate-600/40 flex items-center justify-center text-darkslate-400 text-xs italic">
                      No Image URL provided
                    </div>
                  }
                >
                  <Show
                    when={!imageLoadError()}
                    fallback={
                      <div class="flex h-44 items-center justify-center bg-darkslate-600/40 px-4 text-center text-xs italic text-darkslate-400">
                        Image preview unavailable for this URL
                      </div>
                    }
                  >
                    <img
                      src={image()}
                      alt="OG Preview"
                      class="w-full h-44 object-cover bg-darkslate-900"
                      onError={() => setImageLoadError(true)}
                    />
                  </Show>
                </Show>
                <div class="p-4 flex flex-col gap-1">
                  <span class="text-[11px] font-medium text-darkslate-400 uppercase tracking-wider">
                    {domain()}
                  </span>
                  <h4 class="text-sm font-semibold text-white truncate">
                    {title() || "Page Title"}
                  </h4>
                  <p class="text-xs text-darkslate-300 line-clamp-2 leading-relaxed">
                    {description() || "Description snippet for social cards..."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* Code Output Tab */}
        <Show when={activeTab() === "code"}>
          <div class="relative">
            <pre class="bg-darkslate-800 border border-darkslate-500 rounded-xl p-4 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
              <code>{generatedCode()}</code>
            </pre>
          </div>
        </Show>
      </div>
    </div>
  );
}
