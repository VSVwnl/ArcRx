import type { ReactNode } from 'react';
import { Bar, BarChart, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Assessment } from '../lib/api';

export const STATUS_STYLE: Record<Assessment['status'], { bg: string; fg: string }> = {
  on_track: { bg: 'rgba(79,209,197,0.14)', fg: '#4FD1C5' },
  ready_to_progress: { bg: 'rgba(79,209,197,0.22)', fg: '#7FE7DD' },
  plateau: { bg: 'rgba(245,185,66,0.16)', fg: '#F5B942' },
  regression: { bg: 'rgba(240,99,107,0.18)', fg: '#F0636B' },
  non_adherent: { bg: 'rgba(167,139,250,0.18)', fg: '#A78BFA' },
  no_data: { bg: 'rgba(138,150,179,0.18)', fg: '#8A96B3' },
};

export function StatusPill({ status, label }: { status: Assessment['status']; label: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: s.bg, color: s.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.fg }} />
      {label}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  const c = severity === 'high' ? '#F0636B' : severity === 'medium' ? '#F5B942' : '#A78BFA';
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} title={severity} />;
}

export function Sparkline({ values, target, width = 110, height = 28 }: { values: number[]; target?: number; width?: number; height?: number }) {
  if (!values.length) return <svg width={width} height={height} />;
  const all = target ? [...values, target] : values;
  const min = Math.min(...all) - 2;
  const max = Math.max(...all) + 2;
  const x = (i: number) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 4) + 2);
  const y = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} aria-hidden>
      {target != null && <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke="#4FD1C5" strokeDasharray="3 3" strokeWidth={1} opacity={0.7} />}
      <path d={d} fill="none" stroke="#F5B942" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.2} fill="#F5B942" />
    </svg>
  );
}

export function Stat({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: 'amber' | 'teal' | 'coral' | 'violet' }) {
  const color = tone === 'amber' ? '#F5B942' : tone === 'teal' ? '#4FD1C5' : tone === 'coral' ? '#F0636B' : tone === 'violet' ? '#A78BFA' : '#EEF2FF';
  return (
    <div className="panel px-4 py-3">
      <div className="text-xs text-mute">{label}</div>
      <div className="numeral mt-1 text-2xl font-semibold" style={{ color }}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-mute">{unit}</span>}
      </div>
    </div>
  );
}

export function Section({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function DataTable({ columns, rows }: { columns: string[]; rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <p className="text-sm text-mute">No rows.</p>;
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-ink-700">
      <table className="data">
        <thead><tr>{columns.map((c) => <th key={c}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c}>{fmtCell(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtCell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const tooltipStyle = { background: '#18233B', border: '1px solid #334467', borderRadius: 8, fontSize: 12, color: '#EEF2FF' };

export function MiniBars({ data, color = '#F5B942', height = 160 }: { data: Array<{ label: string; value: number }>; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(238,242,255,0.05)' }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MiniLine({ data, color = '#F5B942', height = 160 }: { data: Array<{ label: string; value: number }>; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 2.5, fill: color }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-mute">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-600 border-t-amber" />
      {label}
    </div>
  );
}

export function timeAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
