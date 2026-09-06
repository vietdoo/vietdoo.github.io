## 2024-08-20 - [ARIA Live Regions on Dynamic Buttons]
**Learning:** Status buttons that change text (like "Copy" -> "Copied!") require `aria-live="polite"` so screen readers seamlessly announce the feedback.
**Action:** Always add `aria-live="polite"` to elements containing dynamic status text.

## 2024-05-18 - Missing Focus Styles on Utility Panels
**Learning:** Found that custom floating utility panels (like the Style Panel) were using `outline-none` to hide default browser rings on click, but did not provide a fallback for keyboard users (`focus-visible`). This made keyboard navigation entirely invisible for these controls.
**Action:** Always pair `focus-visible:outline-none` with custom focus rings like `focus-visible:ring-2 focus-visible:ring-primary-500/70` when customizing button outlines to ensure accessibility is maintained for keyboard users.

## 2024-09-06 - Dynamic aria-pressed on Custom Theme Toggles
**Learning:** Using `outline: none` on interactive buttons (like theme selectors) without a `:focus-visible` fallback severely degrades keyboard navigation. Furthermore, custom toggle buttons that change visual state (like active classes) must also dynamically update the `aria-pressed` attribute so screen readers receive accurate state feedback.
**Action:** Always provide custom `:focus-visible` styles when overriding default outlines, and ensure JavaScript managing visual toggle states also updates the `aria-pressed` attribute appropriately.
