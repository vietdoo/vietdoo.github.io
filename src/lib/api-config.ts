/**
 * Cấu hình tập trung cho API client và định tuyến backend
 * Hỗ trợ Dual Deploy: Vercel (bản Full) và GitHub Pages (bản Min tĩnh)
 * Tích hợp cơ chế Smart Failover (tự động chuyển sang URL dự phòng vietdoo.vercel.app khi tên miền chính gặp sự cố).
 */

export const PRIMARY_BACKEND_ORIGIN = "https://vietdoo.vndo.vn";
export const FALLBACK_BACKEND_ORIGIN = "https://vietdoo.vercel.app";

// Biến lưu trữ backend origin đang hoạt động (trong runtime phiên duyệt web)
let activeBackendOrigin: string | null = null;

/**
 * Đánh dấu primary backend gặp sự cố và chuyển vĩnh viễn sang fallback trong phiên hiện tại
 */
export function markPrimaryBackendFailed(): void {
  activeBackendOrigin = FALLBACK_BACKEND_ORIGIN;
  if (typeof console !== "undefined") {
    console.warn(
      `[API Failover] Backend chính (${PRIMARY_BACKEND_ORIGIN}) không phản hồi. Tự động chuyển hướng sang backend dự phòng: ${FALLBACK_BACKEND_ORIGIN}`,
    );
  }
}

/**
 * Lấy Base URL của backend API.
 * - Ưu tiên 1: Backend fallback đã được kích hoạt do lỗi runtime -> FALLBACK_BACKEND_ORIGIN.
 * - Ưu tiên 2: Biến môi trường `PUBLIC_API_BASE_URL` (nếu có cấu hình riêng).
 * - Ưu tiên 3: Nếu đang chạy trên GitHub Pages (*.github.io):
 *     Mặc định dùng PRIMARY_BACKEND_ORIGIN (https://vietdoo.vndo.vn).
 * - Mặc định (Vercel hoặc Localhost): Dùng relative path ("") để tối ưu và cùng origin.
 */
export function getApiBaseUrl(): string {
  if (activeBackendOrigin) {
    return activeBackendOrigin;
  }

  const envBaseUrl = import.meta.env.PUBLIC_API_BASE_URL;
  if (envBaseUrl && typeof envBaseUrl === "string") {
    return envBaseUrl.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname.endsWith("github.io")) {
      return PRIMARY_BACKEND_ORIGIN;
    }
    return "";
  }

  // Phục vụ SSR / Build-time
  if (import.meta.env.GITHUB_PAGES === "true") {
    return PRIMARY_BACKEND_ORIGIN;
  }

  return "";
}

/**
 * Trả về URL đầy đủ cho một endpoint API.
 * Có thể ghi đè origin nếu cần thử endpoint dự phòng.
 */
export function getApiUrl(path: string, overrideOrigin?: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const base =
    overrideOrigin !== undefined
      ? overrideOrigin.replace(/\/+$/, "")
      : getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}

/**
 * Wrapper `apiFetch` thông minh có cơ chế Auto Failover:
 * 1. Gửi request đến Primary URL (vietdoo.vndo.vn).
 * 2. Nếu gặp lỗi mạng (DNS timeout/hết hạn tên miền, connection refused) hoặc mã lỗi 502/503/504:
 *    -> Tự động retry ngay lập tức sang Fallback URL (vietdoo.vercel.app).
 * 3. Ghi nhớ trạng thái fallback để các request sau gọi thẳng vào backend dự phòng.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const isGitHubPages =
    typeof window !== "undefined" &&
    window.location.hostname.endsWith("github.io");

  // Nếu không phải GitHub Pages và không dùng failover: gọi relative bình thường
  if (
    !isGitHubPages &&
    !activeBackendOrigin &&
    !import.meta.env.PUBLIC_API_BASE_URL
  ) {
    return fetch(cleanPath, init);
  }

  const primaryUrl = getApiUrl(cleanPath);

  try {
    const response = await fetch(primaryUrl, init);

    // Nếu gặp lỗi gateway/server die và chưa ở fallback:
    if (
      (response.status === 502 ||
        response.status === 503 ||
        response.status === 504) &&
      !primaryUrl.includes(FALLBACK_BACKEND_ORIGIN)
    ) {
      markPrimaryBackendFailed();
      const fallbackUrl = getApiUrl(cleanPath, FALLBACK_BACKEND_ORIGIN);
      return await fetch(fallbackUrl, init);
    }

    return response;
  } catch (networkError) {
    // Nếu gặp sự cố mạng (DNS tên miền chính hết hạn / không phân giải được)
    if (!primaryUrl.includes(FALLBACK_BACKEND_ORIGIN)) {
      markPrimaryBackendFailed();
      const fallbackUrl = getApiUrl(cleanPath, FALLBACK_BACKEND_ORIGIN);
      return await fetch(fallbackUrl, init);
    }
    throw networkError;
  }
}

/**
 * Helper parse JSON an toàn từ response, tránh văng lỗi HTML parser khi server trả về trang lỗi.
 */
export async function parseJsonResponse<T = any>(
  response: Response,
  fallbackErrorMessage = "Lỗi xử lý phản hồi từ máy chủ",
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    const isHtml = text.trim().startsWith("<");
    return {
      ok: false,
      error: isHtml
        ? `${fallbackErrorMessage} (Mã trạng thái ${response.status})`
        : text || fallbackErrorMessage,
    };
  }

  try {
    const data = await response.json();
    return { ok: response.ok, data, error: data?.error };
  } catch {
    return { ok: false, error: fallbackErrorMessage };
  }
}
