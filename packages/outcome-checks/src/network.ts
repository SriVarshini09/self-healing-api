// Hosted SHAPI connects to databases its users name. Without a guard, a
// workspace could point an outcome check at SHAPI's own network (its database,
// cloud metadata at 169.254.169.254, other internal services) and use the
// connection errors to probe it. In hosted mode every address a database host
// resolves to must be public.
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) blocked.addSubnet(network, prefix, 'ipv6');

/** True for loopback, private, link-local and other non-internet addresses. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as the IPv4 address it maps to.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(address, 'ipv6');
}

export type LookupAll = (hostname: string) => Promise<Array<{ address: string }>>;
const defaultLookup: LookupAll = hostname => dnsLookup(hostname, { all: true, verbatim: true });

export class PrivateDatabaseHostError extends Error {}

/**
 * Throws PrivateDatabaseHostError unless the URL names a host whose every
 * address is public. Query-string host overrides and Unix sockets are refused
 * because they bypass the hostname check.
 */
export async function assertPublicDatabaseHost(connectionString: string, lookup: LookupAll = defaultLookup): Promise<void> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new PrivateDatabaseHostError('Database URL is not a valid URL');
  }
  for (const key of ['host', 'hostaddr']) {
    if (url.searchParams.has(key)) throw new PrivateDatabaseHostError(`Remove the "${key}" parameter and put the database host in the URL itself`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) throw new PrivateDatabaseHostError('The database URL needs a public hostname');
  let addresses: Array<{ address: string }>;
  try {
    addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname);
  } catch {
    throw new PrivateDatabaseHostError(`Could not resolve database host ${hostname}`);
  }
  if (!addresses.length) throw new PrivateDatabaseHostError(`Could not resolve database host ${hostname}`);
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new PrivateDatabaseHostError(
      `${hostname} is a private or internal address. Hosted SHAPI only connects to databases reachable on the public internet; allowlist SHAPI's outbound IPs instead.`,
    );
  }
}
