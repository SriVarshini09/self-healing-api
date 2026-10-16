import { describe, expect, it } from 'vitest';
import { isIpOrCidr, productionConfigIssues, productionConfigWarnings } from './config-validation.js';

const safe = { NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48) };

describe('productionConfigIssues', () => {
  it('allows complete production credentials', () => {
    expect(productionConfigIssues({
      ...safe,
      GITHUB_APP_ID: '5142476',
      GITHUB_APP_PRIVATE_KEY: 'private-key',
      GITHUB_WEBHOOK_SECRET_APP: 'webhook-secret',
    })).toEqual([]);
  });

  it('rejects placeholder secrets in production', () => {
    expect(productionConfigIssues({ ...safe, JWT_SECRET: 'your-super-secret-jwt-key-min-32-chars-long' })).toContain(
      'JWT_SECRET must be replaced with a unique production secret',
    );
  });

  it('rejects partial GitHub App credentials', () => {
    expect(productionConfigIssues({ ...safe, GITHUB_APP_ID: '5142476' })).toContain(
      'GITHUB_APP_ID, one GitHub App private-key source, and GITHUB_WEBHOOK_SECRET_APP must be configured together',
    );
  });

  it('accepts a file or base64 private-key source', () => {
    expect(productionConfigIssues({
      ...safe,
      GITHUB_APP_ID: '5142476',
      GITHUB_APP_PRIVATE_KEY_FILE: '/run/secrets/github-app-key',
      GITHUB_WEBHOOK_SECRET_APP: 'webhook-secret',
    })).toEqual([]);
    expect(productionConfigIssues({
      ...safe,
      GITHUB_APP_ID: '5142476',
      GITHUB_APP_PRIVATE_KEY_B64: 'base64-key',
      GITHUB_WEBHOOK_SECRET_APP: 'webhook-secret',
    })).toEqual([]);
  });

  it('rejects multiple private-key sources', () => {
    expect(productionConfigIssues({
      ...safe,
      GITHUB_APP_ID: '5142476',
      GITHUB_APP_PRIVATE_KEY: 'private-key',
      GITHUB_APP_PRIVATE_KEY_B64: 'base64-key',
      GITHUB_WEBHOOK_SECRET_APP: 'webhook-secret',
    })).toContain(
      'Configure only one GitHub App private-key source: GITHUB_APP_PRIVATE_KEY, GITHUB_APP_PRIVATE_KEY_FILE, or GITHUB_APP_PRIVATE_KEY_B64',
    );
  });

  it('rejects partial token-mode credentials', () => {
    expect(productionConfigIssues({ ...safe, GITHUB_TOKEN: 'token', GITHUB_ACCOUNT_LOGIN: 'owner' })).toContain(
      'GITHUB_TOKEN, GITHUB_ACCOUNT_LOGIN, and GITHUB_REPOSITORIES must be configured together',
    );
  });

  it('rejects partial OIDC credentials', () => {
    expect(productionConfigIssues({
      ...safe,
      OIDC_ISSUER_URL: 'https://issuer.example.test',
      OIDC_CLIENT_ID: 'client-id',
      OIDC_REDIRECT_URI: 'https://api.example.test/api/v1/auth/callback',
    })).toContain(
      'OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI, and OIDC_DEFAULT_TENANT_SLUG must be configured together',
    );
  });

  it('accepts a complete OIDC configuration', () => {
    expect(productionConfigIssues({
      ...safe,
      OIDC_ISSUER_URL: 'https://issuer.example.test',
      OIDC_CLIENT_ID: 'client-id',
      OIDC_CLIENT_SECRET: 'client-secret',
      OIDC_REDIRECT_URI: 'https://api.example.test/api/v1/auth/callback',
      OIDC_DEFAULT_TENANT_SLUG: 'local-dev',
    })).toEqual([]);
  });

  it('requires a signing secret when production alert delivery is enabled', () => {
    expect(productionConfigIssues({ ...safe, ALERT_WEBHOOK_URL: 'https://alerts.example.test/shapi' })).toContain(
      'ALERT_WEBHOOK_URL requires ALERT_WEBHOOK_SECRET for signed production delivery',
    );
    expect(productionConfigIssues({
      ...safe,
      ALERT_WEBHOOK_URL: 'https://alerts.example.test/shapi',
      ALERT_WEBHOOK_SECRET: 'a'.repeat(32),
    })).not.toContain('ALERT_WEBHOOK_URL requires ALERT_WEBHOOK_SECRET for signed production delivery');
  });

  it('does not apply production guards in development', () => {
    expect(productionConfigIssues({ NODE_ENV: 'development', JWT_SECRET: 'your-super-secret' })).toEqual([]);
  });
});

describe('productionConfigWarnings', () => {
  it('warns (without failing boot) when the encryption key or egress IPs are missing in production', () => {
    const warnings = productionConfigWarnings(safe);
    expect(warnings.some(warning => warning.startsWith('SHAPI_ENCRYPTION_KEY is not set'))).toBe(true);
    expect(warnings.some(warning => warning.startsWith('SHAPI_EGRESS_IPS is not set'))).toBe(true);
    expect(productionConfigIssues(safe)).toEqual([]);
  });

  it('is quiet when everything is configured, and outside production', () => {
    expect(productionConfigWarnings({
      ...safe,
      SHAPI_ENCRYPTION_KEY: 'k'.repeat(40),
      SHAPI_EGRESS_IPS: ['44.226.145.213', '44.229.200.0/24'],
      DASHBOARD_URL: 'https://shapi-dashboard.onrender.com',
    })).toEqual([]);
    expect(productionConfigWarnings({ ...safe, NODE_ENV: 'development' })).toEqual([]);
  });

  it('warns when emailed and alert links would point at localhost', () => {
    const warnings = productionConfigWarnings({ ...safe, DASHBOARD_URL: 'http://localhost:5173' });
    expect(warnings.some(warning => warning.startsWith('DASHBOARD_URL points at localhost'))).toBe(true);
  });
});

describe('isIpOrCidr', () => {
  it.each(['203.0.113.10', '198.51.100.0/24', '0.0.0.0/0', '2600:1f14::1', '2600:1f14::/32'])('accepts %s', entry => {
    expect(isIpOrCidr(entry)).toBe(true);
  });

  it.each(['', 'example.com', '203.0.113.10/33', '198.51.100.0/', '198.51.100.0/2a', '1.2.3.4/8/8', '2600::/129', '256.1.1.1'])('rejects %s', entry => {
    expect(isIpOrCidr(entry)).toBe(false);
  });
});
