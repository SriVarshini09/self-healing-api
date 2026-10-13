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
  /** Kit-relative path of the webhook route module exporting POST(request). */
  routeFile: string;
  /** Kit-relative SQL files that create the schema. */
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
