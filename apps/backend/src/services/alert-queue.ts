// Lightweight entry point for queueing incident alerts from incident code
// paths. The alert module (config, secrets, providers) loads on first use, and
// failures are swallowed: alerting must never break incident handling.
import type { AlertEvent } from './alerts-core.js';

export async function queueIncidentAlert(incidentId: string, event: AlertEvent = 'detected'): Promise<void> {
  try {
    const { enqueueIncidentAlert } = await import('./alerts.js');
    await enqueueIncidentAlert(incidentId, event);
  } catch {
    // enqueueIncidentAlert already logs its own failures.
  }
}
