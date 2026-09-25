// @shapi/sdk - instrumentation SDK for behavioral tracking
// Framework-agnostic. Sends tracked events + business outcomes to SHAPI backend.

export interface ShapiConfig {
  apiKey: string;
  apiUrl?: string;
  environment?: 'development' | 'staging' | 'production';
}

export interface TrackOptions {
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export class Shapi {
  private apiUrl: string;
  private apiKey: string;
  private environment: string;

  constructor(cfg: ShapiConfig) {
    if (!cfg.apiKey) throw new Error('Shapi: apiKey required');
    this.apiKey = cfg.apiKey;
    this.apiUrl = (cfg.apiUrl ?? 'http://localhost:3001').replace(/\/$/, '');
    this.environment = cfg.environment ?? 'development';
  }

  async track(
    integration: string,
    type: string,
    payload: Record<string, unknown>,
    opts: TrackOptions = {},
  ): Promise<{ ok: boolean; status: number }> {
    const body = {
      eventId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      integration,
      type,
      payload,
      timestamp: new Date().toISOString(),
      correlationId: opts.correlationId,
      metadata: { ...(opts.metadata ?? {}), environment: this.environment },
    };
    const res = await fetch(`${this.apiUrl}/api/v1/sdk/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  }

  // Express middleware helper: wraps a webhook handler and reports business outcome
  webhookReporter(integration: string) {
    return async (
      eventType: string,
      payload: Record<string, unknown>,
      businessOutcome: () => Promise<{ success: boolean; details?: unknown }>,
    ) => {
      const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // Telemetry must never break business logic: swallow track failures.
      const safeTrack = (t: string, p: Record<string, unknown>) =>
        this.track(integration, t, p, { correlationId }).catch(() => undefined);
      await safeTrack(eventType, payload);
      try {
        const outcome = await businessOutcome();
        await safeTrack(
          outcome.success ? 'provisioning.completed' : 'provisioning.failed',
          { ...(payload as object), outcome: outcome.details ?? null } as Record<string, unknown>,
        );
        return outcome;
      } catch (e) {
        await safeTrack(
          'provisioning.failed',
          { ...(payload as object), error: e instanceof Error ? e.message : String(e) } as Record<string, unknown>,
        );
        throw e;
      }
    };
  }
}

export function createClient(cfg: ShapiConfig): Shapi {
  return new Shapi(cfg);
}
