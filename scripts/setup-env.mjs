// Local-dev helper: creates .env from .env.example if missing and mirrors it to
// apps/backend/.env, because Prisma only reads .env from the backend directory.
// Never overwrites an existing file. Safe to re-run.
import { copyFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const example = new URL('.env.example', root);
const rootEnv = new URL('.env', root);
const backendEnv = new URL('apps/backend/.env', root);

if (!existsSync(rootEnv)) {
  copyFileSync(example, rootEnv);
  console.log('created .env from .env.example');
}
if (!existsSync(backendEnv)) {
  copyFileSync(rootEnv, backendEnv);
  console.log('created apps/backend/.env (copy of .env)');
}
console.log('env ready. Edit .env, then re-copy to apps/backend/.env if you change DATABASE_URL.');
