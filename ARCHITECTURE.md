# vietdoo-folio - Architecture Overview

This document provides a comprehensive overview of the architecture and design decisions behind the `vietdoo-folio` project.

## 1. Overview & Tech Stack

`vietdoo-folio` is a highly interactive, server-rendered bento-grid personal portfolio website with integrated AI playgrounds, a blog, and a secure admin console.

The core technology stack includes:
- **Astro (Server Output):** The primary framework driving the application. Chosen for its excellent server-side rendering (SSR), ease of integration with multiple UI frameworks (Islands Architecture), and robust content management capabilities.
- **SolidJS:** Used for the majority of interactive client-side components (e.g., UI panels, maps) due to its fine-grained reactivity and minimal overhead.
- **Svelte:** Used for specific UI interactions.
- **Three.js & D3.js:** Power the complex 3D visualizations (e.g., interactive Globe) and data-driven maps.
- **UnoCSS:** The atomic CSS engine utilized for styling, providing high performance, flexibility, and easy dynamic theming (Dark/Light modes).
- **Astro DB (LibSQL / Turso):** Serves as the database layer, allowing seamless schema definitions and type-safe queries directly within Astro endpoints and components.
- **AI Integration:** Features a custom "Smart Router" that orchestrates requests to multiple LLM providers (OrcaRouter, OpenRouter).

## 2. Directory Structure & Organization

The codebase is structured to separate concerns while leveraging Astro's file-based routing:

- **`src/pages/`**: Contains the routes of the application. Each `.astro` file maps directly to a URL path. It includes main pages (like `index.astro`, `resume.astro`, `blog/index.astro`), API endpoints (`api/`), the admin console (`admin/`), and the AI playgrounds (`playground/`).
- **`src/components/`**: Houses all the UI components. Includes Astro components (for static/server-rendered UI) and SolidJS/Svelte components (for interactive client-side islands). Components are categorized (e.g., `Card/`, `Blog/`, `ui/`).
- **`src/layouts/`**: Contains layout wrappers like `Layout.astro` and `BasicLayout.astro` that define the global HTML skeleton, inject meta tags for SEO, and set up global scripts (analytics, theme initialization).
- **`src/lib/`**: Contains shared logic, helper functions, constants, and server-side utilities.
  - **`src/lib/server/`**: Strictly server-side logic, preventing accidental leakage to the client. Contains the `admin-auth.ts` and the `ai/` folder (Smart Router logic).
- **`db/config.ts`**: Defines the Astro DB schema, establishing tables for the guestbook, blog comments, AI configurations, and audit logs.
- **`src/content.config.ts`**: Defines schemas for Astro Content Collections (e.g., for parsing local Markdown/MDX blog posts).

## 3. Routing, Layout, and SEO

- **File-based Routing:** Driven by `src/pages`. Dynamic routes are supported. API routes are also defined here (e.g., `.ts` files returning `Response` objects).
- **Global Layouts:** `BasicLayout.astro` manages the document `<head>`, injecting critical SEO metadata, Open Graph tags, and Twitter Cards based on page props. It also initializes the UI theme to prevent flashing and sets up View Transitions (`<GridTransition />`).
- **View Transitions:** Enabled for smooth, app-like page navigation without full reloads, enhancing UX.

## 4. AI Smart Router Architecture

The project features a sophisticated AI proxy layer located in `src/lib/server/ai/`:

- **Smart Router (`smart-router.ts`):** Orchestrates AI requests. It analyzes the required capabilities (e.g., `text`, `image`, `video`) and selects the most appropriate model route from the `model-catalog.ts`.
- **Failover & Circuit Breaker:** Implements a retry mechanism and a circuit breaker pattern. If a provider (e.g., OrcaRouter) fails or times out, the router automatically falls back to an alternative provider (e.g., OpenRouter) based on priority and capabilities, ensuring high availability.
- **Provider Agnosticism:** The frontend simply requests a completion with specific capabilities, completely unaware of which backend provider is actually fulfilling the request.
- **Audit Logging (`audit-log.ts`):** Every AI request, successful or failed, is logged to Astro DB (`AiRequestLog` table). This tracks usage, errors, duration, token usage, and failover events.

## 5. Database Architecture (Astro DB)

Configured in `db/config.ts`, the application uses Astro DB with the following core tables:
- **`Guestbook`:** Stores guestbook entries.
- **`BlogComment`:** Stores comments on blog posts.
- **`AiModelConfig`:** Manages the enablement status of different AI models at runtime.
- **`AiRequestLog`:** The audit ledger for all AI transactions, tracking capabilities, latency, and routing paths.

Queries are executed server-side within `.astro` frontmatter or API endpoints, utilizing the type-safe `db.select().from(...)` syntax.

## 6. Security and Admin Console

The application includes a protected `/admin` route.
- **Authentication (`src/lib/server/admin-auth.ts`):** Uses an HTTP-only, secure session cookie. The token contains a payload (username, role, expiration) signed with an HMAC-SHA256 signature using a server-side secret (`ADMIN_SESSION_SECRET`).
- **Environment Variables:** Strict separation between server-side secrets (API keys, session secrets, database tokens) and public variables. The client never receives raw keys or prompts.
- **Session Validation:** The server verifies the HMAC signature on every request to protected routes.

## 7. UI/UX and Performance Optimizations

- **Bento-grid Design:** The layout utilizes a responsive grid system, providing a clean, modular, and content-rich interface.
- **Dynamic Theming:** Supported via UnoCSS and CSS variables. The theme is applied dynamically and persisted in `localStorage`.
- **Typography:** Optimized for Vietnamese characters using web-safe and custom fonts ('Be Vietnam Pro', 'Plus Jakarta Sans', 'Lora', 'Satoshi', 'Cabinet Grotesk').
- **Performance:**
  - Heavy re-renders in SolidJS and D3 visualizations (due to window resizes) are debounced.
  - `createMemo` is actively used in SolidJS components to prevent redundant evaluations.
  - Explicit cleanup (`onCleanup`) is mandated for D3 timers and globally appended DOM elements to prevent memory leaks across View Transitions.
  - View Transitions provide a smooth SPA-like feel while retaining the SEO benefits of SSR.
