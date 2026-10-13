// Webhook handlers never read cookies or request headers through next/headers
// in the code paths exercised here; fail loudly if one starts to.
export async function cookies(): Promise<never> {
  throw new Error('next/headers cookies() is not available in the benchmark harness');
}
export function headers(): never {
  throw new Error('next/headers headers() is not available in the benchmark harness');
}
