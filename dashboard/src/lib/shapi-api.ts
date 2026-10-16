// Shared SHAPI API client for dashboard panels.
const runtimeConfig =
  (globalThis as { __SHAPI_CONFIG__?: { apiUrl?: string; apiKey?: string } }).__SHAPI_CONFIG__ ??
  {};
export const SHAPI_API =
  runtimeConfig.apiUrl ||
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? '/api/v1' : 'http://localhost:3001/api/v1');
const isLocalhost =
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
export const SHAPI_KEY =
  runtimeConfig.apiKey ||
  import.meta.env.VITE_SHAPI_API_KEY ||
  (isLocalhost ? 'shapi_demo_local_d3v_k3y_9f2c' : '');

export async function fetchShapi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SHAPI_API}/${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(SHAPI_KEY ? { 'x-api-key': SHAPI_KEY } : {}), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { error?: unknown } | null;
    // Show the server's sentence as-is; people don't need HTTP status codes.
    const message = typeof failure?.error === 'string'
      ? failure.error
      : response.status === 401
        ? 'Your session has ended. Sign in again.'
        : response.status === 403
          ? "You don't have permission to do that."
          : response.status === 429
            ? 'Too many requests. Wait a minute and try again.'
            : `Something went wrong (error ${response.status}). Please try again.`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
