/**
 * Cấu hình tập trung cho API client và định tuyến backend
 * Hỗ trợ Dual Deploy: Vercel (bản Full) và GitHub Pages (bản Min tĩnh).
 */

export const DEFAULT_BACKEND_ORIGIN = "https://vietdoo.vndo.vn";

/**
 * Lấy Base URL của backend API.
 * - Ưu tiên 1: Biến môi trường `PUBLIC_API_BASE_URL` (nếu được thiết lập lúc build hoặc runtime).
 * - Ưu tiên 2: Nếu đang chạy trên GitHub Pages (*.github.io), tự động trỏ về backend Vercel.
 * - Mặc định (Vercel hoặc Localhost): Dùng relative path ("") để không phát sinh CORS preflight thừa.
 */
export function getApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.PUBLIC_API_BASE_URL;
  if (envBaseUrl && typeof envBaseUrl === "string") {
    return envBaseUrl.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname.endsWith("github.io")) {
      return DEFAULT_BACKEND_ORIGIN;
    }
    return "";
  }

  // Phục vụ trường hợp SSR / Build-time
  if (import.meta.env.GITHUB_PAGES === "true") {
    return DEFAULT_BACKEND_ORIGIN;
  }

  return "";
}

/**
 * Trả về URL đầy đủ cho một endpoint API.
 * Ví dụ: getApiUrl("/api/comments")
 * - Trên GitHub Pages -> "https://vietdoo.vndo.vn/api/comments"
 * - Trên Vercel / Localhost -> "/api/comments"
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
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
