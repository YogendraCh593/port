import React, { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import { TriangleAlertIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { DataRow } from '../components/ui/DataRow';
import { usePort } from '../contexts/PortContext';
import { useKpis } from '../hooks/useKpis';
import { api } from '../services/api';
import type { Analytics as AnalyticsData } from '../services/api';
import { fmtDuration, fmtNumber } from '../utils/geo';
import { cn } from '../utils/ui';

const axis = {
  tick: { fill: '#8BA2C6', fontSize: 10, fontFamily: 'JetBrains Mono' },
  axisLine: { stroke: '#1A2740' },
  tickLine: false,
} as const;
const tooltipStyle = {
  background: '#0A1120', border: '1px solid #1A2740',
  borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11,
} as const;

export function Analytics() {
  const { vessels, derived, optimization } = usePort();
  const k = useKpis();

  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    api.getAnalytics().then(setAnalyticsData).catch(console.error);
  }, []);

  const arrivalHistory = analyticsData?.arrival_history ?? [];
  const utilizationHistory = analyticsData?.utilization_history ?? [];

  const riskVessels = vessels
    .map((v) => ({ vessel: v, d: derived[v.id] }))
    .filter((r) => r.d && r.d.spoilageRisk !== 'none')
    .sort((a, b) => (a.d!.spoilageSlackHours ?? 0) - (b.d!.spoilageSlackHours ?? 0));

  const score = [{ name: 'score', value: k.optimizationScore, fill: '#A78BFA' }];

  return (
    <>
      <PageHeader
        eyebrow="Operational intelligence"
        title="Analytics"
        description="Seven-day operational history alongside the live allocation picture. Data sourced from the backend API."
      />

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel eyebrow="Last 7 days" title="Vessel Arrivals & Departures" className="xl:col-span-2">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={arrivalHistory} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="np-arr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }} />
                <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#8BA2C6' }} />
                <Area type="monotone" dataKey="arrivals" stroke="#22D3EE" strokeWidth={2} fill="url(#np-arr)" name="Arrivals" />
                <Area type="monotone" dataKey="departures" stroke="#3B82F6" strokeWidth={2} fill="transparent" name="Departures" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel eyebrow="Current plan" title="Optimization Performance">
          <div className="h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart data={score} innerRadius="72%" outerRadius="100%" startAngle={210} endAngle={-30}>
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={8} background={{ fill: '#101A2C' }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <p className="-mt-[118px] text-center font-display text-3xl font-semibold text-chalk">
              {k.optimizationScore}%
            </p>
          </div>
          <dl className="mt-2">
            <DataRow label="Objective" value={fmtNumber(optimization?.objectiveValue ?? 0, 2)} />
            <DataRow label="Iterations" value={fmtNumber(optimization?.iterations ?? 0)} />
            <DataRow label="Avg Waiting" value={fmtDuration(k.avgWaitingHours)} tone="text-warn" />
          </dl>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel eyebrow="24 h profile" title="Berth vs Crane Utilization">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={utilizationHistory} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis dataKey="hour" unit="h" {...axis} />
                <YAxis unit="%" domain={[0, 100]} {...axis} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }} />
                <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#8BA2C6' }} />
                <Line type="monotone" dataKey="berth" stroke="#3B82F6" strokeWidth={2} dot={false} name="Berth %" />
                <Line type="monotone" dataKey="crane" stroke="#14B8A6" strokeWidth={2} dot={false} name="Crane %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel eyebrow="Throughput" title="Cargo & TEU Volume">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={arrivalHistory} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis yAxisId="t" {...axis} axisLine={false} width={54} />
                <YAxis yAxisId="teu" orientation="right" {...axis} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }} />
                <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#8BA2C6' }} />
                <Bar yAxisId="t" dataKey="tonnes" fill="#14B8A6" fillOpacity={0.55} radius={[3,3,0,0]} maxBarSize={26} name="Tonnes" />
                <Line yAxisId="teu" type="monotone" dataKey="teu" stroke="#22D3EE" strokeWidth={2} dot={false} name="TEU" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel eyebrow="Queue health" title="Average Waiting Time">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={arrivalHistory} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis unit="h" {...axis} axisLine={false} />
                <Tooltip cursor={{ fill: 'rgba(245,165,36,0.06)' }} contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }} formatter={(v: number) => [`${v} h`, 'Avg waiting']} />
                <Bar dataKey="waiting" fill="#F5A524" radius={[3,3,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel eyebrow="Forecast quality" title="ETA Accuracy">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={arrivalHistory} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                <defs>
                  <linearGradient id="np-eta" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34D399" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(40,57,90,0.5)" vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis unit="%" domain={[70, 100]} {...axis} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#E8EFF9' }} formatter={(v: number) => [`${v}%`, 'ETA accuracy']} />
                <Area type="monotone" dataKey="eta_accuracy" stroke="#34D399" strokeWidth={2} fill="url(#np-eta)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Spoilage risk table */}
      <Panel
        eyebrow={`${riskVessels.length} flagged`}
        title="Spoilage-Risk Vessels"
        className="mt-3"
        bodyClassName="p-0"
      >
        {riskVessels.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-mist">
            No time-sensitive cargo is at risk under the current plan.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-line/70 bg-abyss/40">
                  {['Vessel', 'Cargo', 'Load', 'Slack', 'Risk'].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riskVessels.map(({ vessel, d }) => (
                  <tr key={vessel.id} className="border-b border-line/50">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-chalk">
                      {vessel.id}
                      <span className="block text-[10px] text-mist">{vessel.operator}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-mist">{vessel.cargoType}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-chalk">{fmtNumber(vessel.loadTonnes)} t</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-chalk">{fmtDuration(d!.spoilageSlackHours ?? 0)}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('inline-flex items-center gap-1.5 font-mono text-[10px]', d!.spoilageRisk === 'breach' ? 'text-crit' : 'text-warn')}>
                        <TriangleAlertIcon className="h-3 w-3" aria-hidden />
                        {d!.spoilageRisk.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
