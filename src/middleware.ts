import { defineMiddleware } from "astro:middleware";

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/vietdoo\.github\.io$/,
  /^https:\/\/.*\.github\.io$/,
  /^https:\/\/vietdoo\.vndo\.vn$/,
  /^https:\/\/.*\.vndo\.vn$/,
  /^https:\/\/.*\.vercel\.app$/,
];

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && isOriginAllowed(origin) ? origin : "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With, X-AI-Request-ID, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;

  // Chỉ can thiệp CORS cho các endpoint API
  if (url.pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");

    // 1. Xử lý preflight request HTTP OPTIONS từ browser
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(origin),
      });
    }

    // 2. Chạy endpoint chính và đính kèm headers CORS vào kết quả
    const response = await next();
    const corsHeaders = getCorsHeaders(origin);

    for (const [headerName, headerValue] of Object.entries(corsHeaders)) {
      response.headers.set(headerName, headerValue);
    }

    return response;
  }

  return next();
});
