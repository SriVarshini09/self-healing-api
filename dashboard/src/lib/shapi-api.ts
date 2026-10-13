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
    throw new Error(
      typeof failure?.error === 'string'
        ? `${response.status}: ${failure.error}`
        : `${response.status} ${path}`
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
