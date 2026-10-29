/**
 * 後端 API 網路請求核心客戶端 (apiClient.ts)
 * 統一管理 HTTP 請求、錯誤攔截與後端連線異常捕捉
 */

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || '/api';

/**
 * 自訂 API 錯誤類別，攜帶 HTTP 狀態碼與後端詳細錯誤說明
 */
export class BackendApiError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status = 500, detail?: string) {
    super(message);
    this.name = 'BackendApiError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * 通用 HTTP 請求封裝
 * 具備 JSON 解析與網路斷線異常捕捉
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers || {});

  // 若非 FormData 上傳且無指定 Content-Type，預設帶入 application/json
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorMessage = `請求失敗 (HTTP ${response.status})`;
      let detail = '';

      try {
        const errorJson = await response.json();
        if (errorJson.detail) {
          if (typeof errorJson.detail === 'string') {
            detail = errorJson.detail;
            errorMessage = detail;
          } else if (Array.isArray(errorJson.detail)) {
            const formatted = errorJson.detail
              .map((d: { loc?: unknown[]; msg?: string }) => {
                const field = Array.isArray(d.loc) ? d.loc.slice(1).join('.') : '欄位';
                return `${field}: ${d.msg || '格式不符'}`;
              })
              .join('；');
            detail = JSON.stringify(errorJson.detail);
            errorMessage = `資料驗證失敗（${formatted}）`;
          } else {
            detail = JSON.stringify(errorJson.detail);
            errorMessage = detail;
          }
        } else if (errorJson.message) {
          errorMessage = errorJson.message;
        }
      } catch {
        // 若無法解析 JSON 則保留預設訊息
      }

      throw new BackendApiError(errorMessage, response.status, detail);
    }

    // 成功回傳並解析 JSON
    return (await response.json()) as T;
  } catch (error: unknown) {
    if (error instanceof BackendApiError) {
      throw error;
    }

    // 網路連線中斷或後端伺服器未啟動
    const originalMsg = error instanceof Error ? error.message : String(error);
    throw new BackendApiError(
      `無法連線至後端服務 (${API_BASE_URL})，請確認後端 Python 服務已啟動。(${originalMsg})`,
      0,
      originalMsg
    );
  }
}

/**
 * API 客戶端捷徑封裝
 */
export const apiClient = {
  get: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'GET' }),

  post: <T>(endpoint: string, body?: unknown) =>
    apiRequest<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(endpoint: string, body?: unknown) =>
    apiRequest<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(endpoint: string, body?: unknown) =>
    apiRequest<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(endpoint: string) =>
    apiRequest<T>(endpoint, { method: 'DELETE' }),

  /**
   * 檔案上傳專用 (multipart/form-data)
   */
  upload: <T>(endpoint: string, formData: FormData) =>
    apiRequest<T>(endpoint, {
      method: 'POST',
      body: formData,
    }),
};
