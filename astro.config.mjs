import { defineConfig, fontProviders } from "astro/config";
import sitemap from "@astrojs/sitemap";
import robotsTxt from "astro-robots-txt";
import UnoCSS from "@unocss/astro";
import icon from "astro-icon";
import vercel from "@astrojs/vercel";

import solidJs from "@astrojs/solid-js";
import { remarkReadingTime } from "./src/lib/remark-reading-time.mjs";

import svelte from "@astrojs/svelte";

import db from "@astrojs/db";
import { unified } from "@astrojs/markdown-remark";
import rehypeMermaid from "rehype-mermaid";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const envSiteUrl = isGitHubPages
  ? "https://vietdoo.github.io/"
  : (process.env.SITE_URL ?? "https://vietdoo.vndo.vn/");
const site = envSiteUrl.endsWith("/") ? envSiteUrl : `${envSiteUrl}/`;
const siteNoTrailingSlash = site.endsWith("/") ? site.slice(0, -1) : site;

// https://astro.build/config
export default defineConfig({
  output: isGitHubPages ? "static" : "server",
  adapter: isGitHubPages
    ? undefined
    : vercel({
        webAnalytics: { enabled: true },
      }),
  base: "/",
  redirects: {
    "/design-works": "/engineering-showcase",
  },
  fonts: [
    {
      provider: fontProviders.local(),
      name: "CabinetGrotesk",
      cssVariable: "--font-cabinet-grotesk",
      display: "swap",
      fallbacks: ["system-ui", "sans-serif"],
      optimizedFallbacks: true,
      options: {
        variants: [
          {
            weight: "100 1000",
            style: "normal",
            src: ["./src/assets/fonts/CabinetGrotesk-Variable.ttf"],
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: "Satoshi",
      cssVariable: "--font-satoshi",
      display: "swap",
      fallbacks: ["system-ui", "sans-serif"],
      optimizedFallbacks: true,
      options: {
        variants: [
          {
            weight: "100 1000",
            style: "normal",
            src: ["./src/assets/fonts/Satoshi-Variable.ttf"],
          },
          {
            weight: "100 1000",
            style: "italic",
            src: ["./src/assets/fonts/Satoshi-VariableItalic.ttf"],
          },
        ],
      },
    },
  ],
  site,
  integrations: [
    sitemap(),
    robotsTxt({
      policy: [
        {
          userAgent: "*",
          allow: ["/", "/blog/", "/books/", "/engineering-showcase/", "/guestbook/", "/playground/", "/resume/", "/travel/", "/visit/"],
          disallow: ["/admin/", "/api/", "/404/"],
        },
      ],
      sitemap: `${siteNoTrailingSlash}/sitemap-index.xml`,
    }),
    solidJs(),
    UnoCSS({ injectReset: true }),
    icon(),
    svelte(),
    db(),
  ],
  markdown: unified({
    remarkPlugins: [remarkReadingTime],
    rehypePlugins: [rehypeMermaid],
  }),
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  vite: {
    assetsInclude: "**/*.riv",
    optimizeDeps: {
      include: [
        "solid-js",
        "solid-js/web",
        "svelte",
        "three",
        "d3",
        "gsap",
        "lenis",
        "motion",
        "@rive-app/canvas",
        "cannon-es",
      ],
    },
  },
});
