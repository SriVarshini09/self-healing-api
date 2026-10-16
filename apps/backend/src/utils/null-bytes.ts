// PostgreSQL cannot store or compare the NUL character (U+0000): any query that carries one in
// an id, name or filter fails with "invalid byte sequence" and surfaced as a 500. Nothing in this
// API legitimately contains it, so it is refused up front as a plain 400.

/** True if the value, a URL, or any string nested inside an object/array contains U+0000. */
export function containsNullByte(value: unknown, maxNodes = 20_000): boolean {
  const stack: unknown[] = [value];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop();
    if (++visited > maxNodes) return false; // bounded work; the body size limit already caps depth
    if (typeof current === 'string') {
      if (current.includes('\u0000')) return true;
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (current && typeof current === 'object') {
      for (const [key, item] of Object.entries(current)) {
        if (key.includes('\u0000')) return true;
        stack.push(item);
      }
    }
  }
  return false;
}

/** A request URL that carries a NUL, literally or percent-encoded (also double-encoded). */
export function urlContainsNullByte(url: string): boolean {
  return /%(25)*00/i.test(url) || url.includes('\u0000');
}
