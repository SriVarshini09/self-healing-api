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
const durationSeconds = Number(option('--duration-seconds', '30'));
const concurrency = Number(option('--concurrency', '20'));
const timeoutMs = Number(option('--timeout-ms', '10000'));
const maxErrorRate = Number(option('--max-error-rate', '0'));
const delayMs = Number(option('--delay-ms', '0'));
const apiKey = readEnv(envFile).SHAPI_API_KEY;

if (!apiKey) throw new Error(`SHAPI_API_KEY was not found in ${envFile}`);
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600) {
  throw new Error('--duration-seconds must be greater than 0 and at most 3600');
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1000) {
  throw new Error('--concurrency must be an integer from 1 to 1000');
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('--timeout-ms must be a positive integer');
if (!Number.isFinite(maxErrorRate) || maxErrorRate < 0 || maxErrorRate > 1) {
  throw new Error('--max-error-rate must be between 0 and 1');
}
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
  throw new Error('--delay-ms must be an integer from 0 to 60000');
}

const results = [];
const deadline = performance.now() + durationSeconds * 1000;
const startedAt = performance.now();

async function worker() {
  while (performance.now() < deadline) {
    const requestStartedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}/api/v1/alerts/status`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.arrayBuffer();
      results.push({ status: response.status, latencyMs: performance.now() - requestStartedAt });
    } catch (error) {
      results.push({ status: 0, latencyMs: performance.now() - requestStartedAt, error: String(error) });
    }
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const elapsedMs = performance.now() - startedAt;
const latencies = results.map(result => result.latencyMs).sort((a, b) => a - b);
const total = results.length;
const percentile = fraction => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))];
const statusCounts = Object.fromEntries(
  [...new Set(results.map(result => result.status))]
    .sort((a, b) => a - b)
    .map(status => [status, results.filter(result => result.status === status).length]),
);
const failures = results.filter(result => result.status < 200 || result.status >= 300);
const errorRate = total === 0 ? 1 : failures.length / total;

console.log(`Capacity smoke: ${durationSeconds}s target, ${total} requests, concurrency ${concurrency}`);
console.log(`Throughput: ${(total / (elapsedMs / 1000)).toFixed(1)} req/s`);
console.log(`Latency: p50=${percentile(0.5)?.toFixed(1) ?? 'n/a'}ms p95=${percentile(0.95)?.toFixed(1) ?? 'n/a'}ms max=${latencies.at(-1)?.toFixed(1) ?? 'n/a'}ms`);
console.log(`HTTP statuses: ${JSON.stringify(statusCounts)}`);
console.log(`Error rate: ${(errorRate * 100).toFixed(3)}% (limit ${(maxErrorRate * 100).toFixed(3)}%)`);

if (total === 0) throw new Error('Capacity smoke produced no requests');
if (errorRate > maxErrorRate) {
  throw new Error(`${failures.length}/${total} requests failed; first result: ${JSON.stringify(failures[0])}`);
}

console.log('Capacity smoke passed.');
