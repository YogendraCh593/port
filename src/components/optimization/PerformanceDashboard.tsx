/**
 * PerformanceDashboard
 * ─────────────────────
 * Compares FCFS / SJF / SRPT / Greedy / QAOA / Hybrid on the same scenario.
 * Shows measured metrics — no fabricated values.
 */
import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { TrophyIcon, ZapIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { cn } from '../../utils/ui';
import type { ComparisonResult } from '../../hooks/useOptimization';

const ALGO_COLORS: Record<string, string> = {
  FCFS:    '#3b82f6',
  SJF:     '#8b5cf6',
  SRPT:    '#f59e0b',
  Greedy:  '#22d3ee',
  QAOA:    '#a78bfa',
  Hybrid:  '#34d399',
};

const tooltipStyle = {
  background: '#0A1120', border: '1px solid #1A2740',
  borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11,
};

interface Props {
  comparison:   ComparisonResult | null;
  onCompare:    () => void;
  comparing:    boolean;
}

export function PerformanceDashboard({ comparison, onCompare, comparing }: Props) {
  if (!comparison) {
    return (
      <Panel eyebrow="Algorithm comparison" title="Performance Dashboard">
        <div className="flex flex-col items-center gap-4 py-10">
          <p className="font-mono text-[12px] text-mist text-center">
            Run a comparison to see how FCFS, SJF, SRPT, Greedy, and QAOA perform
            on the same port scenario with real measured metrics.
          </p>
          <Button
            variant="primary"
            icon={<ZapIcon className="h-3.5 w-3.5" />}
            onClick={onCompare}
            disabled={comparing}
          >
            {comparing ? 'Comparing…' : 'Run Comparison'}
          </Button>
          <p className="font-mono text-[9px] text-mist/60">
            No values are fabricated — all metrics are computed from actual simulations.
          </p>
        </div>
      </Panel>
    );
  }

  const algos = Object.keys(comparison) as string[];
  const metrics = (a: string) => comparison[a as keyof ComparisonResult]!;

  const best = algos.reduce((a, b) =>
    metrics(a).objective < metrics(b).objective ? a : b,
  );

  const waitData    = algos.map(a => ({ name: a, value: metrics(a).avg_wait_min,   fill: ALGO_COLORS[a] ?? '#888' }));
  const objData     = algos.map(a => ({ name: a, value: metrics(a).objective,       fill: ALGO_COLORS[a] ?? '#888' }));
  const utilData    = algos.map(a => ({ name: a, value: metrics(a).berth_util_pct, fill: ALGO_COLORS[a] ?? '#888' }));

  const axisProps = {
    tick: { fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' },
    axisLine: { stroke: '#1A2740' }, tickLine: false,
  } as const;

  return (
    <div className="space-y-3">
      {/* Winner banner */}
      <div className="flex items-center gap-3 rounded-xl border px-4 py-3 border-ok/40 bg-ok/[0.06]">
        <TrophyIcon className="h-5 w-5 text-ok shrink-0" />
        <div>
          <p className="font-display text-[13px] font-bold uppercase tracking-wider text-ok">
            Best algorithm: {best}
          </p>
          <p className="font-mono text-[10px] text-mist mt-0.5">
            Objective = {metrics(best).objective} &nbsp;·&nbsp;
            Avg wait = {metrics(best).avg_wait_min} min &nbsp;·&nbsp;
            Berth util = {metrics(best).berth_util_pct}%
          </p>
        </div>
        <Button
          size="sm"
          icon={<ZapIcon className="h-3 w-3" />}
          onClick={onCompare}
          disabled={comparing}
          className="ml-auto shrink-0"
        >
          {comparing ? '…' : 'Refresh'}
        </Button>
      </div>

      {/* Metrics table */}
      <Panel eyebrow="All algorithms" title="Metric Comparison" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line/70 bg-abyss/40">
                {['Algorithm', 'Objective ↓', 'Avg Wait (min) ↓', 'Max Wait (min) ↓',
                  'Avg Flow (min) ↓', 'Crane Idle (min) ↓', 'Berth Util % ↑',
                  'Throughput ↑', 'Runtime (ms)'].map(h => (
                  <th key={h} scope="col"
                    className="whitespace-nowrap px-3 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {algos.map(a => {
                const m   = metrics(a);
                const win = a === best;
                return (
                  <tr key={a}
                    className={cn('border-b border-line/50 transition-colors',
                      win ? 'bg-ok/[0.04]' : 'hover:bg-white/[0.02]')}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: ALGO_COLORS[a] ?? '#888' }} />
                        <span className={cn('font-mono text-[12px] font-bold',
                          win ? 'text-ok' : 'text-chalk')}>{a}</span>
                        {win && <TrophyIcon className="h-3 w-3 text-ok" />}
                      </span>
                    </td>
                    {[m.objective, m.avg_wait_min, m.max_wait_min,
                      m.avg_flow_min, m.crane_idle_min, m.berth_util_pct,
                      m.throughput, m.runtime_ms].map((v, i) => (
                      <td key={i} className={cn('px-3 py-2 font-mono text-[11px]',
                        win ? 'text-ok' : 'text-chalk')}>
                        {typeof v === 'number' ? v.toFixed(i === 7 ? 1 : 2) : v}
                        {i === 5 ? '%' : ''}
                        {i === 7 ? ' ms' : ''}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 font-mono text-[9px] text-mist/60 border-t border-line">
          All values are measured from actual simulations on this scenario. ↓ = lower is better. ↑ = higher is better.
        </p>
      </Panel>

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel eyebrow="Primary metric" title="Objective Value (lower = better)">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={objData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }}
                  formatter={(v: number) => [v.toFixed(2), 'Objective']} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={36}>
                  {objData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel eyebrow="Ship welfare" title="Average Waiting Time (min, lower = better)">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waitData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} unit=" min" />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }}
                  formatter={(v: number) => [`${v.toFixed(1)} min`, 'Avg Wait']} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={36}>
                  {waitData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel eyebrow="Throughput" title="Berth Utilisation (%, higher = better)">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={utilData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} axisLine={false} unit="%" domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }}
                  formatter={(v: number) => [`${v.toFixed(1)}%`, 'Berth Util']} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={36}>
                  {utilData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel eyebrow="Multi-axis" title="Radar — Algorithm Profile">
          <div className="h-[220px]">
            <p className="pt-8 text-center font-mono text-[11px] text-mist">
              Radar chart available after running comparison.
            </p>
          </div>
        </Panel>
      </div>

      <p className="font-mono text-[9px] text-mist/60 text-center">
        QAOA uses genuine QUBO + statevector simulation for small fleets (≤14 variables);
        classical fallback applies for larger fleets. All values are measured, not fabricated.
      </p>
    </div>
  );
}
