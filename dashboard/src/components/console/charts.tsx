// Small, dependency-free SVG charts following the dataviz mark specs:
// 2px lines with a ~10% area wash, <=24px columns with 4px rounded tops and a
// 2px surface gap between stacked segments, hairline grid, hover tooltips.
import { useEffect, useRef, useState, type ReactNode } from 'react';

// Validated as a pair (light surface #ffffff): CVD dE 22.4, normal dE 28.2, both >= 3:1.
export const SERIES = { verified: '#5b7be0', failed: '#e0694f' };
const ACCENT = '#4a63d8';
const MUTED_LINE = '#b9c1d6';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 12-ish point trend line for a stat tile: muted history, accent end point. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 36;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - 8) / (values.length - 1) : 0;
  const points = values.map((value, index) => [4 + index * step, height - 4 - (value / max) * (height - 10)] as const);
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <div ref={ref} className="c-spark" role="img" aria-label={label}>
      {width > 0 && values.length > 1 && (
        <svg width={width} height={height}>
          <path d={`${line} L${last[0]},${height} L${points[0][0]},${height} Z`} fill={ACCENT} opacity={0.08} />
          <path d={line} fill="none" stroke={MUTED_LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last[0]} cy={last[1]} r={4} fill={ACCENT} stroke="#ffffff" strokeWidth={2} />
        </svg>
      )}
    </div>
  );
}

export interface DailyPoint { date: string; verified: number; failed: number }

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  for (const step of steps) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Stacked daily columns: verified (bottom) and failed outcomes. */
export function DailyOutcomes({ data }: { data: DailyPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const height = 190;
  const padding = { top: 10, right: 8, bottom: 26, left: 34 };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = height - padding.top - padding.bottom;
  const max = niceMax(Math.max(0, ...data.map(point => point.verified + point.failed)));
  const band = data.length ? plotWidth / data.length : 0;
  const barWidth = Math.min(24, Math.max(4, band * 0.6));
  const y = (value: number) => padding.top + plotHeight - (value / max) * plotHeight;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / 7);
  const total = data.reduce((sum, point) => sum + point.verified + point.failed, 0);

  // Column path with a 4px rounded top and a square base.
  const column = (x: number, top: number, bottom: number, rounded: boolean) => {
    const h = bottom - top;
    if (h <= 0) return '';
    const r = rounded ? Math.min(4, h, barWidth / 2) : 0;
    return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + barWidth - r} Q${x + barWidth},${top} ${x + barWidth},${top + r} V${bottom} Z`;
  };

  return (
    <div className="c-chart">
      <div className="c-chart-head">
        <div className="c-legend">
          <span><i style={{ background: SERIES.verified }} />Verified</span>
          <span><i style={{ background: SERIES.failed }} />Failed</span>
        </div>
        <button className="c-btn is-quiet c-small" onClick={() => setAsTable(value => !value)}>{asTable ? 'Chart' : 'Table'}</button>
      </div>
      {asTable ? (
        <div className="c-table-wrap">
          <table className="c-table c-num">
            <thead><tr><th>Day</th><th>Verified</th><th>Failed</th></tr></thead>
            <tbody>
              {[...data].reverse().map(point => (
                <tr key={point.date}><td>{shortDate(point.date)}</td><td>{point.verified}</td><td>{point.failed}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="c-chart-plot" onMouseLeave={() => setHover(null)}>
          {width > 0 && (
            <svg width={width} height={height} role="img" aria-label={`Daily outcomes, ${total} in range`}>
              {ticks.map(tick => (
                <g key={tick}>
                  <line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? '#d4d8e0' : '#eef0f4'} />
                  <text x={padding.left - 8} y={y(tick) + 4} textAnchor="end" className="c-axis">{Math.round(tick).toLocaleString()}</text>
                </g>
              ))}
              {data.map((point, index) => {
                const x = padding.left + index * band + (band - barWidth) / 2;
                const base = y(0);
                const verifiedTop = y(point.verified);
                const failedTop = y(point.verified + point.failed);
                const gap = point.verified > 0 && point.failed > 0 ? 2 : 0;
                return (
                  <g key={point.date}>
                    {hover === index && <rect x={padding.left + index * band} y={padding.top} width={band} height={plotHeight} fill="#f1f3f8" />}
                    <path d={column(x, verifiedTop, base, point.failed === 0)} fill={SERIES.verified} />
                    <path d={column(x, failedTop, verifiedTop - gap, true)} fill={SERIES.failed} />
                    {(data.length - 1 - index) % labelEvery === 0 && (
                      <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" className="c-axis">{shortDate(point.date)}</text>
                    )}
                    {/* Hit target: the whole day band, larger than the mark. */}
                    <rect
                      x={padding.left + index * band} y={padding.top} width={band} height={plotHeight + padding.bottom}
                      fill="transparent" onMouseEnter={() => setHover(index)}
                    />
                  </g>
                );
              })}
            </svg>
          )}
          {hover !== null && data[hover] && (
            <Tooltip x={padding.left + hover * band + band / 2} width={width}>
              <div className="c-strong">{shortDate(data[hover].date)}</div>
              <div className="c-tip-row"><i style={{ background: SERIES.verified }} />Verified<b>{data[hover].verified}</b></div>
              <div className="c-tip-row"><i style={{ background: SERIES.failed }} />Failed<b>{data[hover].failed}</b></div>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return <div className="c-tooltip" style={{ left }}>{children}</div>;
}
