// Minimal stand-ins for the Next.js route-handler API, enough to execute a
// kit's real webhook handler outside Next.js.
export class NextRequest extends Request {}

export class NextResponse extends Response {
  static json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  }
}
