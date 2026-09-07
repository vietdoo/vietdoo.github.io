## 2024-03-24 - SolidJS JSX Reactivity & Memoization
**Learning:** In SolidJS, a function accessed multiple times within a JSX template (e.g., `regionCounts().bac`, `regionCounts().trung`) will be re-evaluated each time the reactivity tracks it unless explicitly memoized. This can cause redundant O(N) evaluations for array operations.
**Action:** Use `createMemo` for any derived state involving iteration or expensive logic that is accessed multiple times in the component view.

## 2024-03-24 - Debouncing ResizeObservers in D3/SolidJS
**Learning:** Attaching heavy UI updates (like full DOM element replacement via D3 selection) directly to `ResizeObserver` causes massive layout thrashing and blocks the main thread because the observer fires continuously during resize events.
**Action:** Always wrap heavy re-renders triggered by `ResizeObserver` (or `window.onresize`) in a debounce function (e.g. 250ms `setTimeout`), and ensure the timer is cleared on component unmount.
## 2024-09-04 - Preventing Memory and CPU Leaks in SolidJS D3 Components
**Learning:** In this codebase, D3 timers (`d3.timer`) and globally appended elements (like `d3.select("body").append("div")`) used within SolidJS components (such as `Globe.tsx`) must be explicitly cleaned up. The framework does not automatically unmount DOM elements appended to the `body` by D3, nor does it clear running D3 timers. Failing to stop timers causes continuous background CPU usage and layout thrashing, and failing to remove elements causes memory leaks as users navigate between pages.
**Action:** Always import and utilize SolidJS's `onCleanup` hook when utilizing long-running D3 tasks or modifying elements outside the component's root boundary. Specifically, use `timer.stop()` for `d3.timer` instances and `.remove()` on globally appended D3 selections inside the `onCleanup` callback.
