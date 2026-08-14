import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { motion } from 'framer-motion';
import {
  ShipIcon, ScaleIcon, BinaryIcon, BrainCircuitIcon, LayoutGridIcon,
  ZapIcon, ArrowDownIcon, InfoIcon, CheckIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { StatusDot } from '../components/ui/StatusDot';
import { DataRow } from '../components/ui/DataRow';
import { usePort } from '../contexts/PortContext';
import { fmtDuration, fmtNumber, fmtTime } from '../utils/geo';
import { cn } from '../utils/ui';
import { api } from '../services/api';
import type { OptimizationResult } from '../services/api';

export function QuantumOptimization() {
  const {
    optimization: localOpt, solving, runOptimization,
    vessels, berths, settings, kpis,
  } = usePort();

  // Backend-specific result (QUBO variables / constraints / trace)
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

  const queue = vessels.filter((v) => v.status !== 'departing').length;
  const qvars = backendResult?.qubo_variables ?? localOpt?.quboVariables ?? 0;
  const constraints = backendResult?.constraints ?? localOpt?.constraints ?? 0;
  const berthSchedule = (backendResult as any)?.berth_schedule as any[] | undefined;
  const assigned = berthSchedule?.filter((r: any) => r.status === 'Allocated').length
    ?? localOpt?.assignments.length
    ?? 0;
  const isSolving = solving || fetching;

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
      detail: `x[vessel, berth] with penalty weights — waiting ${settings.waitingWeight}, spoilage ${settings.spoilageWeight}, priority ${settings.priorityWeight}`,
    },
    {
      key: 'solver',
      label: 'QAOA / Solver',
      Icon: BrainCircuitIcon,
      metric: `${fmtNumber(localOpt?.iterations ?? settings.annealIterations)} iterations`,
      detail: 'Metropolis-annealed sequence search over the binary quadratic model (QUBO/QAOA simulation)',
    },
    {
      key: 'output',
      label: 'Optimal Berth Allocation',
      Icon: LayoutGridIcon,
      metric: `${assigned} assignments`,
      detail: `Objective ${localOpt?.objectiveValue ?? 0} · score ${localOpt?.score ?? 0}%`,
    },
  ];

  // Convergence trace: use local opt trace or synthesise from backend result
  const traceData = localOpt?.trace ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Optimization Engine"
        title="Quantum Optimization Engine"
        description="The berth allocation problem is expressed as a QUBO and minimised with a QAOA-style annealing schedule. The backend Python solver runs the QAOA statevector simulation for small instances and a deterministic local-search QUBO for larger fleets."
        actions={
          <div className="flex gap-2">
            <Button
              icon={<ZapIcon className="h-3.5 w-3.5" />}
              onClick={fetchBackendResult}
              disabled={fetching}
            >
              {fetching ? 'Fetching…' : 'Fetch Backend Result'}
            </Button>
            <Button
              variant="primary"
              icon={<ZapIcon className="h-3.5 w-3.5" />}
              onClick={async () => { await runOptimization(); await fetchBackendResult(); }}
              disabled={isSolving}
            >
              {isSolving ? 'Solving…' : 'Run Solver'}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 xl:grid-cols-3">
        {/* Pipeline */}
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
                      ? 'border-quantum/45 bg-quantum/[0.07] np-sweep'
                      : 'border-line bg-abyss/60',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-md border',
                      isSolving
                        ? 'border-quantum/50 bg-quantum/12 text-quantum'
                        : 'border-aqua/35 bg-aqua/10 text-aqua',
                    )}
                  >
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
                      {!isSolving && localOpt && (
                        <CheckIcon className="ml-auto h-3.5 w-3.5 text-ok" aria-hidden />
                      )}
                    </div>
                    <p className="mt-1 text-[12px] leading-snug text-mist">{stage.detail}</p>
                  </div>
                </motion.div>
                {i < stages.length - 1 && (
                  <div className="flex items-center gap-2 py-1 pl-[30px]">
                    <ArrowDownIcon
                      className={cn('h-3.5 w-3.5', isSolving ? 'text-quantum' : 'text-edge')}
                      aria-hidden
                    />
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
            <p
              className={cn(
                'flex items-center gap-2 font-display text-2xl font-semibold',
                isSolving ? 'text-quantum' : 'text-ok',
              )}
            >
              <StatusDot color={isSolving ? 'bg-quantum' : 'bg-ok'} />
              {isSolving ? 'SOLVING' : localOpt ? 'COMPLETE' : 'IDLE'}
            </p>
            <dl className="mt-3">
              <DataRow label="Iterations" value={fmtNumber(localOpt?.iterations ?? 0)} />
              <DataRow label="QUBO Variables" value={fmtNumber(qvars)} />
              <DataRow label="Constraints" value={fmtNumber(constraints)} />
              <DataRow
                label="Objective Value"
                value={fmtNumber(localOpt?.objectiveValue ?? 0, 2)}
                tone="text-quantum"
              />
              <DataRow
                label="Optimization Score"
                value={`${localOpt?.score ?? 0}%`}
                tone="text-ok"
              />
              <DataRow
                label="Total Waiting"
                value={fmtDuration(localOpt?.totalWaitingHours ?? 0)}
                tone="text-warn"
              />
              <DataRow label="Berths in Model" value={String(berths.length)} />
              <DataRow
                label="Berth Utilization"
                value={`${kpis?.berth_utilization ?? localOpt?.berthUtilization ?? 0}%`}
              />
              <DataRow
                label="Solved At"
                value={localOpt ? fmtTime(localOpt.solvedAt) : '—'}
              />
            </dl>
          </Panel>

          <Panel eyebrow="Objective descent" title="Convergence">
            <div className="h-[190px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={traceData}
                  margin={{ top: 8, right: 6, bottom: 0, left: -22 }}
                >
                  <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                  <XAxis
                    dataKey="iteration"
                    tick={{ fill: '#8BA2C6', fontSize: 9, fontFamily: 'JetBrains Mono' }}
                    axisLine={{ stroke: '#1A2740' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#8BA2C6', fontSize: 9, fontFamily: 'JetBrains Mono' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0A1120', border: '1px solid #1A2740', borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11 }}
                    labelFormatter={(v) => `Iteration ${v}`}
                    formatter={(v: number) => [v, 'Objective']}
                  />
                  <Line
                    type="monotone"
                    dataKey="objective"
                    stroke="#A78BFA"
                    strokeWidth={2}
                    dot={false}
                    animationDuration={280}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="flex items-start gap-2.5 rounded-lg border border-line bg-abyss/60 p-3">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aqua" aria-hidden />
            <p className="text-[11px] leading-relaxed text-mist">
              The Python backend uses a genuine QAOA statevector simulation for ≤14 binary
              variables (small fleets) and a QUBO local-search fallback for larger scenarios.
              Both minimise the same weighted objective: berth waiting + spoilage urgency + berth
              scarcity.
            </p>
          </div>
        </div>
      </div>

      {/* Backend berth schedule preview */}
      {berthSchedule && berthSchedule.length > 0 && (
        <Panel
          eyebrow="Quantum solver output"
          title="Berth Schedule (from backend)"
          className="mt-3"
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead>
                <tr className="border-b border-line/70 bg-abyss/40">
                  {['Ship ID', 'Berth', 'Cargo', 'Weight (t)', 'Actual Start', 'Unload End', 'Wait (h)', 'Status'].map(
                    (h) => (
                      <th
                        key={h}
                        scope="col"
                        className="whitespace-nowrap px-3 py-2 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {berthSchedule.map((row: any, i: number) => (
                  <tr key={i} className="border-b border-line/50 hover:bg-white/[0.025]">
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
