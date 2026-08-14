import React, { useEffect } from 'react';
import { ZapIcon, SparklesIcon, TimerIcon, LayoutGridIcon, CheckCircle2Icon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { KpiCard } from '../components/ui/KpiCard';
import { StatusDot } from '../components/ui/StatusDot';
import { BerthTimeline } from '../components/berth/BerthTimeline';
import { AnchorageZone } from '../components/berth/AnchorageZone';
import { VesselDetailPanel } from '../components/vessel/VesselDetailPanel';
import { usePort } from '../contexts/PortContext';
import { fmtDuration, fmtNumber, fmtTime } from '../utils/geo';
import { cn } from '../utils/ui';

export function BerthOptimization() {
  const {
    optimization, solving, runOptimization,
    berths, vessels, kpis, refreshKpis,
  } = usePort();

  useEffect(() => { refreshKpis(); }, [refreshKpis]);

  const assigned = optimization?.assignments.length ?? 0;
  const status = solving ? 'SOLVING' : optimization ? 'OPTIMIZED' : 'IDLE';

  // Backend berth schedule rows (from optimization result)
  const berthSchedule = (optimization as any)?.berth_schedule as any[] | undefined;

  return (
    <>
      <PageHeader
        eyebrow="Berth Allocation Engine"
        title="Berth Optimization"
        description="Constraint-aware QUBO/QAOA sequencing across the berth estate. LOA and draft envelopes, unloading duration and spoilage deadlines all feed the solver objective."
        actions={
          <Button
            variant="primary"
            icon={<ZapIcon className="h-3.5 w-3.5" />}
            onClick={runOptimization}
            disabled={solving}
          >
            {solving ? 'Solving…' : 'Re-optimize'}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel className="col-span-2 lg:col-span-1">
          <p className="font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
            Optimization Status
          </p>
          <p
            className={cn(
              'mt-3 flex items-center gap-2 font-display text-2xl font-semibold',
              solving ? 'text-quantum' : 'text-ok',
            )}
          >
            <StatusDot color={solving ? 'bg-quantum' : 'bg-ok'} />
            {status}
          </p>
          <p className="mt-3 font-mono text-[11px] text-mist">
            {assigned} of {vessels.length} vessels sequenced
            {optimization?.unassigned.length
              ? ` · ${optimization.unassigned.length} infeasible`
              : ''}
          </p>
          {optimization && (
            <p className="mt-1 font-mono text-[10px] text-mist/70">
              SOLVED {fmtTime(optimization.solvedAt)}
            </p>
          )}
        </Panel>
        <KpiCard
          label="Optimization Score"
          value={`${optimization?.score ?? 0}%`}
          icon={<SparklesIcon className="h-4 w-4" />}
          tone="text-quantum"
          support={`Objective ${optimization?.objectiveValue ?? 0}`}
          trend={{ dir: 'up', text: `${optimization?.iterations ?? 0} iters`, good: true }}
        />
        <KpiCard
          label="Total Waiting Time"
          value={fmtDuration(optimization?.totalWaitingHours ?? 0)}
          icon={<TimerIcon className="h-4 w-4" />}
          tone="text-warn"
          support={`${optimization?.anchorage.length ?? 0} vessels held`}
        />
        <KpiCard
          label="Berth Utilization"
          value={`${kpis?.berth_utilization ?? optimization?.berthUtilization ?? 0}%`}
          icon={<LayoutGridIcon className="h-4 w-4" />}
          tone="text-ocean"
          support={`${berths.filter((b) => b.status === 'operational').length} berths operational`}
        />
      </div>

      <BerthTimeline className="mt-3" />

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <AnchorageZone className="xl:col-span-2" />
        <VesselDetailPanel />
      </div>

      {/* Backend berth schedule */}
      {berthSchedule && berthSchedule.length > 0 && (
        <Panel
          eyebrow="Backend quantum schedule"
          title="Berth Allocation Schedule"
          className="mt-3"
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-line/70 bg-abyss/40">
                  {[
                    'Ship ID', 'Berth', 'Capacity (t)', 'Operator', 'Cargo',
                    'Weight (t)', 'LOA (m)', 'Draft (m)', 'Requested Start',
                    'Actual Start', 'Unload End', 'Wait (h)', 'Status',
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
                {berthSchedule.map((row: any, i: number) => (
                  <tr key={i} className="border-b border-line/50 transition-colors hover:bg-white/[0.025]">
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.ship_id}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-aqua">{row.berth}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.berth_capacity_t?.toLocaleString?.() ?? row.berth_capacity_t}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.operator}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.cargo}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.weight_tonnes}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.loa_m}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.draft_m}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.requested_start}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-chalk">{row.actual_start?.slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-mist">{row.unload_end?.slice(0, 16).replace('T', ' ')}</td>
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

      {/* Berth envelope */}
      <Panel
        eyebrow="Estate"
        title="Berth Envelope"
        className="mt-3"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line/70 bg-abyss/40">
                {['Berth', 'Max LOA', 'Max Draft', 'Crane Slots', 'Scheduled', 'Occupancy', 'Status'].map(
                  (h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {berths.map((berth) => {
                const rows =
                  optimization?.assignments.filter((a) => a.berthId === berth.id) ?? [];
                const hours = rows.reduce(
                  (s, a) =>
                    s + (new Date(a.end).getTime() - new Date(a.start).getTime()) / 3_600_000,
                  0,
                );
                return (
                  <tr key={berth.id} className="border-b border-line/50">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-chalk">{berth.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-mist">{berth.maxLoa} m</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-mist">{berth.maxDraft} m</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-mist">{berth.craneSlots}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-aqua">
                      {rows.length ? rows.map((r) => r.vesselId).join(', ') : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-chalk">
                      {fmtNumber(hours, 1)} h
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 font-mono text-[10px]',
                          berth.status === 'operational' ? 'text-ok' : 'text-mist',
                        )}
                      >
                        {berth.status === 'operational' ? (
                          <CheckCircle2Icon className="h-3 w-3" aria-hidden />
                        ) : (
                          <TimerIcon className="h-3 w-3" aria-hidden />
                        )}
                        {berth.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
