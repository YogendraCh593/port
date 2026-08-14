/**
 * CraneOperations – optimized crane load management.
 * Uses /cranes/optimize backend endpoint for load-balanced assignments.
 */
import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import {
  ConstructionIcon, PowerIcon, WrenchIcon, GaugeIcon,
  ZapIcon, CheckCircle2Icon, TriangleAlertIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { KpiCard } from '../components/ui/KpiCard';
import { StatusDot } from '../components/ui/StatusDot';
import { ProgressBar } from '../components/ui/ProgressBar';
import { DataRow } from '../components/ui/DataRow';
import { usePort } from '../contexts/PortContext';
import { useKpis } from '../hooks/useKpis';
import { fmtNumber } from '../utils/geo';
import { cn } from '../utils/ui';
import { BASE_URL } from '../services/api';

interface CraneOptResult {
  assignments: any[];
  utilization: {
    crane: string;
    assigned_load_t: number;
    utilization_pct: number;
    deviation_from_ideal_t: number;
  }[];
  total_load_t: number;
  ideal_per_crane_t: number;
  balance_score: number;
  balanced: boolean;
  crane_count: number;
  rate_tph: number;
}

const toneMap = {
  active:      { text: 'text-ok',   dot: 'bg-ok',   bar: 'bg-ok',   border: 'border-ok/35' },
  available:   { text: 'text-aqua', dot: 'bg-aqua', bar: 'bg-aqua', border: 'border-line' },
  maintenance: { text: 'text-mist', dot: 'bg-mist', bar: 'bg-mist', border: 'border-line' },
} as const;

const tooltipStyle = {
  background: '#0A1120', border: '1px solid #1A2740',
  borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11,
};
const axisProps = {
  tick: { fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' },
  axisLine: { stroke: '#1A2740' }, tickLine: false,
} as const;

export function CraneOperations() {
  const {
    cranes, craneAllocations, updateCrane, vessels,
    selectVessel, optimization, refreshKpis, kpis,
  } = usePort();
  const k = useKpis();

  const [craneOpt, setCraneOpt] = useState<CraneOptResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => { refreshKpis(); }, [refreshKpis]);

  async function runCraneOptimization() {
    setOptimizing(true);
    try {
      const res = await fetch(`${BASE_URL}/cranes/optimize`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data: CraneOptResult = await res.json();
      setCraneOpt(data);
      toast.success('Crane load optimized', {
        description: `Balance: ${data.balance_score}% · Total: ${fmtNumber(data.total_load_t)} t across ${data.crane_count} cranes`,
      });
    } catch (err) {
      toast.error('Optimization failed', { description: String(err) });
    } finally {
      setOptimizing(false);
    }
  }

  const craneSchedule = (optimization as any)?.crane_schedule as any[] | undefined;

  const chartData = craneOpt
    ? craneOpt.utilization.map((u) => ({
        name: u.crane.replace('Crane ', 'C'),
        utilization: u.utilization_pct,
        load: u.assigned_load_t,
        deviation: u.deviation_from_ideal_t,
        status: 'active',
      }))
    : craneAllocations.map((a) => ({
        name: a.craneId.replace('CRN-', 'C'),
        utilization: a.utilization,
        load: a.assignedTonnes,
        deviation: 0,
        status: a.status,
      }));

  const totalLoad = craneOpt?.total_load_t
    ?? craneAllocations.reduce((s, a) => s + a.assignedTonnes, 0);
  const idealPerCrane = craneOpt?.ideal_per_crane_t
    ?? totalLoad / Math.max(cranes.length, 1);
  const balanceScore = craneOpt?.balance_score ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Quay Crane Control"
        title="Crane Operations"
        description="Optimize crane assignments by berth load capacity. The backend solver balances load across cranes, prioritising spoilable cargo and heaviest loads."
        actions={
          <Button variant="primary" icon={<ZapIcon className="h-3.5 w-3.5" />}
            onClick={runCraneOptimization} disabled={optimizing}>
            {optimizing ? 'Optimizing…' : 'Optimize Crane Load'}
          </Button>
        }
      />

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Cranes Engaged"
          value={`${kpis?.active_cranes ?? k.activeCranes}/${kpis?.crane_count ?? k.operationalCranes}`}
          icon={<ConstructionIcon className="h-4 w-4" />} tone="text-ok"
          support="Working a berthed vessel" />
        <KpiCard label="Mean Utilization"
          value={`${kpis?.crane_utilization ?? k.craneUtilization}%`}
          icon={<GaugeIcon className="h-4 w-4" />} tone="text-marine"
          trend={{ dir: k.craneUtilization > 70 ? 'up' : 'flat', text: 'vs rated', good: true }}
          support="Across operational cranes" />
        <KpiCard label="Total Load" value={fmtNumber(totalLoad)} unit="T"
          icon={<ConstructionIcon className="h-4 w-4" />} tone="text-aqua"
          support={`Ideal ${fmtNumber(idealPerCrane)} t / crane`} />
        {balanceScore !== null ? (
          <KpiCard label="Balance Score" value={`${balanceScore}%`}
            icon={balanceScore >= 75
              ? <CheckCircle2Icon className="h-4 w-4" />
              : <TriangleAlertIcon className="h-4 w-4" />}
            tone={balanceScore >= 75 ? 'text-ok' : 'text-warn'}
            support={craneOpt?.balanced ? 'Load well distributed' : 'Imbalance detected'} />
        ) : (
          <KpiCard label="Out of Service"
            value={String(cranes.filter((c) => c.status === 'maintenance').length)}
            icon={<WrenchIcon className="h-4 w-4" />} tone="text-warn"
            support="Excluded from allocation" />
        )}
      </div>

      {/* ── Balance score + distribution chart ── */}
      {craneOpt && (
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Panel eyebrow="Load balance" title="Balance Score">
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  data={[{ name: 'score', value: craneOpt.balance_score,
                    fill: craneOpt.balanced ? '#34d399' : '#f5a524' }]}
                  innerRadius="70%" outerRadius="100%" startAngle={210} endAngle={-30}>
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar dataKey="value" cornerRadius={8} background={{ fill: '#101A2C' }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <p className="-mt-[110px] text-center font-display text-3xl font-semibold text-chalk">
                {craneOpt.balance_score}%
              </p>
            </div>
            <dl className="mt-2">
              <DataRow label="Total Load" value={`${fmtNumber(craneOpt.total_load_t)} t`} />
              <DataRow label="Ideal / Crane" value={`${fmtNumber(craneOpt.ideal_per_crane_t)} t`} />
              <DataRow label="Status"
                value={craneOpt.balanced ? 'BALANCED' : 'IMBALANCED'}
                tone={craneOpt.balanced ? 'text-ok' : 'text-warn'} />
            </dl>
          </Panel>

          <Panel eyebrow="Per crane" title="Load Distribution" className="lg:col-span-2">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis unit="%" domain={[0, 100]} {...axisProps} axisLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(34,211,238,0.06)' }}
                    contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }}
                    formatter={(v: number, _n, entry: any) => [
                      `${v}% · ${fmtNumber(entry.payload.load)} t`, 'Utilization',
                    ]} />
                  <Bar dataKey="utilization" radius={[3, 3, 0, 0]} maxBarSize={36}>
                    {chartData.map((row, i) => (
                      <Cell key={i}
                        fill={row.utilization > 92 ? '#f5a524'
                          : row.utilization > 0 ? '#34d399'
                          : '#1A2740'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      )}

      {/* ── Crane cards ── */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {craneAllocations.map((alloc) => {
          const crane = cranes.find((c) => c.id === alloc.craneId);
          if (!crane) return null;
          const t = toneMap[alloc.status];
          const vessel = vessels.find((v) => v.id === alloc.vesselId);
          const optLoad = craneOpt?.utilization.find(
            (u) => u.crane === crane.name || u.crane === `Crane ${crane.id.replace(/\D/g, '')}`,
          );
          return (
            <article key={alloc.craneId}
              className={cn(
                'rounded-xl border bg-deck/70 p-4 shadow-panel backdrop-blur',
                'transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-edge',
                t.border,
              )}>
              <div className="flex items-center gap-2">
                <ConstructionIcon className={cn('h-4 w-4', t.text)} aria-hidden />
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-chalk">
                  {crane.name}
                </h2>
                <span className={cn('ml-auto flex items-center gap-1.5 font-mono text-[10px]', t.text)}>
                  <StatusDot color={t.dot} pulse={alloc.status === 'active'} />
                  {alloc.status.toUpperCase()}
                </span>
              </div>

              <dl className="mt-3">
                <DataRow label="Berth" value={alloc.berthId} />
                <DataRow label="Ship" value={vessel ? (
                  <button type="button" onClick={() => selectVessel(vessel.id)}
                    className="text-aqua hover:text-chalk transition-colors">
                    {vessel.id}
                  </button>
                ) : '—'} />
                <DataRow label="Assigned Load"
                  value={optLoad
                    ? `${fmtNumber(optLoad.assigned_load_t)} t`
                    : alloc.assignedTonnes ? `${fmtNumber(alloc.assignedTonnes)} t` : '—'} />
                <DataRow label="Rated Capacity" value={`${crane.capacityTph} t/h`} />
                {optLoad && (
                  <DataRow label="Vs Ideal"
                    value={`${optLoad.deviation_from_ideal_t >= 0 ? '+' : ''}${fmtNumber(optLoad.deviation_from_ideal_t)} t`}
                    tone={Math.abs(optLoad.deviation_from_ideal_t) > idealPerCrane * 0.25 ? 'text-warn' : 'text-ok'} />
                )}
              </dl>

              <div className="mt-3">
                <div className="mb-1.5 flex justify-between font-mono text-[10px]">
                  <span className="text-mist">UTILIZATION</span>
                  <span className={t.text}>
                    {optLoad?.utilization_pct ?? alloc.utilization}%
                  </span>
                </div>
                <ProgressBar
                  value={optLoad?.utilization_pct ?? alloc.utilization}
                  tone={(optLoad?.utilization_pct ?? alloc.utilization) > 92 ? 'bg-warn' : t.bar} />
              </div>

              <div className="mt-3 flex items-center gap-2">
                {alloc.status === 'active' && (
                  <span className="flex items-center gap-1 font-mono text-[9px] text-ok">
                    <span className="h-1 w-1 rounded-full bg-ok" />CYCLING
                  </span>
                )}
                <Button size="sm"
                  variant={crane.status === 'operational' ? 'secondary' : 'primary'}
                  icon={<PowerIcon className="h-3 w-3" />}
                  className="ml-auto"
                  onClick={() => updateCrane(crane.id, {
                    status: crane.status === 'operational' ? 'maintenance' : 'operational',
                  })}>
                  {crane.status === 'operational' ? 'Take Offline' : 'Return to Service'}
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      {/* ── Backend crane schedule table ── */}
      {craneSchedule && craneSchedule.length > 0 && (
        <Panel eyebrow="Backend optimizer output" title="Crane Transport Schedule"
          className="mt-3" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-line/70 bg-abyss/40">
                  {['Ship', 'Berth', 'Crane', 'Weight', 'Spoilable', 'Ready', 'Start', 'End', 'Priority', 'Deadline'].map((h) => (
                    <th key={h} scope="col"
                      className="whitespace-nowrap px-3 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {craneSchedule.map((row: any, i: number) => (
                  <tr key={i} className="border-b border-line/50 hover:bg-white/[0.025] transition-colors">
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.ship_id}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-aqua">{row.berth}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ok">{row.crane}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.weight_tonnes} t</td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <span className={row.spoilable ? 'text-warn' : 'text-mist'}>
                        {row.spoilable ? 'YES' : 'No'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.ready_after_unloading}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.transport_start}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.transport_end}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-mist">{row.priority_reason}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <span className={
                        row.deadline_status === 'Deadline risk' ? 'text-crit'
                          : row.deadline_status === 'Within deadline' ? 'text-ok'
                          : 'text-mist'
                      }>{row.deadline_status}</span>
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
