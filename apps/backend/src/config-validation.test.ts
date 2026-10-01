import { describe, expect, it } from 'vitest';
import { productionConfigIssues } from './config-validation.js';

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
