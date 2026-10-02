import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load repo-root .env for local dev (apps/backend -> ../..)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import { z } from 'zod';
import { productionConfigIssues } from './config-validation.js';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  INVARIANT_EVALUATION_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
  SHAPI_MAX_INVARIANTS_PER_TENANT: z.coerce.number().int().positive().default(100),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  API_KEY_PREFIX: z.string().default('shapi_'),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
  API_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  METRICS_TOKEN: z.preprocess(value => value === '' ? undefined : value, z.string().min(16).optional()),
  SHAPI_BOOTSTRAP_TOKEN: z.preprocess(
    value => value === '' ? undefined : value,
    z.string().min(32).optional(),
  ),
  OIDC_ISSUER_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  OIDC_CLIENT_ID: z.preprocess(value => value === '' ? undefined : value, z.string().optional()),
  OIDC_CLIENT_SECRET: z.preprocess(value => value === '' ? undefined : value, z.string().optional()),
  OIDC_REDIRECT_URI: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  OIDC_SCOPES: z.string().default('openid profile email'),
  OIDC_DEFAULT_TENANT_SLUG: z.preprocess(value => value === '' ? undefined : value, z.string().optional()),
  OIDC_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Webhook verification
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  SENDGRID_WEBHOOK_SECRET: z.string().optional(),
  TWILIO_WEBHOOK_SECRET: z.string().optional(),
  // GitHub App
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_FILE: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_B64: z.string().optional(),
  GITHUB_APP_SLUG: z.preprocess(
    value => value === '' ? undefined : value,
    z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  ),
  GITHUB_WEBHOOK_SECRET_APP: z.string().optional(),
  GITHUB_APP_INTEGRATION_ID: z.string().optional(),
  // Optional local/operator token mode for repositories where a GitHub App is
  // not available. Keep the allow-list explicit; never infer repositories
  // from a token alone.
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_ACCOUNT_LOGIN: z.string().optional(),
  GITHUB_REPOSITORIES: z.string().optional(),
  // Optional signed incident alert sink. The outbox remains disabled when unset.
  ALERT_WEBHOOK_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  ALERT_WEBHOOK_SECRET: z.preprocess(value => value === '' ? undefined : value, z.string().optional()),
  ALERT_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  ALERT_WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // Frontend URLs
  DASHBOARD_URL: z.string().url().default('http://localhost:5173'),
  DEMO_SAAS_URL: z.string().url().default('http://localhost:3000')
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const productionIssues = productionConfigIssues(parsed.data);
if (productionIssues.length > 0) {
  console.error('❌ Unsafe production configuration:', productionIssues);
  process.exit(1);
}

export const config = parsed.data;
