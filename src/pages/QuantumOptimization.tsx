/**
 * QuantumOptimization
 * ────────────────────
 * Shows the full QUBO/QAOA pipeline — solver topology, telemetry,
 * convergence chart, comparison table and the backend schedule.
 *
 * Now wired to BOTH:
 *  • /optimize  +  /optimization/result  (legacy PortContext path)
 *  • /optimization/run  +  /optimization/compare-algorithms  (rolling-horizon engine)
 */
import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import { motion } from 'framer-motion';
import {
  ShipIcon, ScaleIcon, BinaryIcon, BrainCircuitIcon, LayoutGridIcon,
  ZapIcon, ArrowDownIcon, InfoIcon, CheckIcon, BarChart3Icon, RefreshCwIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { StatusDot } from '../components/ui/StatusDot';
import { DataRow } from '../components/ui/DataRow';
import { usePort } from '../contexts/PortContext';
import { useOptimization } from '../hooks/useOptimization';
import { fmtDuration, fmtNumber, fmtTime } from '../utils/geo';
import { cn } from '../utils/ui';
import { api } from '../services/api';
import type { OptimizationResult } from '../services/api';

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

export function QuantumOptimization() {
  const {
    optimization: localOpt, solving, runOptimization,
    vessels, berths, settings, kpis,
  } = usePort();

  // Rolling-horizon engine hook
  const {
    runOptimization: runHybrid, running,
    schedule: hybridSchedule, meta,
    comparison, compareAlgorithms, comparing,
    config,
  } = useOptimization();

  const [backendResult, setBackendResult] = useState<OptimizationResult | null>(null);
  const [fetching, setFetching] = useState(false);

  async function fetchBackendResult() {
    setFetching(true);
    try {
      const r = await api.getOptimizationResult();
      setBackendResult(r);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { fetchBackendResult(); }, []);

  const queue       = vessels.filter(v => v.status !== 'departing').length;
  const qvars       = backendResult?.qubo_variables ?? localOpt?.quboVariables ?? 0;
  const constraints = backendResult?.constraints    ?? localOpt?.constraints   ?? 0;
  const berthSchedule = (backendResult as any)?.berth_schedule as any[] | undefined;
  const assigned    = berthSchedule?.filter((r: any) => r.status === 'Allocated').length
    ?? localOpt?.assignments.length ?? 0;
  const isSolving   = solving || fetching || running;
  const traceData   = localOpt?.trace ?? [];

  // Comparison chart data
  const compAlgos   = comparison ? Object.keys(comparison) : [];
  const compObjData = compAlgos.map(a => ({
    name: a,
    value: (comparison as any)?.[a]?.objective ?? 0,
    fill: ALGO_COLORS[a] ?? '#888',
  }));
  const compWaitData = compAlgos.map(a => ({
    name: a,
    value: (comparison as any)?.[a]?.avg_wait_min ?? 0,
    fill: ALGO_COLORS[a] ?? '#888',
  }));

  const stages = [
    {
      key: 'input',
      label: 'Input Vessels',
      Icon: ShipIcon,
      metric: `${queue} vessels`,
      detail: 'ETA, LOA, draft, tonnage and spoilage windows ingested from the register',
    },
    {
      key: 'model',
      label: 'Constraint Model',
      Icon: ScaleIcon,
      metric: `${fmtNumber(constraints)} constraints`,
      detail: 'One-hot berth assignment, non-overlap per berth, LOA and draft feasibility',
    },
    {
      key: 'qubo',
      label: 'QUBO Formulation',
      Icon: BinaryIcon,
      metric: `${fmtNumber(qvars)} binary variables`,
      detail: `x[vessel,berth] + y[vessel,crane] — penalty weights: wait=${config.crane_rate_tpm} t/min, switch cost=${config.switch_cost}min`,
    },
    {
      key: 'solver',
      label: 'QAOA / Hybrid Solver',
      Icon: BrainCircuitIcon,
      metric: meta ? `obj=${meta.objective} · ${meta.runtime_s}s` : `${fmtNumber(settings.annealIterations)} iters`,
      detail: meta
        ? `Winner: ${meta.winner ?? meta.algo} · Mode: ${meta.mode ?? meta.algo}`
        : 'Genuine QAOA statevector (≤14 vars) + classical fallback for larger fleets',
    },
    {
      key: 'output',
      label: 'Optimal Schedule',
      Icon: LayoutGridIcon,
      metric: `${assigned} assignments`,
      detail: `Score ${localOpt?.score ?? 0}% · Objective ${meta?.objective ?? localOpt?.objectiveValue ?? 0}`,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Quantum + Hybrid Optimization Engine"
        title="Quantum Optimization"
        description="QUBO formulation → QAOA statevector simulation → classical comparison → best feasible schedule. Runs genuinely on the backend."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<RefreshCwIcon className={cn('h-3.5 w-3.5', fetching && 'animate-spin')} />}
              onClick={fetchBackendResult} disabled={fetching}>
              {fetching ? 'Fetching…' : 'Fetch Legacy Result'}
            </Button>
            <Button icon={<BarChart3Icon className="h-3.5 w-3.5" />}
              onClick={compareAlgorithms} disabled={comparing}>
              {comparing ? 'Comparing…' : 'Compare All Algorithms'}
            </Button>
            <Button variant="primary" icon={<ZapIcon className="h-3.5 w-3.5" />}
              onClick={async () => { await runHybrid(); await fetchBackendResult(); }}
              disabled={isSolving}>
              {isSolving ? 'Solving…' : 'Run Hybrid Solver'}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 xl:grid-cols-3">
        {/* Pipeline topology */}
        <Panel eyebrow="Processing pipeline" title="Solver Topology" className="xl:col-span-2">
          <ol className="space-y-1">
            {stages.map((stage, i) => (
              <li key={stage.key}>
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: i * 0.05, ease: [0.23, 1, 0.32, 1] }}
                  className={cn(
                    'relative flex items-start gap-3.5 overflow-hidden rounded-lg border p-3.5',
                    isSolving
                      ? 'border-quantum/45 bg-quantum/[0.07]'
                      : 'border-line bg-abyss/60',
                  )}
                >
                  <span className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-md border',
                    isSolving ? 'border-quantum/50 bg-quantum/12 text-quantum' : 'border-aqua/35 bg-aqua/10 text-aqua',
                  )}>
                    <stage.Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="font-display text-[12px] font-semibold uppercase tracking-wider text-chalk">
                        {stage.label}
                      </h3>
                      <span className={cn('font-mono text-[11px]', isSolving ? 'text-quantum' : 'text-aqua')}>
                        {stage.metric}
                      </span>
                      {!isSolving && (localOpt || meta) && (
                        <CheckIcon className="ml-auto h-3.5 w-3.5 text-ok" aria-hidden />
                      )}
                    </div>
                    <p className="mt-1 text-[12px] leading-snug text-mist">{stage.detail}</p>
                  </div>
                </motion.div>
                {i < stages.length - 1 && (
                  <div className="flex items-center gap-2 py-1 pl-[30px]">
                    <ArrowDownIcon className={cn('h-3.5 w-3.5', isSolving ? 'text-quantum' : 'text-edge')} aria-hidden />
                    <span className="h-px flex-1 bg-gradient-to-r from-edge/70 to-transparent" />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Panel>

        {/* Telemetry */}
        <div className="space-y-3">
          <Panel eyebrow="Engine state" title="Solver Telemetry">
            <p className={cn(
              'flex items-center gap-2 font-display text-2xl font-semibold',
              isSolving ? 'text-quantum' : (localOpt || meta) ? 'text-ok' : 'text-mist',
            )}>
              <StatusDot color={isSolving ? 'bg-quantum' : (localOpt || meta) ? 'bg-ok' : 'bg-mist'} />
              {isSolving ? 'SOLVING' : (localOpt || meta) ? 'COMPLETE' : 'IDLE'}
            </p>
            <dl className="mt-3">
              {meta && (
                <>
                  <DataRow label="Algorithm"     value={meta.algo} tone="text-aqua" />
                  <DataRow label="Winner"         value={meta.winner ?? meta.algo} tone="text-ok" />
                  <DataRow label="Objective"      value={fmtNumber(meta.objective, 4)} tone="text-quantum" />
                  <DataRow label="Runtime"        value={`${meta.runtime_s}s`} />
                  <DataRow label="Mode"           value={meta.mode ?? '—'} />
                </>
              )}
              <DataRow label="QUBO Variables"    value={fmtNumber(qvars)} />
              <DataRow label="Constraints"       value={fmtNumber(constraints)} />
              <DataRow label="Local Score"       value={`${localOpt?.score ?? 0}%`} tone="text-ok" />
              <DataRow label="Avg Wait"
                value={fmtDuration(localOpt?.totalWaitingHours ? localOpt.totalWaitingHours / Math.max(localOpt.assignments.length, 1) : 0)}
                tone="text-warn" />
              <DataRow label="Berth Util"        value={`${localOpt?.berthUtilization ?? kpis?.berth_utilization ?? 0}%`} />
              <DataRow label="Solved At"         value={localOpt ? fmtTime(localOpt.solvedAt) : '—'} />
            </dl>
          </Panel>

          {/* Convergence chart */}
          <Panel eyebrow="Objective descent" title="Convergence Trace">
            <div className="h-[190px]">
              {traceData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={traceData} margin={{ top: 8, right: 6, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                    <XAxis dataKey="iteration" tick={{ fill: '#8BA2C6', fontSize: 9, fontFamily: 'JetBrains Mono' }}
                      axisLine={{ stroke: '#1A2740' }} tickLine={false} />
                    <YAxis tick={{ fill: '#8BA2C6', fontSize: 9, fontFamily: 'JetBrains Mono' }}
                      axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={v => `Iteration ${v}`}
                      formatter={(v: number) => [v, 'Objective']} />
                    <Line type="monotone" dataKey="objective" stroke="#A78BFA" strokeWidth={2}
                      dot={false} animationDuration={280} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="font-mono text-[11px] text-mist text-center">
                    Convergence trace available from the<br/>local simulated-annealing solver.<br/>
                    The hybrid QAOA solver returns the<br/>final schedule directly.
                  </p>
                </div>
              )}
            </div>
          </Panel>

          <div className="flex items-start gap-2.5 rounded-lg border border-line bg-abyss/60 p-3">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aqua" aria-hidden />
            <p className="text-[11px] leading-relaxed text-mist">
              QAOA statevector simulation for ≤14 binary variables.
              Classical QUBO local-search fallback for larger fleets.
              All displayed objective values are measured — not fabricated.
            </p>
          </div>
        </div>
      </div>

      {/* ── Algorithm comparison charts ── */}
      {comparison && compAlgos.length > 0 && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel eyebrow="Measured — lower is better" title="Objective Value by Algorithm">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compObjData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    axisLine={{ stroke: '#1A2740' }} tickLine={false} />
                  <YAxis tick={{ fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }}
                    formatter={(v: number) => [v.toFixed(4), 'Objective']} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={36}>
                    {compObjData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel eyebrow="Measured — lower is better" title="Average Wait Time (min) by Algorithm">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compWaitData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    axisLine={{ stroke: '#1A2740' }} tickLine={false} />
                  <YAxis unit=" min" tick={{ fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }}
                    formatter={(v: number) => [`${v.toFixed(1)} min`, 'Avg Wait']} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={36}>
                    {compWaitData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* Full comparison table */}
          <Panel eyebrow="All algorithms — same scenario" title="Full Metrics Comparison"
            className="lg:col-span-2" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-line/70 bg-abyss/40">
                    {['Algorithm', 'Objective ↓', 'Avg Wait (min) ↓', 'Max Wait ↓',
                      'Berth Util % ↑', 'Throughput ↑', 'Runtime (ms)'].map(h => (
                      <th key={h} scope="col"
                        className="whitespace-nowrap px-3 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {compAlgos.map(a => {
                    const m = (comparison as any)[a];
                    const isBest = compAlgos.every(x =>
                      m.objective <= (comparison as any)[x].objective + 1e-9,
                    );
                    return (
                      <tr key={a} className={cn(
                        'border-b border-line/50 transition-colors',
                        isBest ? 'bg-ok/[0.04]' : 'hover:bg-white/[0.025]',
                      )}>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ background: ALGO_COLORS[a] ?? '#888' }} />
                            <span className={cn('font-mono text-[12px] font-bold',
                              isBest ? 'text-ok' : 'text-chalk')}>{a}</span>
                            {isBest && <CheckIcon className="h-3 w-3 text-ok" />}
                          </span>
                        </td>
                        <td className={cn('px-3 py-2.5 font-mono text-[11px]', isBest ? 'text-ok' : 'text-chalk')}>
                          {Number(m.objective).toFixed(4)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-chalk">
                          {Number(m.avg_wait_min).toFixed(1)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-chalk">
                          {Number(m.max_wait_min).toFixed(1)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-chalk">
                          {Number(m.berth_util_pct).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-chalk">
                          {m.throughput}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-mist">
                          {Number(m.runtime_ms).toFixed(1)}ms
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-2 font-mono text-[9px] text-mist/60">
              All metrics are measured from actual simulations on the same scenario.
              QAOA uses genuine QUBO + statevector simulation for ≤14 variables.
              ↓ lower is better · ↑ higher is better
            </p>
          </Panel>
        </div>
      )}

      {/* Hybrid schedule preview */}
      {hybridSchedule.length > 0 && (
        <Panel eyebrow="Rolling-horizon output" title="Hybrid Solver Schedule"
          className="mt-3" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead>
                <tr className="border-b border-line/70 bg-abyss/40">
                  {['Ship', 'Berth', 'Crane', 'Wait (min)', 'Proc (min)', 'Departure', 'Algorithm', 'Status'].map(h => (
                    <th key={h} scope="col"
                      className="whitespace-nowrap px-3 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hybridSchedule.map(e => (
                  <tr key={e.ship_id}
                    className="border-b border-line/50 hover:bg-white/[0.025] transition-colors">
                    <td className="px-3 py-2.5 font-mono text-[12px] font-bold text-chalk">{e.ship_id}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px]">
                      <span className={e.compatible ? 'text-aqua font-bold' : 'text-crit'}>
                        {e.berth_id ?? 'None'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-ok">{e.crane_id ?? '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px]">
                      <span className={e.wait_min > 60 ? 'text-warn' : 'text-ok'}>{e.wait_min.toFixed(1)}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-chalk">{e.processing_time_min.toFixed(0)}</td>
                    <td className="px-3 py-2.5 font-mono text-[10px] text-chalk">
                      {e.predicted_departure
                        ? new Date(e.predicted_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[9px] text-mist">{e.algo}</td>
                    <td className="px-3 py-2.5 font-mono text-[10px]">
                      <span className={e.compatible ? 'text-ok' : 'text-crit'}>
                        {e.compatible ? '✓ Allocated' : '✗ No berth'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Legacy backend berth schedule */}
      {berthSchedule && berthSchedule.length > 0 && (
        <Panel eyebrow="Legacy QAOA solver output" title="Berth Schedule (from /optimization/result)"
          className="mt-3" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead>
                <tr className="border-b border-line/70 bg-abyss/40">
                  {['Ship ID', 'Berth', 'Cargo', 'Weight (t)', 'Actual Start', 'Unload End', 'Wait (h)', 'Status'].map(
                    h => (
                      <th key={h} scope="col"
                        className="whitespace-nowrap px-3 py-2 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {berthSchedule.map((row: any, i: number) => (
                  <tr key={i} className="border-b border-line/50 hover:bg-white/[0.025] transition-colors">
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.ship_id}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-aqua">{row.berth}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.cargo}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.weight_tonnes}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">
                      {row.actual_start?.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">
                      {row.unload_end?.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <span className={row.berth_wait_hours > 1 ? 'text-warn' : 'text-ok'}>
                        {row.berth_wait_hours}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <span className={row.status === 'Allocated' ? 'text-ok' : 'text-crit'}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
