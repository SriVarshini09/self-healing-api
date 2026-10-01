export type ProductionConfigInput = {
  NODE_ENV: string;
  JWT_SECRET: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET_APP?: string;
  GITHUB_TOKEN?: string;
  GITHUB_ACCOUNT_LOGIN?: string;
  GITHUB_REPOSITORIES?: string;
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

  const appFields = [input.GITHUB_APP_ID, input.GITHUB_APP_PRIVATE_KEY, input.GITHUB_WEBHOOK_SECRET_APP];
  if (appFields.some(present) && appFields.some(value => !present(value))) {
    issues.push('GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_WEBHOOK_SECRET_APP must be configured together');
  }

  const tokenFields = [input.GITHUB_TOKEN, input.GITHUB_ACCOUNT_LOGIN, input.GITHUB_REPOSITORIES];
  if (tokenFields.some(present) && tokenFields.some(value => !present(value))) {
    issues.push('GITHUB_TOKEN, GITHUB_ACCOUNT_LOGIN, and GITHUB_REPOSITORIES must be configured together');
  }

  return issues;
}
