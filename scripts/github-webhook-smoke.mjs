import crypto from 'node:crypto';
import fs from 'node:fs';

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function readEnvValue(path, name) {
  const line = fs.readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .find(value => value.startsWith(`${name}=`));
  if (!line) return null;
  return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
}

const apiUrl = (argument('--api-url', 'http://localhost:3001')).replace(/\/$/, '');
const envFile = argument('--env-file');
const secret = envFile
  ? readEnvValue(envFile, 'GITHUB_WEBHOOK_SECRET_APP')
  : process.env.GITHUB_WEBHOOK_SECRET_APP;
if (!secret) {
  throw new Error(envFile
    ? `GITHUB_WEBHOOK_SECRET_APP was not found in ${envFile}`
    : 'GITHUB_WEBHOOK_SECRET_APP is not set');
}

const delivery = crypto.randomUUID();
const body = JSON.stringify({ zen: 'SHAPI signed webhook smoke', hook_id: 0 });
const signature = `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex')}`;
const headers = {
  'content-type': 'application/json',
  'user-agent': 'SHAPI-webhook-smoke',
  'x-github-event': 'ping',
  'x-github-delivery': delivery,
  'x-hub-signature-256': signature,
};

async function sendDelivery() {
  const response = await fetch(`${apiUrl}/api/v1/github/webhook`, {
    method: 'POST',
    headers,
    body: Buffer.from(body, 'utf8'),
  });
  return { status: response.status, payload: await response.json() };
}

const first = await sendDelivery();
if (first.status !== 200) {
  throw new Error(`FAIL signed GitHub webhook: expected HTTP 200, received HTTP ${first.status}: ${JSON.stringify(first.payload)}`);
}
if (first.payload.received !== true || first.payload.duplicate === true) {
  throw new Error('FAIL signed GitHub webhook: first delivery was not accepted as new');
}
console.log(`PASS signed GitHub webhook (HTTP 200, delivery ${delivery})`);

const second = await sendDelivery();
if (second.status !== 200) {
  throw new Error(`FAIL GitHub webhook deduplication: expected HTTP 200, received HTTP ${second.status}: ${JSON.stringify(second.payload)}`);
}
if (second.payload.duplicate !== true) {
  throw new Error('FAIL GitHub webhook deduplication: repeated delivery was processed again');
}
console.log('PASS GitHub webhook deduplication (repeat acknowledged as duplicate)');
console.log('GitHub webhook smoke check passed.');
