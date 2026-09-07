export type GuestbookEntry = {
  id: number;
  name: string;
  message: string;
  website: string | null;
  heartCount: number | null;
  createdAt: Date | string;
};

export const ENTRIES_PER_PAGE = 10;

export const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
] as const;

export const getInitials = (fullName: string): string =>
  fullName
    .split(" ")
    .map((word) => word[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 2);

export const formatTimeAgo = (createdAt: Date | string): string => {
  const daysAgo = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / 86400000,
  );
  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 30) return `${daysAgo}d ago`;
  if (daysAgo < 365) return `${Math.floor(daysAgo / 30)}mo ago`;
  return `${Math.floor(daysAgo / 365)}y ago`;
};

export const rotationFromSeed = (seed: number): number =>
  (((seed * 7) % 6) - 3) * 0.4;

export const avatarColorForSeed = (seed: number): string =>
  AVATAR_COLORS[
    ((seed % AVATAR_COLORS.length) + AVATAR_COLORS.length) %
      AVATAR_COLORS.length
  ];

export const normalizeWebsiteUrl = (url?: string | null): string | null => {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
};

export const escapeHtml = (untrustedText: string): string => {
  return untrustedText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

export const renderGuestbookCardHtml = (entry: GuestbookEntry): string => {
  const rotationDegrees = rotationFromSeed(entry.id);
  const avatarColor = avatarColorForSeed(entry.id);
  const avatarInitials = getInitials(entry.name);
  const escapedName = escapeHtml(entry.name);
  const cleanWebsite = entry.website
    ? normalizeWebsiteUrl(entry.website)
    : null;
  const nameMarkup = cleanWebsite
    ? `<a href="${escapeHtml(cleanWebsite)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-white hover:text-primary-400 transition-colors text-sm">${escapedName}</a>`
    : `<span class="font-semibold text-white text-sm">${escapedName}</span>`;

  const heartCount = entry.heartCount ?? 0;
  const timeAgo = formatTimeAgo(entry.createdAt);

  return `
    <article data-entry-id="${entry.id}" class="guestbook-entry bg-darkslate-500 p-5 rounded-xl border border-darkslate-400 hover:border-primary-500/50 transition-[border-color,transform] duration-300 hover:rotate-0 flex flex-col gap-3" style="transform: rotate(${rotationDegrees}deg);">
      <p class="text-darkslate-100 text-sm leading-relaxed whitespace-pre-wrap flex-1">${escapeHtml(entry.message)}</p>
      <footer class="flex items-center gap-2.5 pt-2 border-t border-darkslate-400/50">
        <div class="flex-shrink-0 w-7 h-7 rounded-full ${avatarColor} flex items-center justify-center text-white text-xs font-bold select-none">${avatarInitials}</div>
        <div class="min-w-0 flex-1 flex items-baseline gap-1.5 flex-wrap">
          ${nameMarkup}
          <span class="text-darkslate-300 text-xs">${timeAgo}</span>
        </div>
        <button type="button" data-heart-button data-heart-count="${heartCount}" aria-label="Send love" title="Send love" class="heart-btn flex items-center gap-1 px-2 py-1 rounded-md text-darkslate-300 hover:text-white hover:bg-darkslate-400/30 transition-colors text-xs">${PIXEL_HEART_SVG}<span class="heart-count tabular-nums">${heartCount}</span></button>
      </footer>
    </article>
  `;
};


