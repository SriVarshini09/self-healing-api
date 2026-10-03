// @shapi/replay-engine - verify fix candidates against historical events
import { evaluatePredicate, type InvariantEvent } from '@shapi/invariant-engine';

export interface ReplayOutcome {
  passed: boolean;
  passRate: number;
  passedCount: number;
  total: number;
}

export function applyFixCandidate(
  payload: Record<string, unknown>,
  fix: string,
): Record<string, unknown> {
  const out = { ...payload };
  if (fix.startsWith('add_field:') || fix.startsWith('modify_field:')) {
    const [, field, ...rest] = fix.split(':');
    try {
      out[field] = JSON.parse(rest.join(':'));
    } catch {
      out[field] = rest.join(':');
    }
  } else if (fix.startsWith('remove_field:')) {
    delete out[fix.split(':')[1]];
  }
  return out;
}

export function replay(
  expression: string,
  events: InvariantEvent[],
  fixCandidate: string,
): ReplayOutcome {
  let passedCount = 0;
  for (const ev of events) {
    const fixed = {
      ...ev,
      payload: applyFixCandidate(ev.payload, fixCandidate),
    };
    if (evaluatePredicate(expression, fixed).passed) passedCount++;
  }
  const total = events.length;
  const passRate = total === 0 ? 1 : passedCount / total;
  return { passed: passRate >= 0.95, passRate, passedCount, total };
}
