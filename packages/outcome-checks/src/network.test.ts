import { describe, expect, it } from 'vitest';
import { assertPublicDatabaseHost, isPrivateAddress, PrivateDatabaseHostError, runOutcomeQuery, type LookupAll } from './index.js';

const resolvesTo = (...addresses: string[]): LookupAll => async () => addresses.map(address => ({ address }));
const neverResolves: LookupAll = async () => { throw new Error('ENOTFOUND'); };

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', 'not-an-ip',
  ])('blocks %s', address => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '35.160.1.2', '172.32.0.1', '192.169.0.1', '2600:1f14::1', '::ffff:8.8.8.8'])('allows %s', address => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('assertPublicDatabaseHost', () => {
  it('accepts a hostname that resolves only to public addresses', async () => {
    await expect(assertPublicDatabaseHost('postgresql://ro:pw@db.example.com:5432/app', resolvesTo('35.160.1.2', '2600:1f14::1'))).resolves.toBeUndefined();
  });

  it('refuses loopback, private and metadata addresses given literally', async () => {
    for (const url of [
      'postgresql://u:p@127.0.0.1:5432/db',
      'postgresql://u:p@10.0.0.5/db',
      'postgresql://u:p@169.254.169.254/db',
      'postgresql://u:p@[::1]:5432/db',
    ]) {
      await expect(assertPublicDatabaseHost(url, neverResolves)).rejects.toBeInstanceOf(PrivateDatabaseHostError);
    }
  });

  it('refuses a public-looking hostname that resolves to a private address', async () => {
    await expect(assertPublicDatabaseHost('postgresql://u:p@internal.example.com/db', resolvesTo('35.160.1.2', '10.0.0.7')))
      .rejects.toThrow(/private or internal/);
  });

  it('refuses host overrides in the query string and socket-only URLs', async () => {
    await expect(assertPublicDatabaseHost('postgresql://u:p@db.example.com/db?host=10.0.0.1', resolvesTo('35.160.1.2'))).rejects.toThrow(/"host" parameter/);
    await expect(assertPublicDatabaseHost('postgresql://u:p@db.example.com/db?hostaddr=10.0.0.1', resolvesTo('35.160.1.2'))).rejects.toThrow(/"hostaddr" parameter/);
    await expect(assertPublicDatabaseHost('postgresql:///db', resolvesTo('35.160.1.2'))).rejects.toThrow(/public hostname/);
  });

  it('refuses hosts that do not resolve', async () => {
    await expect(assertPublicDatabaseHost('postgresql://u:p@nope.invalid/db', neverResolves)).rejects.toThrow(/Could not resolve/);
  });
});

describe('runOutcomeQuery with blockPrivateHosts', () => {
  it('refuses before connecting', async () => {
    await expect(runOutcomeQuery({
      connectionString: 'postgresql://u:p@127.0.0.1:1/db',
      sql: 'SELECT 1',
      params: [],
      blockPrivateHosts: true,
    })).rejects.toBeInstanceOf(PrivateDatabaseHostError);
  });
});
