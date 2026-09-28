/**
 * Reply serializer for API responses. Plain JSON.stringify throws
 * "Do not know how to serialize a BigInt" on Prisma models with BigInt
 * columns (e.g. GitHubInstallation.githubInstallationId), turning an
 * otherwise successful handler into a 500. BigInts here are snowflake-ish
 * IDs/timestamps well within Number.MAX_SAFE_INTEGER.
 */
export function serializeJson(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload, (_key, value) =>
    typeof value === 'bigint' ? Number(value) : value,
  );
}
