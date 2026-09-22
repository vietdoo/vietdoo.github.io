import { createSignal, onCleanup, onMount, For, Show } from "solid-js";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { ContactDetails } from "@/lib/contact-secure";

const navLinks = [
  { name: "Blog", href: "/blog" },
  { name: "Showcase", href: "/engineering-showcase" },
  { name: "Playground", href: "/playground" },
];

const menuSections = [
  {
    label: "Khám phá",
    links: [
      {
        name: "Trang chủ",
        description: "Một góc nhỏ của vietdoo",
        href: "/",
        index: "01",
      },
      {
        name: "Bài viết",
        description: "Ghi chép về engineering & AI",
        href: "/blog",
        index: "02",
      },
      {
        name: "Engineering Showcase",
        description: "Những thứ đang được xây dựng",
        href: "/engineering-showcase",
        index: "03",
      },
      {
        name: "Playground",
        description: "Các thử nghiệm nhỏ trên web",
        href: "/playground",
        index: "04",
      },
    ],
  },
  {
    label: "Kết nối",
    links: [
      {
        name: "Guestbook",
        description: "Để lại một lời nhắn",
        href: "/guestbook",
        index: "05",
      },
      {
        name: "Bookshelf",
        description: "Những cuốn sách đang đọc",
        href: "/books",
        index: "06",
      },
      {
        name: "Vietnam Journey",
        description: "10 tỉnh thành đã ghé qua",
        href: "/visit",
        index: "07",
      },
      {
        name: "Resume",
        description: "Kinh nghiệm & kỹ năng",
        href: "/resume",
        index: "08",
      },
    ],
  },
];

export function Navigation() {
  const [isScrolled, setIsScrolled] = createSignal(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = createSignal(false);
  const [isContactOpen, setIsContactOpen] = createSignal(false);
  const [isPhoneCopied, setIsPhoneCopied] = createSignal(false);
  const [contact, setContact] = createSignal<ContactDetails | null>(null);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);
  const closeContact = () => {
    setIsContactOpen(false);
    setIsPhoneCopied(false);
  };
  const openContact = async () => {
    closeMobileMenu();
    setIsContactOpen(true);
    if (!contact()) {
      const { getContactDetails } = await import("@/lib/contact-secure");
      setContact(getContactDetails());
    }
  };
  const copyPhoneNumber = async () => {
    const phone = contact()?.phone;
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      setIsPhoneCopied(true);
      window.setTimeout(() => setIsPhoneCopied(false), 2200);
    } catch {
      setIsPhoneCopied(false);
    }
  };

  onMount(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileMenu();
        closeContact();
      }
    };

    window.addEventListener("scroll", handleScroll);
    window.addEventListener("keydown", handleKeydown);
    handleScroll();

    onCleanup(() => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeydown);
    });
  });

  return (
    <>
      <header
        class={`fixed z-50 transition-all duration-500 ${
          isScrolled() ? "top-4 left-4 right-4" : "top-0 left-0 right-0"
        }`}
      >
        <nav
          class={`mx-auto transition-all duration-500 ${
            isScrolled() || isMobileMenuOpen()
              ? "bg-darkslate-800/80 backdrop-blur-xl border border-darkslate-500 rounded-2xl shadow-lg max-w-[1200px]"
              : "bg-transparent max-w-[1400px]"
          }`}
        >
          <div
            class={`flex items-center justify-between transition-all duration-500 px-6 lg:px-8 ${
              isScrolled() ? "h-14" : "h-20"
            }`}
          >
            <div class="flex items-center gap-3 shrink-0">
              <a
                href="/"
                class="flex items-center gap-2.5 group text-white no-underline"
                aria-label="Về trang chủ vietdoo"
              >
                <img
                  src="/vndo.png"
                  alt="VNDO logo"
                  width={40}
                  height={40}
                  class={`rounded-md object-cover transition-all duration-500 ${
                    isScrolled() ? "w-7 h-7" : "w-9 h-9"
                  }`}
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.onerror = null;
                    target.src = "/icon-light-32x32.png";
                  }}
                />
                <span class="hidden sm:flex flex-col leading-none">
                  <span class="text-[11px] font-bold tracking-[0.16em] uppercase text-white">
                    vietdoo
                  </span>
                  <span class="text-[9px] tracking-[0.08em] text-darkslate-300 mt-1">
                    VNDO / ENGINEERING
                  </span>
                </span>
              </a>
            </div>

            <div class="hidden md:flex items-center gap-10">
              <For each={navLinks}>
                {(link) => (
                  <a
                    href={link.href}
                    data-skip-loader
                    class="text-sm text-darkslate-200 hover:text-white transition-colors duration-300 relative group"
                  >
                    {link.name}
                    <span class="absolute -bottom-1 left-0 w-0 h-px bg-primary-400 transition-all duration-300 group-hover:w-full" />
                  </a>
                )}
              </For>
            </div>

            <div class="hidden md:flex items-center gap-4">
              <ThemeToggle />
              <a
                href="/resume"
                class="text-darkslate-200 hover:text-white transition-all duration-500 text-sm"
              >
                Resume
              </a>
              <button
                type="button"
                onClick={openContact}
                class="inline-flex items-center justify-center bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-full transition-all duration-500 shadow-sm px-5 h-10 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/80"
                aria-haspopup="dialog"
                aria-expanded={isContactOpen()}
              >
                Say hello{" "}
                <span
                  aria-hidden="true"
                  class="ml-1 transition-transform duration-300 group-hover:translate-x-0.5"
                >
                  ↗
                </span>
              </button>
            </div>

            <div class="md:hidden flex items-center gap-2">
              <ThemeToggle compact />
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen())}
                class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white hover:border-primary-400/60 hover:text-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 active:scale-95 transition-all"
                aria-label={isMobileMenuOpen() ? "Đóng menu" : "Mở menu"}
                aria-expanded={isMobileMenuOpen()}
                aria-controls="mobile-navigation"
              >
                {isMobileMenuOpen() ? (
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.8"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                ) : (
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.8"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M4 7h16M4 12h16M4 17h10"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </nav>
      </header>

      <div
        class={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
          isMobileMenuOpen()
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!isMobileMenuOpen()}
        onClick={closeMobileMenu}
      >
        <aside
          id="mobile-navigation"
          role="dialog"
          aria-modal="true"
          aria-label="Điều hướng vietdoo"
          onClick={(event) => event.stopPropagation()}
          class={`absolute right-0 top-0 flex h-full w-[min(91vw,430px)] flex-col overflow-y-auto border-l border-white/10 bg-darkslate-900/98 px-5 pb-6 pt-5 shadow-2xl transition-transform duration-300 ${
            isMobileMenuOpen() ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div class="flex items-center justify-between border-b border-white/10 pb-5">
            <div class="flex items-center gap-3">
              <img
                src="/vndo.png"
                alt="VNDO logo"
                width="40"
                height="40"
                class="h-10 w-10 rounded-xl object-cover"
              />
              <div>
                <p class="m-0 text-sm font-bold tracking-[0.16em] text-white">
                  VIETDOO
                </p>
                <p class="m-0 mt-1 text-[10px] uppercase tracking-[0.14em] text-darkslate-300">
                  personal folio / vndo
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeMobileMenu}
              class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/75 hover:border-primary-400/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 active:scale-95 transition-all"
              aria-label="Đóng menu"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.8"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div class="relative mt-6 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-xl">
            <div
              class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-400 to-transparent"
              aria-hidden="true"
            />
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-primary-300">
                  Currently building
                </p>
                <h2 class="m-0 mt-2 text-xl font-bold tracking-tight text-white">
                  Do Quoc Viet <span class="text-primary-300">(vietdoo)</span>
                </h2>
                <p class="m-0 mt-2 text-xs leading-relaxed text-darkslate-200">
                  Software Engineer @ VNPT · Founder @ VNDO
                </p>
              </div>
              <span
                class="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
                aria-label="Đang hoạt động"
              />
            </div>
            <p class="m-0 mt-4 max-w-[34ch] text-sm leading-relaxed text-white/75">
              Building scalable backend systems, data infrastructure and AI
              agent workflows.
            </p>
          </div>

          <div class="mt-7 shrink-0 flex flex-col gap-7">
            <For each={menuSections}>
              {(section) => (
                <section>
                  <p class="m-0 mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-darkslate-400">
                    {section.label}
                  </p>
                  <div class="flex flex-col gap-1">
                    <For each={section.links}>
                      {(link, index) => (
                        <a
                          href={link.href}
                          data-skip-loader
                          onClick={closeMobileMenu}
                          class={`group flex items-center gap-3 rounded-xl border border-transparent px-3 py-3.5 transition-all duration-200 hover:border-white/10 hover:bg-white/5 ${
                            isMobileMenuOpen()
                              ? "translate-y-0 opacity-100"
                              : "translate-y-2 opacity-0"
                          }`}
                          style={{
                            "transition-delay": isMobileMenuOpen()
                              ? `${index() * 35}ms`
                              : "0ms",
                          }}
                        >
                          <span class="w-6 shrink-0 font-mono text-[10px] text-primary-400/70 group-hover:text-primary-300">
                            {link.index}
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="block text-[15px] font-semibold text-white group-hover:text-primary-300">
                              {link.name}
                            </span>
                            <span class="mt-1 block truncate text-xs text-darkslate-300">
                              {link.description}
                            </span>
                          </span>
                          <span
                            class="text-lg text-darkslate-500 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary-300"
                            aria-hidden="true"
                          >
                            ↗
                          </span>
                        </a>
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </div>
        </aside>
      </div>

      <div
        class={`fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-[2px] transition-opacity duration-200 ${
          isContactOpen()
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        role="presentation"
        onClick={closeContact}
        aria-hidden={!isContactOpen()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-dialog-title"
          aria-describedby="contact-dialog-description"
          onClick={(event) => event.stopPropagation()}
          class={`relative w-full max-w-[410px] overflow-hidden rounded-[1.25rem] border border-darkslate-700 bg-darkslate-900 p-4 shadow-xl shadow-black/30 transition-all duration-200 sm:p-5 ${
            isContactOpen()
              ? "translate-y-0 scale-100"
              : "translate-y-3 scale-95"
          }`}
        >
          <div class="relative flex items-start justify-between gap-4">
            <div>
              <p class="m-0 text-[9px] font-bold uppercase tracking-[0.18em] text-primary-300/90">
                Let&apos;s connect
              </p>
              <h2
                id="contact-dialog-title"
                class="m-0 mt-1.5 font-serif text-[1.75rem] font-semibold tracking-tight text-white"
              >
                Say hello
              </h2>
              <p
                id="contact-dialog-description"
                class="m-0 mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-darkslate-300"
              >
                Có một ý tưởng, dự án hoặc chỉ muốn trò chuyện? Mình rất vui
                được kết nối.
              </p>
            </div>
            <button
              type="button"
              onClick={closeContact}
              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-darkslate-700 bg-darkslate-800/70 text-base text-darkslate-400 transition-colors hover:border-darkslate-500 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/80"
              aria-label="Đóng thông tin liên hệ"
            >
              ×
            </button>
          </div>

          <div class="relative mt-5 grid gap-2.5">
            <Show
              when={contact()}
              fallback={
                <p class="m-0 rounded-xl border border-darkslate-700 bg-darkslate-800/20 p-4 text-center text-[13px] text-darkslate-300">
                  Đang tải thông tin liên hệ…
                </p>
              }
            >
              {(c) => (
                <>
            <a
              href={c().mailto}
              class="group flex items-start gap-3 rounded-xl border border-darkslate-700 bg-darkslate-800/20 p-3 transition-colors duration-200 hover:border-darkslate-600 hover:bg-darkslate-800/70"
            >
              <span
                class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-darkslate-800 text-primary-300"
                aria-hidden="true"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.7"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3 7.5 12 13l9-5.5M4.5 6h15A1.5 1.5 0 0 1 21 7.5v9A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6Z"
                  />
                </svg>
              </span>
              <span class="min-w-0 flex-1 pt-0.5">
                <span class="block text-[9px] font-bold uppercase tracking-[0.16em] text-darkslate-300">
                  Email
                </span>
                <span class="mt-0.5 block truncate text-[13px] font-medium text-darkslate-100">
                  {c().email}
                </span>
              </span>
              <span
                class="mt-0.5 text-base text-darkslate-500 transition-colors group-hover:text-primary-300"
                aria-hidden="true"
              >
                ↗
              </span>
            </a>

            <a
              href={c().zalo}
              target="_blank"
              rel="noreferrer"
              class="group flex items-start gap-3 rounded-xl border border-darkslate-700 bg-darkslate-800/20 p-3 transition-colors duration-200 hover:border-darkslate-600 hover:bg-darkslate-800/70"
            >
              <span
                class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-darkslate-800"
                aria-hidden="true"
              >
                <img
                  src="/assets/zalo-logo.png"
                  alt=""
                  class="h-auto w-7 object-contain"
                />
              </span>
              <span class="min-w-0 flex-1 pt-0.5">
                <span class="block text-[9px] font-bold uppercase tracking-[0.16em] text-darkslate-300">
                  Zalo
                </span>
                <span class="mt-0.5 block text-[13px] font-medium text-darkslate-100">
                  {c().phone}
                </span>
              </span>
              <span
                class="mt-0.5 text-base text-darkslate-500 transition-colors group-hover:text-sky-300"
                aria-hidden="true"
              >
                ↗
              </span>
            </a>

            <div class="flex items-start gap-3 rounded-xl border border-darkslate-700 bg-darkslate-800/20 p-3">
              <span
                class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-darkslate-800 text-emerald-300"
                aria-hidden="true"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.7"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M6.5 4.5h2l1.25 3.25-1.5 1.75a13.2 13.2 0 0 0 6.25 6.25l1.75-1.5 3.25 1.25v2a1.5 1.5 0 0 1-1.5 1.5C11.1 19 5 12.9 5 5.75A1.5 1.5 0 0 1 6.5 4.5Z"
                  />
                </svg>
              </span>
              <span class="min-w-0 flex-1 pt-0.5">
                <span class="block text-[9px] font-bold uppercase tracking-[0.16em] text-darkslate-300">
                  Số điện thoại
                </span>
                <span class="mt-0.5 block text-[13px] font-medium text-darkslate-100">
                  {c().phone}
                </span>
              </span>
              <button
                type="button"
                onClick={copyPhoneNumber}
                class="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-darkslate-600 bg-darkslate-800 px-2.5 py-1.5 text-[11px] font-medium text-darkslate-200 transition-colors hover:border-emerald-300/40 hover:text-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80"
                aria-label="Sao chép số điện thoại"
              >
                {isPhoneCopied() ? "Đã copy" : "Copy"}
              </button>
            </div>
                </>
              )}
            </Show>
          </div>

          <p class="relative m-0 mt-4 text-center text-[10px] text-darkslate-500">
            Thường phản hồi trong vòng 24 giờ
          </p>
        </div>
      </div>
    </>
  );
}
