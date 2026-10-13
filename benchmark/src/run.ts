// Detection benchmark.
//
// For each kit: run the original handler and each injected bug ("mutant")
// against a fresh Postgres database, then ask SHAPI's outcome checks whether
// each customer ended up in the right state. A mutant counts as detected when
// at least one outcome check fails for it while every check passes on the
// original. Detection uses SHAPI's real outcome-check code.
//
// Usage: BENCH_DATABASE_URL=postgresql://user:pass@host:5432/db pnpm bench
// (the role must be allowed to CREATE DATABASE)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
// The package compiles to CommonJS; take its exports off the module object.
import outcomeChecks from '../../packages/outcome-checks/src/index.js';
import { KITS } from './kits/index.js';
import type { Kit, Mutation } from './kits/types.js';

const { bindParams, runOutcomeQuery, sqlParamNames, validateBindings, validateOutcomeSql } = outcomeChecks;

const adminUrl = process.env.BENCH_DATABASE_URL ?? 'postgresql://shapi:shapi@127.0.0.1:5432/shapi';
const benchDir = join(import.meta.dirname, '..');

interface CheckResult { checkId: string; eventId: string; matched: boolean; error?: string }
interface VariantResult {
  kit: string;
  variant: string;
  title: string;
  expected: 'baseline' | 'silent' | 'loud';
  deliveries: Array<{ eventId: string; status: number; error?: string }>;
  allDeliveries2xx: boolean;
  checks: CheckResult[];
  failedChecks: string[];
  probes: Array<{ id: string; finding: string | null }>;
}

function databaseUrl(name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.search = '';
  return url.toString();
}

function applyMutation(kitDir: string, mutation: Mutation): () => void {
  const path = join(kitDir, mutation.file);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(mutation.before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${mutation.id}: expected exactly 1 match in ${mutation.file}, found ${occurrences}`);
  }
  writeFileSync(path, original.replace(mutation.before, mutation.after));
  return () => writeFileSync(path, original);
}

async function runVariant(kit: Kit, variant: string, title: string, expected: VariantResult['expected']): Promise<VariantResult> {
  const kitDir = join(benchDir, '.kits', kit.name);
  const dbName = `shapi_bench_${kit.name}_${variant}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60);
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url = databaseUrl(dbName);

  try {
    const db = postgres(url, { max: 1, onnotice: () => undefined });
    for (const file of kit.schemaFiles) await db.unsafe(readFileSync(join(kitDir, file), 'utf8'));
    for (const scenario of kit.scenarios) for (const statement of scenario.seedSql) await db.unsafe(statement);
    await db.end();

    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', join(benchDir, 'src', 'variant.ts'), kit.name],
      {
        cwd: benchDir,
        env: { ...process.env, ...kit.env, [kit.databaseEnvVar]: url, TSX_TSCONFIG_PATH: join(benchDir, 'tsconfig.json') },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      },
    ).toString();
    const line = output.split('\n').find(candidate => candidate.startsWith('__RESULT__'));
    if (!line) throw new Error(`variant ${variant} produced no result:\n${output}`);
    const { deliveries } = JSON.parse(line.slice('__RESULT__'.length)) as Pick<VariantResult, 'deliveries'>;

    // SHAPI outcome checks, exactly as the product evaluates them.
    const checks: CheckResult[] = [];
    for (const scenario of kit.scenarios) {
      for (const event of scenario.events) {
        for (const check of kit.checks.filter(candidate => candidate.triggerEventType === event.type)) {
          const sql = validateOutcomeSql(check.sql);
          const names = sqlParamNames(sql);
          validateBindings(names, check.paramBindings);
          try {
            const result = await runOutcomeQuery({ connectionString: url, sql, params: bindParams(names, check.paramBindings, event) });
            checks.push({ checkId: check.id, eventId: event.id, matched: result.matched });
          } catch (error) {
            checks.push({ checkId: check.id, eventId: event.id, matched: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    }

    const probeDb = postgres(url, { max: 1, onnotice: () => undefined });
    const probes = [];
    for (const probe of kit.probes) {
      probes.push({ id: probe.id, finding: probe.evaluate(await probeDb.unsafe(probe.sql) as Record<string, unknown>[]) });
    }
    await probeDb.end();

    return {
      kit: kit.name,
      variant,
      title,
      expected,
      deliveries,
      allDeliveries2xx: deliveries.every(delivery => delivery.status >= 200 && delivery.status < 300),
      checks,
      failedChecks: checks.filter(check => !check.matched).map(check => `${check.checkId}@${check.eventId}`),
      probes,
    };
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
}

function summarize(results: VariantResult[]) {
  const lines: string[] = [];
  for (const kit of KITS) {
    const rows = results.filter(result => result.kit === kit.name);
    const baseline = rows.find(row => row.expected === 'baseline')!;
    const mutants = rows.filter(row => row.expected !== 'baseline');
    const silent = mutants.filter(row => row.allDeliveries2xx);
    const detected = mutants.filter(row => row.failedChecks.length > 0);
    const silentDetected = silent.filter(row => row.failedChecks.length > 0);

    lines.push(`## ${kit.repo} @ \`${kit.commit.slice(0, 12)}\` (${kit.license})`, '');
    lines.push(`- Baseline (unmodified kit): ${baseline.failedChecks.length === 0 ? 'all outcome checks pass (no false positives)' : `**${baseline.failedChecks.length} check(s) fail on the original**`}`);
    lines.push(`- Injected bugs: ${mutants.length}. Silent (every webhook still returned 2xx): ${silent.length}.`);
    lines.push(`- **Detected by outcome checks: ${detected.length}/${mutants.length}** (silent ones: ${silentDetected.length}/${silent.length}).`, '');
    lines.push('| Bug | Webhook responses | Outcome checks failed | Detected |', '|---|---|---|---|');
    for (const row of mutants) {
      const statuses = [...new Set(row.deliveries.map(delivery => delivery.status))].join(', ');
      lines.push(`| ${row.variant}: ${row.title} | ${statuses}${row.allDeliveries2xx ? ' (silent)' : ''} | ${row.failedChecks.length ? row.failedChecks.map(check => check.split('@')[0]).join(', ') : 'none'} | ${row.failedChecks.length ? 'yes' : '**no**'} |`);
    }
    const findings = baseline.probes.filter(probe => probe.finding);
    if (findings.length) {
      lines.push('', '### Found in the unmodified kit', '');
      for (const probe of findings) lines.push(`- **${probe.id}**: ${probe.finding}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const results: VariantResult[] = [];
for (const kit of KITS) {
  const kitDir = join(benchDir, '.kits', kit.name);
  console.log(`\n${kit.repo}`);
  const baseline = await runVariant(kit, 'original', 'Unmodified kit', 'baseline');
  results.push(baseline);
  console.log(`  original: ${baseline.failedChecks.length ? `FAILED ${baseline.failedChecks.join(', ')}` : 'all checks pass'}`);
  for (const mutation of kit.mutations) {
    const restore = applyMutation(kitDir, mutation);
    try {
      const result = await runVariant(kit, mutation.id, mutation.title, mutation.expected);
      results.push(result);
      console.log(`  ${mutation.id}: http=${[...new Set(result.deliveries.map(delivery => delivery.status))].join('/')} ${result.failedChecks.length ? `DETECTED (${result.failedChecks.join(', ')})` : 'not detected'}`);
    } finally {
      restore();
    }
  }
}

mkdirSync(join(benchDir, 'results'), { recursive: true });
writeFileSync(join(benchDir, 'results', 'latest.json'), JSON.stringify(results, null, 2));
const report = summarize(results);
writeFileSync(join(benchDir, 'results', 'latest.md'), report);
console.log(`\n${report}`);

// Guard rails for CI: a false positive on an unmodified kit, or a silent
// injected bug that stops being detected, fails the run.
const falsePositives = results.filter(result => result.expected === 'baseline' && result.failedChecks.length > 0);
const expectedDetections = new Set(['M1-drop-updated-case', 'M2-wrong-id-field', 'M3-status-filter', 'M4-inverted-guard',
  'M5-copy-paste-null', 'M6-cancel-keeps-subscription', 'M7-drop-deleted-case', 'M8-wrong-lookup-column', 'M10-renamed-secret-env']);
const regressions = results.filter(result => expectedDetections.has(result.variant) && result.failedChecks.length === 0);
if (falsePositives.length || regressions.length) {
  console.error(`\nFAIL: ${falsePositives.length} false positive(s), ${regressions.length} detection regression(s)`);
  process.exitCode = 1;
}
