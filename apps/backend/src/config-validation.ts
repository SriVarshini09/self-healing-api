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
  ALERT_WEBHOOK_URL?: string;
  ALERT_WEBHOOK_SECRET?: string;
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

  if (present(input.ALERT_WEBHOOK_URL) && !present(input.ALERT_WEBHOOK_SECRET)) {
    issues.push('ALERT_WEBHOOK_URL requires ALERT_WEBHOOK_SECRET for signed production delivery');
  }

  return issues;
}
