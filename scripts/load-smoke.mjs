import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readEnv(path) {
  const values = {};
  if (!fs.existsSync(path)) return values;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^"|"$/gu, '').replace(/^'|'$/gu, '');
  }
  return values;
}

const baseUrl = option('--url', 'http://localhost:3001').replace(/\/$/u, '');
const envFile = option('--env-file', '.env');
const total = Number(option('--requests', '100'));
const concurrency = Number(option('--concurrency', '20'));
const apiKey = readEnv(envFile).SHAPI_API_KEY;

if (!apiKey) throw new Error(`SHAPI_API_KEY was not found in ${envFile}`);
if (!Number.isInteger(total) || total < 1) throw new Error('--requests must be a positive integer');
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('--concurrency must be a positive integer');

const results = [];
let next = 0;
const startedAt = performance.now();

async function worker() {
  while (true) {
    const index = next++;
    if (index >= total) return;
    const requestStartedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}/api/v1/alerts/status`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      await response.arrayBuffer();
      results.push({ status: response.status, latencyMs: performance.now() - requestStartedAt });
    } catch (error) {
      results.push({ status: 0, latencyMs: performance.now() - requestStartedAt, error: String(error) });
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

const elapsedMs = performance.now() - startedAt;
const latencies = results.map(result => result.latencyMs).sort((a, b) => a - b);
const percentile = fraction => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))];
const statusCounts = Object.fromEntries(
  [...new Set(results.map(result => result.status))].sort((a, b) => a - b).map(status => [status, results.filter(result => result.status === status).length]),
);
const failures = results.filter(result => result.status < 200 || result.status >= 300);

console.log(`Load smoke: ${total} requests, concurrency ${Math.min(concurrency, total)}, ${elapsedMs.toFixed(0)}ms total`);
console.log(`Throughput: ${(total / (elapsedMs / 1000)).toFixed(1)} req/s`);
console.log(`Latency: p50=${percentile(0.5).toFixed(1)}ms p95=${percentile(0.95).toFixed(1)}ms max=${latencies.at(-1).toFixed(1)}ms`);
console.log(`HTTP statuses: ${JSON.stringify(statusCounts)}`);

if (failures.length > 0) {
  throw new Error(`${failures.length} requests failed; first result: ${JSON.stringify(failures[0])}`);
}

console.log('Load smoke passed.');
