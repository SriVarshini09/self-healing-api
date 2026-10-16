// Route handlers that read the signature through next/headers get the headers of
// the request the harness is delivering (set by variant.ts). Anything else, such
// as cookies(), is outside what a webhook handler needs; fail loudly if it starts.
declare global {
  // eslint-disable-next-line no-var
  var __benchRequestHeaders: Record<string, string> | undefined;
}

export async function cookies(): Promise<never> {
  throw new Error('next/headers cookies() is not available in the benchmark harness');
}
export function headers(): Headers {
  if (!globalThis.__benchRequestHeaders) throw new Error('next/headers headers() called outside a delivered request');
  return new Headers(globalThis.__benchRequestHeaders);
}
