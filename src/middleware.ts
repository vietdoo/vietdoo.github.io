import { defineMiddleware } from "astro:middleware";

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/vietdoo\.github\.io$/,
  /^https:\/\/.*\.github\.io$/,
  /^https:\/\/vietdoo\.vndo\.vn$/,
  /^https:\/\/.*\.vndo\.vn$/,
  /^https:\/\/vietdoo\.vercel\.app$/,
  /^https:\/\/.*\.vercel\.app$/,
];

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

function getCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
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

    // 1. Nếu là request cùng origin (same-origin, origin null): tiếp tục bình thường
    if (!origin) {
      return next();
    }

    // 2. Kiểm tra origin trong whitelist bảo mật
    const allowed = isOriginAllowed(origin);

    // Nếu là preflight OPTIONS:
    if (request.method === "OPTIONS") {
      if (!allowed) {
        return new Response("CORS policy: Origin not allowed", { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(origin),
      });
    }

    // 3. Xử lý request chính
    const response = await next();

    // Chỉ đính kèm CORS headers nếu origin nằm trong whitelist
    if (allowed) {
      const corsHeaders = getCorsHeaders(origin);
      for (const [headerName, headerValue] of Object.entries(corsHeaders)) {
        response.headers.set(headerName, headerValue);
      }
    }

    return response;
  }

  return next();
});
