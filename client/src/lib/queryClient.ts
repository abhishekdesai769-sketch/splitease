import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// ─── Client-error auto-logging ────────────────────────────────────────────
//
// Every non-2xx response from the server gets POSTed to /api/client-errors
// so the admin can review what users are hitting. Fire-and-forget — failure
// to log NEVER affects the user's flow. We rate-limit ourselves in-browser
// to one log per minute per (endpoint, status, message) tuple so a
// pathological API failing repeatedly doesn't spam our log table.
const _recentLogs = new Map<string, number>();
function shouldLogError(key: string): boolean {
  const now = Date.now();
  const last = _recentLogs.get(key) || 0;
  if (now - last < 60_000) return false;       // already logged in past minute
  _recentLogs.set(key, now);
  // Opportunistic cleanup so the map doesn't grow forever
  if (_recentLogs.size > 200) {
    for (const [k, t] of _recentLogs) {
      if (now - t > 5 * 60_000) _recentLogs.delete(k);
    }
  }
  return true;
}

export function logClientError(payload: {
  endpoint?: string;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
  contextJson?: string;
  url?: string;
}) {
  try {
    const key = `${payload.endpoint || ""}|${payload.statusCode || 0}|${(payload.errorMessage || "").slice(0, 100)}`;
    if (!shouldLogError(key)) return;
    // Fire-and-forget. No await, no throw — telemetry must never break UX.
    fetch(`${API_BASE}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        ...payload,
        url: payload.url || (typeof window !== "undefined" ? window.location.href : undefined),
      }),
      keepalive: true,                          // survives page unload
    }).catch(() => { /* never throw from telemetry */ });
  } catch { /* never throw from telemetry */ }
}

async function throwIfResNotOk(res: Response, method: string, url: string) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // Auto-log every non-2xx so the admin sees what users are hitting.
    // We don't log 401 (auth required) — that's a normal app state, not
    // an error. Everything else is a candidate for review.
    if (res.status !== 401) {
      // Try to extract a clean error message from the JSON body if present.
      let cleanMessage = text;
      let errorCode: string | undefined;
      try {
        const parsed = JSON.parse(text);
        cleanMessage = parsed?.message || parsed?.error || text;
        errorCode = parsed?.error;
      } catch { /* not JSON, keep raw */ }
      logClientError({
        endpoint: `${method} ${url}`,
        statusCode: res.status,
        errorCode,
        errorMessage: typeof cleanMessage === "string" ? cleanMessage : String(cleanMessage),
      });
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res, method, url);
  return res;
}

/** Send FormData (for file uploads) — no Content-Type header (browser sets boundary) */
export async function apiFormRequest(
  method: string,
  url: string,
  formData: FormData,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    body: formData,
    credentials: "include",
  });

  await throwIfResNotOk(res, method, url);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const path = queryKey.join("/");
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, "GET", path);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchOnWindowFocus: true,
      staleTime: 30 * 1000, // 30 seconds — data refreshes on window focus after this
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
