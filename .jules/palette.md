## 2024-08-20 - [ARIA Live Regions on Dynamic Buttons]
**Learning:** Status buttons that change text (like "Copy" -> "Copied!") require `aria-live="polite"` so screen readers seamlessly announce the feedback.
**Action:** Always add `aria-live="polite"` to elements containing dynamic status text.
## 2025-03-03 - Missing ARIA Labels on Icon-only Modals
**Learning:** SolidJS/Astro admin and dashboard components often contain icon-only buttons (like '×' for close) which lack semantic labels and title tooltips for screen readers and usability.
**Action:** Always scan for generic textual icons like '×' inside `<button>` elements in `.tsx` and `.astro` files and provide them with proper `aria-label` and `title` attributes.

## 2024-05-18 - Missing Focus Styles on Utility Panels
**Learning:** Found that custom floating utility panels (like the Style Panel) were using `outline-none` to hide default browser rings on click, but did not provide a fallback for keyboard users (`focus-visible`). This made keyboard navigation entirely invisible for these controls.
**Action:** Always pair `focus-visible:outline-none` with custom focus rings like `focus-visible:ring-2 focus-visible:ring-primary-500/70` when customizing button outlines to ensure accessibility is maintained for keyboard users.

## 2024-09-06 - Dynamic aria-pressed on Custom Theme Toggles
**Learning:** Using `outline: none` on interactive buttons (like theme selectors) without a `:focus-visible` fallback severely degrades keyboard navigation. Furthermore, custom toggle buttons that change visual state (like active classes) must also dynamically update the `aria-pressed` attribute so screen readers receive accurate state feedback.
**Action:** Always provide custom `:focus-visible` styles when overriding default outlines, and ensure JavaScript managing visual toggle states also updates the `aria-pressed` attribute appropriately.

## 2024-09-12 - Ensure Custom Icon Buttons Have Focus Styles
**Learning:** Custom UI components without borders or backgrounds, like close (`×`) or refresh icon buttons on dashboards, often miss clear `:focus-visible` states, making them difficult to use for keyboard-only users. Default browser focus outlines may be suppressed or simply look broken without proper styling.
**Action:** Always provide clear `:focus-visible` outlines (e.g., matching the accent color with an `outline-offset`) on custom interactive elements (like `.drawer-close` or `.icon-button`), especially when they lack natural borders.
