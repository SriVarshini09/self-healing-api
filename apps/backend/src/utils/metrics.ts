import { timingSafeEqual } from 'node:crypto';

type Labels = Record<string, string | number>;

const counters = new Map<string, { name: string; labels: Labels; value: number }>();

function labelKey(labels: Labels): string {
  return Object.keys(labels).sort().map(key => `${key}=${labels[key]}`).join('|');
}

const gauges = new Map<string, { name: string; labels: Labels; value: number }>();

export function setGauge(name: string, value: number, labels: Labels = {}): void {
  gauges.set(`${name}|${labelKey(labels)}`, { name, labels, value });
}

export function incrementCounter(name: string, labels: Labels = {}): void {
  const key = `${name}|${labelKey(labels)}`;
  const current = counters.get(key);
  if (current) {
    current.value++;
  } else {
    counters.set(key, { name, labels, value: 1 });
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function renderPrometheus(): string {
  const lines = [
    '# HELP shapi_http_requests_total Total HTTP responses returned by the backend.',
    '# TYPE shapi_http_requests_total counter',
  ];
  for (const metric of counters.values()) {
    const labels = Object.entries(metric.labels)
      .map(([key, value]) => `${key}="${escapeLabel(String(value))}"`)
      .join(',');
    lines.push(`${metric.name}${labels ? `{${labels}}` : ''} ${metric.value}`);
  }
  const seen = new Set<string>();
  for (const metric of gauges.values()) {
    if (!seen.has(metric.name)) {
      seen.add(metric.name);
      lines.push(`# TYPE ${metric.name} gauge`);
    }
    const labels = Object.entries(metric.labels).map(([key, value]) => `${key}="${escapeLabel(String(value))}"`).join(',');
    lines.push(`${metric.name}${labels ? `{${labels}}` : ''} ${metric.value}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Compare tokens without exposing their contents through a plain equality check. */
export function isMetricsTokenValid(provided: string | undefined, configured: string | undefined): boolean {
  if (!provided || !configured) return false;
  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configured);
  return providedBuffer.length === configuredBuffer.length
    && timingSafeEqual(providedBuffer, configuredBuffer);
}
