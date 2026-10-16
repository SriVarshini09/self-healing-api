import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load repo-root .env for local dev (apps/backend -> ../..)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import { z } from 'zod';
import { isIpOrCidr, productionConfigIssues, productionConfigWarnings } from './config-validation.js';

const optionalText = z.preprocess(value => value === '' ? undefined : value, z.string().optional());

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  INVARIANT_EVALUATION_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
  SHAPI_MAX_INVARIANTS_PER_TENANT: z.coerce.number().int().positive().default(100),
  // How long received Stripe/webhook events, tracked events and finished check runs
  // are kept. Older rows are deleted daily. 30 days is the floor: drift detection
  // compares against a recent baseline.
  SHAPI_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(90),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  // Key for secrets stored at rest (outcome-check database URLs, Stripe keys).
  // Falls back to a key derived from JWT_SECRET so existing deployments keep booting;
  // set it in production so rotating JWT_SECRET never makes stored secrets unreadable.
  SHAPI_ENCRYPTION_KEY: z.preprocess(value => value === '' ? undefined : value, z.string().min(32).optional()),
  // Comma-separated keys still accepted for decryption during a key rotation.
  // Run `pnpm secrets:reencrypt --apply`, then remove them.
  SHAPI_ENCRYPTION_KEY_PREVIOUS: optionalText,
  // Refuse outcome-check databases on loopback/private/internal addresses.
  // Defaults to on in production; turn off only for SHAPI self-hosted inside your own network.
  SHAPI_BLOCK_PRIVATE_DATABASE_HOSTS: z.preprocess(
    value => value === '' ? undefined : value,
    z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  ),
  // Outbound IPs/CIDRs (comma-separated) that customers allowlist on their database
  // firewall. Copy them from your host (Render: service -> Connect -> Outbound).
  SHAPI_EGRESS_IPS: z.preprocess(
    value => value === '' ? undefined : value,
    z.string().transform(value => value.split(',').map(entry => entry.trim()).filter(Boolean))
      .refine(list => list.every(isIpOrCidr), { message: 'Use comma-separated IP addresses or CIDR ranges' })
      .optional(),
  ),
  API_KEY_PREFIX: z.string().default('shapi_'),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
  API_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  METRICS_TOKEN: z.preprocess(value => value === '' ? undefined : value, z.string().min(16).optional()),
  // Self-serve sign-up: 'invite' requires SHAPI_SIGNUP_INVITE_CODE (no code = closed),
  // 'open' lets anyone create a workspace, 'closed' disables sign-up.
  SHAPI_SIGNUP_MODE: z.enum(['closed', 'invite', 'open']).default('invite'),
  SHAPI_SIGNUP_INVITE_CODE: z.preprocess(value => value === '' ? undefined : value, z.string().min(8).optional()),
  // Where "Request an invite" submissions are emailed (needs Resend). List them
  // any time with `pnpm --filter @shapi/backend invites:list`.
  SHAPI_OPERATOR_EMAIL: z.preprocess(value => value === '' ? undefined : value, z.string().email().optional()),
  // Public contact address shown on the Terms and Privacy pages (and in GET /trust).
  // Separate from SHAPI_OPERATOR_EMAIL on purpose: that one stays private.
  SHAPI_CONTACT_EMAIL: z.preprocess(value => value === '' ? undefined : value, z.string().email().optional()),
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
  // Dead-man's switch: GET this URL every minute while SHAPI's own pipeline is healthy
  // (healthchecks.io, Better Stack, Uptime Kuma push monitor...). When pings stop, that
  // service alerts you, even if the whole process is down.
  SHAPI_HEARTBEAT_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  ALERT_WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // Email alerts via Resend (https://resend.com). Both must be set for email destinations to send.
  RESEND_API_KEY: z.preprocess(value => value === '' ? undefined : value, z.string().optional()),
  ALERT_EMAIL_FROM: z.preprocess(value => value === '' ? undefined : value, z.string().optional()),
  // Frontend URLs
  DASHBOARD_URL: z.string().url().default('http://localhost:5174'),
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

for (const warning of productionConfigWarnings(parsed.data)) console.warn(`⚠️  ${warning}`);

export const config = parsed.data;

/** Hosted mode: outcome checks may only reach databases on public addresses. */
export function blockPrivateDatabaseHosts(): boolean {
  return config.SHAPI_BLOCK_PRIVATE_DATABASE_HOSTS ?? config.NODE_ENV === 'production';
}
