import React, { useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { ConstructionIcon, PowerIcon, WrenchIcon, GaugeIcon } from 'lucide-react';
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

const tone = {
  active:      { text: 'text-ok',   dot: 'bg-ok',   bar: 'bg-ok',   border: 'border-ok/35' },
  available:   { text: 'text-aqua', dot: 'bg-aqua', bar: 'bg-aqua', border: 'border-line' },
  maintenance: { text: 'text-mist', dot: 'bg-mist', bar: 'bg-mist', border: 'border-line' },
} as const;

export function CraneOperations() {
  const {
    cranes, craneAllocations, updateCrane, vessels, selectVessel,
    optimization, refreshKpis, kpis,
  } = usePort();
  const k = useKpis();

  useEffect(() => { refreshKpis(); }, [refreshKpis]);

  // Backend crane schedule rows when available
  const craneSchedule = (optimization as any)?.crane_schedule as any[] | undefined;

  // Chart data from local allocations
  const chartData = craneAllocations.map((a) => {
    const crane = cranes.find((c) => c.id === a.craneId);
    return {
      name: a.craneId.replace('CRN-', 'C'),
      utilization: a.utilization,
      status: a.status,
      capacity: crane?.capacityTph ?? 0,
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Quay Crane Control"
        title="Crane Operations"
        description="Crane load is derived from the berth plan: each vessel's tonnage is split across its berth's operational cranes and measured against rated throughput."
      />

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Cranes Engaged"
          value={`${kpis?.active_cranes ?? k.activeCranes}/${kpis?.crane_count ?? k.operationalCranes}`}
          icon={<ConstructionIcon className="h-4 w-4" />}
          tone="text-ok"
          support="Working a berthed vessel"
        />
        <KpiCard
          label="Mean Utilization"
          value={`${kpis?.crane_utilization ?? k.craneUtilization}%`}
          icon={<GaugeIcon className="h-4 w-4" />}
          tone="text-marine"
          trend={{ dir: k.craneUtilization > 70 ? 'up' : 'flat', text: 'vs rated', good: true }}
          support="Across operational cranes"
        />
        <KpiCard
          label="Assigned Tonnage"
          value={fmtNumber(craneAllocations.reduce((s, a) => s + a.assignedTonnes, 0))}
          unit="T"
          icon={<ConstructionIcon className="h-4 w-4" />}
          tone="text-aqua"
          support="Currently on the hook"
        />
        <KpiCard
          label="Out of Service"
          value={String(cranes.filter((c) => c.status === 'maintenance').length)}
          icon={<WrenchIcon className="h-4 w-4" />}
          tone="text-warn"
          support="Excluded from allocation"
        />
      </div>

      {/* ── Crane cards + chart ── */}
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:col-span-2">
          {craneAllocations.map((alloc) => {
            const crane = cranes.find((c) => c.id === alloc.craneId);
            if (!crane) return null;
            const t = tone[alloc.status];
            const vessel = vessels.find((v) => v.id === alloc.vesselId);
            return (
              <article
                key={alloc.craneId}
                className={cn(
                  'group relative overflow-hidden rounded-xl border bg-deck/70 p-4 shadow-panel backdrop-blur transition-[transform,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-edge',
                  t.border,
                )}
              >
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
                  <DataRow
                    label="Ship"
                    value={
                      vessel ? (
                        <button
                          type="button"
                          onClick={() => selectVessel(vessel.id)}
                          className="text-aqua transition-colors duration-150 hover:text-chalk"
                        >
                          {vessel.id}
                        </button>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <DataRow
                    label="Load"
                    value={alloc.assignedTonnes ? `${fmtNumber(alloc.assignedTonnes)} t` : '—'}
                  />
                  <DataRow label="Rated" value={`${crane.capacityTph} t/h`} />
                </dl>
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between font-mono text-[10px]">
                    <span className="text-mist">UTILIZATION</span>
                    <span className={t.text}>{alloc.utilization}%</span>
                  </div>
                  <ProgressBar
                    value={alloc.utilization}
                    tone={alloc.utilization > 92 ? 'bg-warn' : t.bar}
                  />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {alloc.status === 'active' && (
                    <span className="flex items-center gap-1 font-mono text-[9px] text-ok">
                      <span className="h-1 w-1 rounded-full bg-ok np-ping" />
                      CYCLING
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={crane.status === 'operational' ? 'secondary' : 'primary'}
                    icon={<PowerIcon className="h-3 w-3" />}
                    className="ml-auto"
                    onClick={() =>
                      updateCrane(crane.id, {
                        status: crane.status === 'operational' ? 'maintenance' : 'operational',
                      })
                    }
                  >
                    {crane.status === 'operational' ? 'Take Offline' : 'Return to Service'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>

        <Panel eyebrow="Rated capacity vs demand" title="Crane Utilization">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={{ stroke: '#1A2740' }}
                  tickLine={false}
                />
                <YAxis
                  unit="%"
                  domain={[0, 100]}
                  tick={{ fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(34,211,238,0.06)' }}
                  contentStyle={{ background: '#0A1120', border: '1px solid #1A2740', borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11 }}
                  labelStyle={{ color: '#E8EFF9' }}
                  formatter={(value: number, _n, entry) => [
                    `${value}% of ${entry.payload.capacity} t/h`,
                    'Utilization',
                  ]}
                />
                <Bar dataKey="utilization" radius={[3, 3, 0, 0]} maxBarSize={34}>
                  {chartData.map((row) => (
                    <Cell
                      key={row.name}
                      fill={
                        row.status === 'maintenance'
                          ? '#3A4A66'
                          : row.utilization > 92
                          ? '#F5A524'
                          : row.status === 'active'
                          ? '#34D399'
                          : '#22D3EE'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-mist/80">
            Bars above 92% indicate a crane running at the edge of its rated throughput.
          </p>
        </Panel>
      </div>

      {/* ── Backend crane schedule table ── */}
      {craneSchedule && craneSchedule.length > 0 && (
        <Panel
          eyebrow="Backend optimizer output"
          title="Crane Transport Schedule"
          className="mt-3"
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-line/70 bg-abyss/40">
                  {[
                    'Ship ID', 'Berth', 'Crane', 'Weight (t)', 'Spoilable',
                    'Ready After Unloading', 'Transport Start', 'Transport End',
                    'Priority', 'Deadline',
                  ].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {craneSchedule.map((row: any, i: number) => (
                  <tr key={i} className="border-b border-line/50 transition-colors hover:bg-white/[0.025]">
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.ship_id}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-aqua">{row.berth}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ok">{row.crane}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.weight_tonnes}</td>
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
                      <span className={row.deadline_status === 'Deadline risk' ? 'text-crit' : row.deadline_status === 'Within deadline' ? 'text-ok' : 'text-mist'}>
                        {row.deadline_status}
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
