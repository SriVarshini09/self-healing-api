export interface Mutation {
  id: string;
  title: string;
  /** silent: every webhook still returns 2xx. loud: the handler returns an error status. */
  expected: 'silent' | 'loud';
  /** The real-world bug this models. */
  modeledOn: string;
  file: string;
  before: string;
  after: string;
}

/** What a customer would configure in SHAPI: an outcome query per trigger event. */
export interface OutcomeCheckDef {
  id: string;
  name: string;
  triggerEventType: string;
  sql: string;
  paramBindings: Record<string, string>;
}

export interface Scenario {
  id: string;
  description: string;
  seedSql: string[];
  events: StripeEventFixture[];
  /**
   * Set when the unmodified kit is expected to fail this scenario for a real,
   * documented reason (not a SHAPI false positive). Its failures are reported as
   * findings instead of failing the baseline.
   */
  knownIssue?: string;
}

export interface StripeEventFixture {
  id: string;
  object: 'event';
  type: string;
  created: number;
  livemode: false;
  api_version: string;
  pending_webhooks: number;
  request: { id: null; idempotency_key: null };
  data: { object: Record<string, unknown> };
}

/** A direct database probe for bugs outside what an outcome check expresses. */
export interface Probe {
  id: string;
  description: string;
  sql: string;
  /** Returns a finding message when the probe shows a bug, otherwise null. */
  evaluate: (rows: Record<string, unknown>[]) => string | null;
}

export interface Kit {
  name: string;
  repo: string;
  commit: string;
  license: string;
  /** Silent bugs that must stay detected; a regression fails CI. */
  mustDetect: string[];
  /** Runs after the pinned commit is checked out (e.g. generate an ORM client). */
  prepare?: (kitDir: string) => void;
  /**
   * Stripe API objects the kit's handler fetches by id (e.g. subscriptions.retrieve).
   * Served by an in-process fake so no network or real key is involved.
   */
  stripeApi?: { subscriptions?: Record<string, Record<string, unknown>> };
  /** Kit-relative path of the webhook route module exporting POST(request). */
  routeFile: string;
  /** Kit-relative SQL files that create the schema (applied in order). */
  schemaFiles: string[];
  /** Env the kit reads at import time (the database URL is added by the harness). */
  env: Record<string, string>;
  databaseEnvVar: string;
  webhookSecret: string;
  scenarios: Scenario[];
  checks: OutcomeCheckDef[];
  probes: Probe[];
  mutations: Mutation[];
}
