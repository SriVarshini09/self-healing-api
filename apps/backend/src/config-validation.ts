import { isIP } from 'node:net';

export type ProductionConfigInput = {
  NODE_ENV: string;
  JWT_SECRET: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_PRIVATE_KEY_FILE?: string;
  GITHUB_APP_PRIVATE_KEY_B64?: string;
  GITHUB_WEBHOOK_SECRET_APP?: string;
  GITHUB_TOKEN?: string;
  GITHUB_ACCOUNT_LOGIN?: string;
  GITHUB_REPOSITORIES?: string;
  OIDC_ISSUER_URL?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_REDIRECT_URI?: string;
  OIDC_DEFAULT_TENANT_SLUG?: string;
  ALERT_WEBHOOK_URL?: string;
  ALERT_WEBHOOK_SECRET?: string;
  SHAPI_ENCRYPTION_KEY?: string;
  SHAPI_EGRESS_IPS?: string[];
  DASHBOARD_URL?: string;
};

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function productionConfigIssues(input: ProductionConfigInput): string[] {
  if (input.NODE_ENV !== 'production') return [];

  const issues: string[] = [];
  if (/your-super-secret|replace_me|change-me|example/i.test(input.JWT_SECRET)) {
    issues.push('JWT_SECRET must be replaced with a unique production secret');
  }

  const appPrivateKeySources = [
    input.GITHUB_APP_PRIVATE_KEY,
    input.GITHUB_APP_PRIVATE_KEY_FILE,
    input.GITHUB_APP_PRIVATE_KEY_B64,
  ];
  const appConfigured = [input.GITHUB_APP_ID, input.GITHUB_WEBHOOK_SECRET_APP, ...appPrivateKeySources].some(present);
  if (appConfigured && (!present(input.GITHUB_APP_ID) || !present(input.GITHUB_WEBHOOK_SECRET_APP) || !appPrivateKeySources.some(present))) {
    issues.push('GITHUB_APP_ID, one GitHub App private-key source, and GITHUB_WEBHOOK_SECRET_APP must be configured together');
  }
  if (appPrivateKeySources.filter(present).length > 1) {
    issues.push('Configure only one GitHub App private-key source: GITHUB_APP_PRIVATE_KEY, GITHUB_APP_PRIVATE_KEY_FILE, or GITHUB_APP_PRIVATE_KEY_B64');
  }

  const tokenFields = [input.GITHUB_TOKEN, input.GITHUB_ACCOUNT_LOGIN, input.GITHUB_REPOSITORIES];
  if (tokenFields.some(present) && tokenFields.some(value => !present(value))) {
    issues.push('GITHUB_TOKEN, GITHUB_ACCOUNT_LOGIN, and GITHUB_REPOSITORIES must be configured together');
  }

  const oidcFields = [
    input.OIDC_ISSUER_URL,
    input.OIDC_CLIENT_ID,
    input.OIDC_CLIENT_SECRET,
    input.OIDC_REDIRECT_URI,
    input.OIDC_DEFAULT_TENANT_SLUG,
  ];
  if (oidcFields.some(present) && oidcFields.some(value => !present(value))) {
    issues.push('OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI, and OIDC_DEFAULT_TENANT_SLUG must be configured together');
  }

  if (present(input.ALERT_WEBHOOK_URL) && !present(input.ALERT_WEBHOOK_SECRET)) {
    issues.push('ALERT_WEBHOOK_URL requires ALERT_WEBHOOK_SECRET for signed production delivery');
  }

  return issues;
}

/** Not fatal (existing deployments must keep booting), but logged at every start. */
export function productionConfigWarnings(input: ProductionConfigInput): string[] {
  if (input.NODE_ENV !== 'production') return [];
  const warnings: string[] = [];
  if (!present(input.SHAPI_ENCRYPTION_KEY)) {
    warnings.push('SHAPI_ENCRYPTION_KEY is not set: stored customer secrets are encrypted with a key derived from JWT_SECRET, so rotating JWT_SECRET would make them unreadable. Set SHAPI_ENCRYPTION_KEY, then run pnpm secrets:reencrypt --apply.');
  }
  if (!input.SHAPI_EGRESS_IPS?.length) {
    warnings.push('SHAPI_EGRESS_IPS is not set: customers cannot see which IPs to allowlist on their database firewall.');
  }
  if (!input.DASHBOARD_URL || /localhost|127\.0\.0\.1/.test(input.DASHBOARD_URL)) {
    warnings.push('DASHBOARD_URL points at localhost: links in alerts, invite and password-reset emails will not open. Set it to the dashboard\'s public URL.');
  }
  return warnings;
}

/** "203.0.113.10" or "198.51.100.0/24" (IPv4 or IPv6). */
export function isIpOrCidr(entry: string): boolean {
  const [address, prefix, extra] = entry.split('/');
  const family = isIP(address);
  if (extra !== undefined || !family) return false;
  if (prefix === undefined) return true;
  return /^[0-9]{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}
