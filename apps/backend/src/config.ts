import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load repo-root .env for local dev (apps/backend -> ../..)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  API_KEY_PREFIX: z.string().default('shapi_'),
  // Webhook verification
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  SENDGRID_WEBHOOK_SECRET: z.string().optional(),
  TWILIO_WEBHOOK_SECRET: z.string().optional(),
  // GitHub App
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET_APP: z.string().optional(),
  // Frontend URLs
  DASHBOARD_URL: z.string().url().default('http://localhost:5173'),
  DEMO_SAAS_URL: z.string().url().default('http://localhost:3000')
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;