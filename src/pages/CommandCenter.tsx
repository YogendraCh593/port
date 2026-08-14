import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  ShipIcon, WavesIcon, AnchorIcon, TimerIcon, PackageIcon,
  LayoutGridIcon, ConstructionIcon, SparklesIcon, ZapIcon, Maximize2Icon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { KpiCard } from '../components/ui/KpiCard';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { PortMap } from '../components/map/PortMap';
import { VesselDetailPanel } from '../components/vessel/VesselDetailPanel';
import { ArrivalQueue } from '../components/vessel/ArrivalQueue';
import { AlertFeed } from '../components/alerts/AlertFeed';
import { usePort } from '../contexts/PortContext';
import { useKpis } from '../hooks/useKpis';
import { fmtDuration, fmtNumber } from '../utils/geo';

const tooltipStyle = {
  background: '#0A1120', border: '1px solid #1A2740',
  borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11,
};
const axisProps = {
  tick: { fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' },
  axisLine: { stroke: '#1A2740' }, tickLine: false,
} as const;

export function CommandCenter() {
  const {
    settings, optimization, solving, runOptimization, vessels,
    kpis, refreshKpis, mapSnapshot, refreshMap, activePort,
  } = usePort();
  const k = useKpis();

  // Refresh KPIs + map when the page is mounted
  useEffect(() => {
    refreshKpis();
    refreshMap();
  }, [refreshKpis, refreshMap]);

  const portName = activePort?.short ?? settings.portName;

  // Charts come from backend KPIs when available, fall back to local
  const berthUtilChart = kpis?.berth_utilization_chart ?? [];
  const throughputTrend = kpis?.throughput_trend;
  const cranePie = kpis
    ? [
        { name: 'Working', value: kpis.crane_pie.working },
        { name: 'Idle', value: 100 - kpis.crane_pie.working - kpis.crane_pie.maintenance },
        { name: 'Maintenance', value: kpis.crane_pie.maintenance },
      ]
    : [];

  const comparison = kpis?.optimization_comparison;

  return (
    <>
      <PageHeader
        eyebrow="Smart Port Operations Center"
        title="Welcome to NexusPort"
        description={`${portName} · live berth, crane and approach picture for ${vessels.length} tracked vessels.`}
        actions={
          <>
            <Link to="/vessels">
              <Button icon={<ShipIcon className="h-3.5 w-3.5" />}>Register Vessel</Button>
            </Link>
            <Button
              variant="primary"
              icon={<ZapIcon className="h-3.5 w-3.5" />}
              onClick={runOptimization}
              disabled={solving}
            >
              {solving ? 'Solving…' : 'Re-run Allocation'}
            </Button>
          </>
        }
      />

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard
          className="col-span-2 xl:col-span-2"
          featured
          label="Active Vessels"
          value={String(kpis?.total_ships ?? k.active)}
          icon={<ShipIcon className="h-5 w-5" />}
          tone="text-aqua"
          trend={{ dir: 'up', text: `+${k.atSea} inbound`, good: true }}
          support={`${k.departing} cleared outbound today`}
        />
        <KpiCard
          label="At Sea"
          value={String(mapSnapshot?.counters.approaching ?? k.atSea)}
          icon={<WavesIcon className="h-4 w-4" />}
          tone="text-aqua"
          support="On approach leg"
        />
        <KpiCard
          label="At Berth"
          value={String(mapSnapshot?.counters.servicing ?? k.atBerth)}
          icon={<AnchorIcon className="h-4 w-4" />}
          tone="text-ok"
          support="Discharging now"
        />
        <KpiCard
          label="Waiting"
          value={String(mapSnapshot?.counters.waiting ?? k.waiting)}
          icon={<TimerIcon className="h-4 w-4" />}
          tone="text-warn"
          trend={{ dir: k.waiting > 1 ? 'up' : 'flat', text: fmtDuration(k.avgWaitingHours), good: false }}
          support="Held at anchorage"
        />
        <KpiCard
          label="Total Cargo"
          value={fmtNumber(kpis?.total_load_teu ?? k.totalTeu)}
          unit="TEU"
          icon={<PackageIcon className="h-4 w-4" />}
          tone="text-marine"
          support={`${fmtNumber(k.totalCargo)} t in pipeline`}
        />
        <KpiCard
          label="Berth Utilization"
          value={`${kpis?.berth_utilization ?? k.berthUtilization}%`}
          icon={<LayoutGridIcon className="h-4 w-4" />}
          tone="text-ocean"
          trend={{ dir: 'up', text: 'plan window', good: true }}
          support="Across operational berths"
        />
        <KpiCard
          label="Crane Utilization"
          value={`${kpis?.crane_utilization ?? k.craneUtilization}%`}
          icon={<ConstructionIcon className="h-4 w-4" />}
          tone="text-marine"
          support={`${kpis?.active_cranes ?? k.activeCranes}/${kpis?.crane_count ?? k.operationalCranes} cranes engaged`}
        />
        <KpiCard
          label="Optimization Score"
          value={`${optimization?.score ?? 0}%`}
          icon={<SparklesIcon className="h-4 w-4" />}
          tone="text-quantum"
          trend={{ dir: 'up', text: `${optimization?.iterations ?? 0} iters`, good: true }}
          support={`Objective ${optimization?.objectiveValue ?? 0}`}
        />
        <KpiCard
          label="Spoilage Watch"
          value={String(k.spoilageRiskCount)}
          icon={<TimerIcon className="h-4 w-4" />}
          tone={k.spoilageRiskCount ? 'text-crit' : 'text-ok'}
          support="Time-sensitive cargo flagged"
        />
        <KpiCard
          label="Queue Backlog"
          value={fmtDuration(kpis?.total_wait_hours ?? k.totalWaitingHours)}
          icon={<TimerIcon className="h-4 w-4" />}
          tone="text-warn"
          support="Total projected waiting"
        />
      </div>

      {/* ── Map + Vessel Detail ── */}
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel
          eyebrow="Live traffic picture"
          title="Port Map"
          className="xl:col-span-2"
          bodyClassName="p-0"
          actions={
            <Link to="/simulation">
              <Button size="sm" icon={<Maximize2Icon className="h-3 w-3" />}>
                Simulation
              </Button>
            </Link>
          }
        >
          <div className="h-[420px] sm:h-[520px]">
            <PortMap />
          </div>
        </Panel>
        <VesselDetailPanel />
      </div>

      {/* ── Arrival queue + Alert feed ── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ArrivalQueue limit={6} />
        <AlertFeed limit={5} />
      </div>

      {/* ── Charts Row 1: Berth utilization + Optimization comparison ── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel eyebrow="Berth load" title="Berth Utilization Overview">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={berthUtilChart}
                margin={{ top: 8, right: 8, bottom: 24, left: -18 }}
              >
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis
                  dataKey="berth"
                  {...axisProps}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis {...axisProps} axisLine={false} unit="%" domain={[0, 110]} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: '#E8EFF9' }}
                  formatter={(v: number) => [`${v}%`, 'Utilization']}
                />
                <Bar dataKey="utilization" fill="#22D3EE" radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel eyebrow="Classical vs optimized" title="Optimization Comparison">
          {comparison ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line/70">
                    {['Metric', 'Classical', 'Optimized'].map((h) => (
                      <th key={h} className="px-3 py-2 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Total Load (TEU)', comparison.classical.total_load_teu, comparison.optimized.total_load_teu],
                    ['Avg Unloading (h)', comparison.classical.avg_unloading_h, comparison.optimized.avg_unloading_h],
                    ['Berth Utilization (%)', comparison.classical.berth_utilization, comparison.optimized.berth_utilization],
                    ['Priority Cargo (%)', comparison.classical.priority_cargo_pct, comparison.optimized.priority_cargo_pct],
                    ['Estimated Wait (h)', comparison.classical.estimated_wait_h, comparison.optimized.estimated_wait_h],
                  ].map(([label, classical, optimized]) => (
                    <tr key={String(label)} className="border-b border-line/50">
                      <td className="px-3 py-2 font-mono text-[11px] text-mist">{label}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-chalk">{classical}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-ok">{optimized}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center font-mono text-[11px] text-mist">
              Run optimization to see comparison
            </p>
          )}
          {kpis?.disaster_mode && (
            <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-[11px] text-warn">
              Emergency cargo mode active — critical cargo receives elevated scheduling priority.
            </p>
          )}
          {kpis && (
            <p className="mt-2 font-mono text-[11px] text-aqua">
              Scenario Priority Score: {kpis.scenario_priority_score}
            </p>
          )}
        </Panel>
      </div>

      {/* ── Charts Row 2: Throughput + Crane pie ── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel eyebrow="Cumulative TEU" title="Throughput Trend">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
                data={
                  throughputTrend
                    ? throughputTrend.classical.map((c, i) => ({
                        hour: c.hour,
                        Classical: c.teu,
                        Optimized: throughputTrend.optimized[i]?.teu ?? 0,
                      }))
                    : []
                }
              >
                <defs>
                  <linearGradient id="np-thr-c" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="np-thr-o" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis dataKey="hour" {...axisProps} unit="h" />
                <YAxis {...axisProps} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }} />
                <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#8BA2C6' }} />
                <Area type="monotone" dataKey="Classical" stroke="#3B82F6" strokeWidth={2} fill="url(#np-thr-c)" />
                <Area type="monotone" dataKey="Optimized" stroke="#22D3EE" strokeWidth={2} fill="url(#np-thr-o)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel eyebrow="Equipment" title="Crane Utilization">
          <div className="flex h-[280px] items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={cranePie}
                  cx="50%"
                  cy="50%"
                  innerRadius="60%"
                  outerRadius="80%"
                  paddingAngle={2}
                  dataKey="value"
                >
                  {cranePie.map((entry, i) => (
                    <Cell
                      key={entry.name}
                      fill={['#34D399', '#1A2740', '#F5A524'][i % 3]}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`]} />
                <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#8BA2C6' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* ── Run Optimization CTA ── */}
      <div className="mt-3">
        <Button
          variant="primary"
          className="w-full py-3"
          icon={<ZapIcon className="h-4 w-4" />}
          onClick={runOptimization}
          disabled={solving}
        >
          {solving ? 'Solving…' : 'RUN PORT OPTIMIZATION'}
        </Button>
      </div>
    </>
  );
}
