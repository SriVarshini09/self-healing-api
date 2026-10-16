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
  /** Checks that fail on the unmodified kit for a documented real reason (see Scenario.knownIssue). */
  knownIssueFailures: string[];
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

/** The kit's `@/` imports and the Next.js stubs, for tsx to resolve while loading that kit. */
function writeKitTsconfig(kit: Kit): string {
  const path = join(benchDir, '.kits', `tsconfig.${kit.name}.json`);
  writeFileSync(path, JSON.stringify({
    extends: '../tsconfig.json',
    compilerOptions: {
      baseUrl: '..',
      paths: {
        '@/*': [`.kits/${kit.name}/*`],
        'next/server': ['stubs/next-server.ts'],
        'next/headers': ['stubs/next-headers.ts'],
        'next/navigation': ['stubs/next-navigation.ts'],
      },
    },
  }, null, 2));
  return path;
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
        env: { ...process.env, ...kit.env, [kit.databaseEnvVar]: url, TSX_TSCONFIG_PATH: writeKitTsconfig(kit) },
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

    // Scenarios with a documented real issue are reported separately: they fail on the
    // unmodified kit too, so they say nothing about an injected bug.
    const known = new Set(kit.scenarios.filter(scenario => scenario.knownIssue).flatMap(scenario => scenario.events.map(event => event.id)));
    const counted = deliveries.filter(delivery => !known.has(delivery.eventId));
    return {
      kit: kit.name,
      variant,
      title,
      expected,
      knownIssueFailures: checks.filter(check => known.has(check.eventId) && !check.matched).map(check => `${check.checkId}@${check.eventId}`),
      deliveries: counted,
      allDeliveries2xx: counted.every(delivery => delivery.status >= 200 && delivery.status < 300),
      checks: checks.filter(check => !known.has(check.eventId)),
      failedChecks: checks.filter(check => !known.has(check.eventId) && !check.matched).map(check => `${check.checkId}@${check.eventId}`),
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
    const issues = kit.scenarios.filter(scenario => scenario.knownIssue && baseline.knownIssueFailures.some(failure => scenario.events.some(event => failure.endsWith(`@${event.id}`))));
    if (findings.length || issues.length) {
      lines.push('', '### Found in the unmodified kit', '');
      for (const probe of findings) lines.push(`- **${probe.id}**: ${probe.finding}`);
      for (const scenario of issues) lines.push(`- **${scenario.id}**: ${scenario.knownIssue}`);
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
const mustDetect = new Set(KITS.flatMap(kit => kit.mustDetect.map(id => `${kit.name}/${id}`)));
const regressions = results.filter(result => mustDetect.has(`${result.kit}/${result.variant}`) && result.failedChecks.length === 0);
// A documented real issue must keep reproducing, or the write-up is stale.
const staleIssues = KITS.flatMap(kit => kit.scenarios.filter(scenario => scenario.knownIssue)
  .filter(scenario => !results.find(result => result.kit === kit.name && result.expected === 'baseline')!.knownIssueFailures.some(failure => scenario.events.some(event => failure.endsWith(`@${event.id}`))))
  .map(scenario => `${kit.name}/${scenario.id}`));
if (staleIssues.length) {
  console.error(`\nFAIL: documented issue no longer reproduces: ${staleIssues.join(', ')}`);
  process.exitCode = 1;
}
if (falsePositives.length || regressions.length) {
  console.error(`\nFAIL: ${falsePositives.length} false positive(s), ${regressions.length} detection regression(s)`);
  process.exitCode = 1;
}
