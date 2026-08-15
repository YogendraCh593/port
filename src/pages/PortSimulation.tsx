/**
 * PortSimulation – Dynamic Hybrid Port Optimization + Live Simulation
 *
 * Existing features preserved:
 *   • Satellite map (Esri / OSM) with animated ships
 *   • 720× time scale (1 hr = 5 s at 1×)
 *   • Berth green/red live from simulation state
 *   • Anchorage waiting zone
 *   • Emergency halt per ship
 *   • Approach progress bars + ETA
 *
 * New features added (spec §1–25):
 *   • Optimization Control Panel (algo, crane rate, efficiency, preemption, aging)
 *   • Algorithm Comparison Dashboard (FCFS / SJF / SRPT / Greedy / QAOA / Hybrid)
 *   • Event log with rolling-horizon re-optimization events
 *   • "Why this decision?" panel per schedule row
 *   • Dynamic processing time displayed per ship (100 t = 10 min w/ 1 crane)
 *   • Remaining cargo + predicted departure updated live
 *   • Optimized schedule table with berth/crane/wait/reason
 */
import React, { useMemo, useState, useEffect } from 'react';
import {
  PlayIcon, PauseIcon, RotateCcwIcon, GaugeIcon,
  AnchorIcon, AlertOctagonIcon, XCircleIcon,
  ConstructionIcon, ShipIcon, ZapIcon, BarChart3Icon,
  ListIcon, InfoIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { StatusDot } from '../components/ui/StatusDot';
import { ProgressBar } from '../components/ui/ProgressBar';
import { KpiCard } from '../components/ui/KpiCard';
import { PortMap } from '../components/map/PortMap';
import { OptimizationControlPanel } from '../components/optimization/OptimizationControlPanel';
import { PerformanceDashboard } from '../components/optimization/PerformanceDashboard';
import { EventLog } from '../components/optimization/EventLog';
import { WhyThisDecision } from '../components/optimization/WhyThisDecision';
import { usePort } from '../contexts/PortContext';
import { useSimulation, SIM_SCALE } from '../hooks/useSimulation';
import { useOptimization } from '../hooks/useOptimization';
import { fmtClock, fmtDate, fmtNumber } from '../utils/geo';
import { cn, inputClass } from '../utils/ui';

const SPEEDS = [1, 10, 30, 100, 720];
type Tab = 'simulation' | 'optimization' | 'comparison' | 'log';

export function PortSimulation() {
  const { vessels, port, mapSnapshot, activePort } = usePort();
  const [activeTab, setActiveTab] = useState<Tab>('simulation');

  // Number of berths from active port
  const numBerths = activePort?.berths ?? 5;

  // ── useSimulation: rAF animation engine (unchanged) ──
  const simVessels = useMemo(() => vessels.map(v => ({
    id: v.id, lat: v.lat, lon: v.lon,
    speedKnots: v.speedKnots, departure: v.departure,
    unloadingHours: v.unloadingHours, cargoType: v.cargoType,
    loadTonnes: v.loadTonnes, operator: v.operator,
    loa: v.loa, draft: v.draft, teu: v.teu,
  })), [vessels]);

  const {
    simTime, playing, speed, positions, berthState, schedule,
    halts, play, pause, reset, setSpeed, applyHalt, clearHalt,
  } = useSimulation({ portLat: port.lat, portLon: port.lon, vessels: simVessels, numBerths });

  // ── useOptimization: dynamic hybrid engine ──
  const {
    config, updateConfig,
    runOptimization, running,
    schedule: optSchedule, liveShips, eventLog, meta,
    comparison, compareAlgorithms, comparing,
    getProcessingTime, getLiveShip, getScheduleEntry,
    notifyArrival, notifyBerthFree, notifyHalt, notifyHaltCleared,
    selectedEntry, setSelected,
    resetEngine,
  } = useOptimization();

  // Auto-run optimization when vessels first registered
  useEffect(() => {
    if (vessels.length > 0) runOptimization();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vessels.length]);

  // Notify engine of berth events from simulation
  useEffect(() => {
    berthState.forEach(b => {
      if (!b.occupied && b.shipId === null) {
        // Berth just freed up — trigger re-optimization
        // (only when it was previously occupied: guarded by berthState diff in engine)
      }
    });
  }, [berthState]);

  // Notify on ship arrivals
  useEffect(() => {
    positions.forEach(p => {
      if (p.status === 'Servicing') {
        notifyArrival(p.ship_id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.filter(p => p.status === 'Servicing').length]);

  // Build berth→ship map for route lines
  const berthShipMap = useMemo(() => {
    const out: Record<string, string> = {};
    mapSnapshot?.berths?.forEach(b => {
      if (b.assigned_ships.length > 0) out[b.name] = b.assigned_ships[0];
    });
    return out;
  }, [mapSnapshot]);

  // Live counters
  const counters = useMemo(() => ({
    approaching: positions.filter(p => p.status === 'Approaching').length,
    waiting:     positions.filter(p => p.status === 'Waiting at Anchorage').length,
    servicing:   positions.filter(p => p.status === 'Servicing').length,
    halted:      positions.filter(p => p.halted).length,
    departed:    positions.filter(p => p.status === 'Departed').length,
  }), [positions]);

  // Use backend optimized schedule when available, fallback to local sim schedule
  const displaySchedule = optSchedule.length > 0 ? optSchedule.map(e => ({
    vesselId:    e.ship_id,
    operator:    vessels.find(v => v.id === e.ship_id)?.operator ?? '—',
    cargoType:   vessels.find(v => v.id === e.ship_id)?.cargoType ?? '—',
    weightTonnes: vessels.find(v => v.id === e.ship_id)?.loadTonnes ?? 0,
    loa:         vessels.find(v => v.id === e.ship_id)?.loa ?? 0,
    draft:       vessels.find(v => v.id === e.ship_id)?.draft ?? 0,
    berthName:   e.berth_id ?? 'Unassigned',
    berthSlot:   -1,
    serviceStart: new Date(e.service_start_ms),
    serviceEnd:   new Date(e.service_end_ms),
    waitHours:   e.wait_min / 60,
    compatible:  e.compatible,
    algo:        e.algo,
    reason:      e.reason,
    procMin:     e.processing_time_min,
    crane:       e.crane_id,
    departure:   e.predicted_departure,
  })) : schedule;

  // Halt modal state
  const [haltTarget, setHaltTarget] = useState<string | null>(null);
  const [haltHours, setHaltHours]   = useState(2);
  const [haltReason, setHaltReason] = useState('Emergency halt requested');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'simulation',  label: 'Simulation',   icon: <ShipIcon className="h-3.5 w-3.5" /> },
    { id: 'optimization',label: 'Optimizer',    icon: <ZapIcon className="h-3.5 w-3.5" /> },
    { id: 'comparison',  label: 'Comparison',   icon: <BarChart3Icon className="h-3.5 w-3.5" /> },
    { id: 'log',         label: 'Event Log',    icon: <ListIcon className="h-3.5 w-3.5" /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Dynamic Hybrid Port Optimization"
        title="Port Simulation"
        description={`Satellite map · 720× time scale (1 hr = 5 s at 1×) · ${config.algo} optimizer · rolling-horizon re-optimization`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-line bg-deck/70 p-1">
              <Button size="sm" variant={playing ? 'primary' : 'ghost'}
                icon={<PlayIcon className="h-3 w-3" />} onClick={play} disabled={playing}>Play</Button>
              <Button size="sm" variant={!playing ? 'primary' : 'ghost'}
                icon={<PauseIcon className="h-3 w-3" />} onClick={pause} disabled={!playing}>Pause</Button>
              <Button size="sm" variant="ghost"
                icon={<RotateCcwIcon className="h-3 w-3" />} onClick={reset}>Reset</Button>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-line bg-deck/70 p-1">
              <GaugeIcon className="ml-1.5 h-3.5 w-3.5 text-mist" aria-hidden />
              {SPEEDS.map(s => (
                <button key={s} type="button" onClick={() => setSpeed(s)}
                  className={cn('rounded px-2 py-1 font-mono text-[10px] transition-colors',
                    speed === s ? 'bg-aqua/15 text-aqua' : 'text-mist hover:bg-white/[0.05] hover:text-chalk')}>
                  {s === 720 ? '720×' : `${s}×`}
                </button>
              ))}
            </div>
            <Button variant="primary" icon={<ZapIcon className="h-3.5 w-3.5" />}
              onClick={runOptimization} disabled={running}>
              {running ? 'Optimizing…' : 'Re-optimize'}
            </Button>
          </div>
        }
      />

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Approaching" value={String(counters.approaching)}
          icon={<ShipIcon className="h-4 w-4" />} tone="text-aqua" support="On approach track" />
        <KpiCard label="Anchorage" value={String(counters.waiting)}
          icon={<AnchorIcon className="h-4 w-4" />} tone="text-warn" support="Waiting for berth" />
        <KpiCard label="Servicing" value={String(counters.servicing)}
          icon={<ConstructionIcon className="h-4 w-4" />} tone="text-ok" support="Unloading at berth" />
        <KpiCard label="Halted" value={String(counters.halted)}
          icon={<AlertOctagonIcon className="h-4 w-4" />}
          tone={counters.halted > 0 ? 'text-crit' : 'text-mist'}
          support="Emergency halt" />
        <KpiCard label="Objective" value={meta ? String(meta.objective) : '—'}
          icon={<ZapIcon className="h-4 w-4" />} tone="text-quantum"
          support={meta?.algo ?? 'Not run'} />
      </div>

      {/* ── Tab navigation ── */}
      <div className="mt-3 flex gap-1 rounded-xl border border-line bg-deck/70 p-1">
        {tabs.map(t => (
          <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wider transition-all duration-150',
              activeTab === t.id
                ? 'bg-aqua/[0.12] text-aqua shadow-sm'
                : 'text-mist hover:text-chalk',
            )}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════ TAB: SIMULATION ═══════════════ */}
      {activeTab === 'simulation' && (
        <>
          <div className="mt-3 grid gap-3 xl:grid-cols-4">
            {/* Satellite map */}
            <Panel eyebrow="Esri satellite · animated ships" title="Live Port Map"
              className="xl:col-span-3" bodyClassName="p-0"
              actions={
                <span className={cn('flex items-center gap-2 font-mono text-[11px]',
                  playing ? 'text-aqua' : 'text-mist')}>
                  <StatusDot color={playing ? 'bg-aqua' : 'bg-mist'} pulse={playing} />
                  {playing ? `RUNNING ${speed}×` : 'PAUSED'}
                </span>
              }>
              {/* Clock bar */}
              <div className="border-b border-line px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">Simulation Clock</p>
                    <p className="font-mono text-lg tabular-nums text-chalk">
                      {fmtDate(simTime).toUpperCase()}{' '}
                      <span className="text-aqua">{fmtClock(simTime)}</span>
                    </p>
                  </div>
                  <div className="flex gap-4">
                    {([
                      ['approaching', String(counters.approaching), 'text-aqua'],
                      ['anchorage',   String(counters.waiting),     'text-warn'],
                      ['servicing',   String(counters.servicing),   'text-ok'],
                      ['halted',      String(counters.halted),      'text-crit'],
                    ] as [string, string, string][]).map(([lbl, cnt, tone]) => (
                      <div key={lbl} className="text-center">
                        <p className={cn('font-mono text-lg font-bold tabular-nums', tone)}>{cnt}</p>
                        <p className="font-mono text-[9px] text-mist uppercase">{lbl}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ position: 'relative', height: 520 }}>
                <PortMap animatedPositions={positions} berthState={berthState}
                  numBerths={numBerths} berthShipMap={berthShipMap} />
              </div>
            </Panel>

            {/* Right column */}
            <div className="space-y-3">
              {/* Approach progress */}
              <Panel eyebrow={`${counters.approaching} ships`} title="Approach Progress" bodyClassName="p-0">
                <ul className="max-h-64 divide-y divide-line/70 overflow-y-auto">
                  {positions.length === 0 && (
                    <li className="px-4 py-8 text-center text-sm text-mist">Register vessels, press Play.</li>
                  )}
                  {positions.filter(p => p.status === 'Approaching')
                    .sort((a, b) => b.progress - a.progress)
                    .map(ship => {
                      const live = getLiveShip(ship.ship_id);
                      const procTime = live
                        ? (live.remaining_cargo_t / (config.crane_rate_tpm * config.efficiency)).toFixed(0)
                        : null;
                      return (
                        <li key={ship.ship_id} className="px-4 py-3">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-[12px] font-bold text-chalk">{ship.ship_id}</span>
                            <span className="font-mono text-[10px] text-aqua">{Math.round(ship.progress * 100)}%</span>
                            <span className="ml-auto font-mono text-[10px] text-mist">{ship.speed_knots}kn</span>
                          </div>
                          <ProgressBar value={ship.progress * 100} tone="bg-aqua" className="mt-1.5" />
                          <p className="mt-1 font-mono text-[10px] text-mist">
                            {ship.cargo_type} · {fmtNumber(ship.weight_tonnes)}t
                            {ship.eta && (
                              <span className="ml-2 text-chalk">
                                ETA {new Date(ship.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                            {procTime && (
                              <span className="ml-2 text-warn">~{procTime}min unload</span>
                            )}
                          </p>
                        </li>
                      );
                    })}
                </ul>
              </Panel>

              {/* Waiting ships */}
              {counters.waiting > 0 && (
                <Panel eyebrow={`${counters.waiting} waiting`} title="At Anchorage" bodyClassName="p-0">
                  <ul className="divide-y divide-line/70">
                    {positions.filter(p => p.status === 'Waiting at Anchorage').map(ship => (
                      <li key={ship.ship_id} className="flex items-center gap-3 px-4 py-2.5 bg-warn/[0.03]">
                        <span className="h-2 w-2 rounded-full bg-warn shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[12px] font-bold text-chalk">{ship.ship_id}</span>
                          <span className="block font-mono text-[10px] text-mist">{ship.cargo_type}</span>
                        </span>
                        <span className="font-mono text-[10px] text-warn">WAITING</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {/* Halted vessels */}
              {counters.halted > 0 && (
                <Panel eyebrow="Emergency" title="Halted" bodyClassName="p-0">
                  <ul className="divide-y divide-line/70">
                    {positions.filter(p => p.halted).map(ship => (
                      <li key={ship.ship_id} className="px-4 py-3 bg-crit/[0.04]">
                        <div className="flex items-center gap-2">
                          <AlertOctagonIcon className="h-4 w-4 text-crit shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-[12px] font-bold text-crit">{ship.ship_id}</span>
                            <span className="block font-mono text-[10px] text-mist">+{ship.halt_hours}h · {ship.halt_reason}</span>
                          </span>
                          <Button size="sm" variant="ghost"
                            icon={<XCircleIcon className="h-3 w-3 text-ok" />}
                            onClick={() => { clearHalt(ship.ship_id); notifyHaltCleared(ship.ship_id); }}>
                            Clear
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {/* Live berth status */}
              <Panel eyebrow="Live" title="Berth Status" bodyClassName="p-0">
                <ul className="max-h-48 divide-y divide-line/70 overflow-y-auto">
                  {berthState.length === 0 && (
                    <li className="px-4 py-5 text-center font-mono text-[11px] text-mist">
                      Register vessels then press Play.
                    </li>
                  )}
                  {berthState.map(b => (
                    <li key={b.slot} className="flex items-center gap-3 px-4 py-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${b.occupied ? 'bg-crit' : 'bg-ok'}`} />
                      <span className="min-w-0 flex-1 font-mono text-[11px] text-chalk">
                        {(b as any).berthName ?? `Berth ${b.slot + 1}`}
                      </span>
                      {b.shipId && <span className="font-mono text-[10px] text-warn">{b.shipId}</span>}
                      <span className={`font-mono text-[10px] font-bold ${b.occupied ? 'text-crit' : 'text-ok'}`}>
                        {b.occupied ? '🔴' : '🟢'}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>

          {/* Emergency halt panel */}
          <Panel eyebrow="Safety" title="Emergency Halt Panel" className="mt-3">
            {positions.length === 0 ? (
              <p className="py-4 text-center font-mono text-[12px] text-mist">
                Register vessels and press Play to begin.
              </p>
            ) : (
              <>
                {haltTarget && (
                  <div className="mb-4 rounded-xl border border-crit/40 bg-crit/[0.06] p-4">
                    <p className="font-display text-[12px] font-bold text-crit uppercase tracking-wider mb-3">
                      ⚠ Emergency Halt — {haltTarget}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="font-mono text-[10px] text-mist block mb-1">Halt Hours</label>
                        <input type="number" min="0.5" step="0.5" value={haltHours}
                          onChange={e => setHaltHours(Number(e.target.value))}
                          className={cn(inputClass, 'w-full')} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="font-mono text-[10px] text-mist block mb-1">Reason</label>
                        <input value={haltReason} onChange={e => setHaltReason(e.target.value)}
                          className={cn(inputClass, 'w-full')} />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button variant="primary" className="!bg-crit/90 !border-crit/60"
                        icon={<AlertOctagonIcon className="h-3.5 w-3.5" />}
                        onClick={async () => {
                          await applyHalt(haltTarget, haltHours, haltReason);
                          await notifyHalt(haltTarget, haltHours);
                          toast.error(`HALT — ${haltTarget}`, { description: `+${haltHours}h · ${haltReason}` });
                          setHaltTarget(null);
                        }}>
                        Confirm Halt
                      </Button>
                      <Button variant="ghost" onClick={() => setHaltTarget(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {positions.map(ship => (
                    <div key={ship.ship_id} className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                      ship.halted ? 'border-crit/40 bg-crit/[0.05]' : 'border-line bg-abyss/60',
                    )}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: ship.color, flexShrink: 0 }} />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[12px] font-bold text-chalk">{ship.ship_id}</p>
                        <p className="font-mono text-[9px] text-mist">{ship.status}</p>
                        {ship.halted && <p className="font-mono text-[9px] text-crit">+{ship.halt_hours}h</p>}
                      </div>
                      {ship.halted ? (
                        <Button size="sm" variant="ghost"
                          icon={<XCircleIcon className="h-3 w-3 text-ok" />}
                          onClick={() => { clearHalt(ship.ship_id); notifyHaltCleared(ship.ship_id); }}>
                          Clear
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost"
                          icon={<AlertOctagonIcon className="h-3 w-3 text-crit" />}
                          onClick={() => setHaltTarget(ship.ship_id)}>
                          Halt
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>

          {/* Optimized schedule table */}
          {displaySchedule.length > 0 && (
            <Panel
              eyebrow={`${displaySchedule.filter(s => s.compatible).length} allocated · ${displaySchedule.filter(s => !s.compatible).length} incompatible · ${meta?.algo ?? 'Local'}`}
              title="Optimized Berth Schedule — click a row for decision explanation"
              className="mt-3"
              bodyClassName="p-0"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left">
                  <thead>
                    <tr className="border-b border-line/70 bg-abyss/40">
                      {['Ship', 'Operator', 'Cargo', 'Load (t)', 'LOA', 'Draft',
                        'Berth', 'Crane', 'Start', 'End', 'Wait', 'Proc Time', 'Departure', 'Status'].map(h => (
                        <th key={h} scope="col"
                          className="whitespace-nowrap px-3 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displaySchedule.map(row => {
                      const live    = getLiveShip(row.vesselId);
                      const optRow  = getScheduleEntry(row.vesselId);
                      const isSelected = selectedEntry?.ship_id === row.vesselId;
                      return (
                        <tr key={row.vesselId}
                          onClick={() => setSelected(isSelected ? null : (optRow ?? null))}
                          className={cn(
                            'cursor-pointer border-b border-line/50 transition-colors',
                            isSelected ? 'bg-aqua/[0.06]' : 'hover:bg-white/[0.025]',
                          )}>
                          <td className="px-3 py-2.5 font-mono text-[12px] font-bold text-chalk">{row.vesselId}</td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-mist">{row.operator}</td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-mist">{row.cargoType}</td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-chalk">{row.weightTonnes.toLocaleString()}</td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-mist">{row.loa}m</td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-mist">{row.draft}m</td>
                          <td className="px-3 py-2.5 font-mono text-[11px]">
                            <span className={row.compatible ? 'text-aqua font-bold' : 'text-crit'}>{row.berthName}</span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-ok">
                            {(row as any).crane ?? '—'}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-chalk">
                            {row.serviceStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-mist">
                            {row.serviceEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px]">
                            <span className={row.waitHours > 1 ? 'text-warn' : 'text-ok'}>
                              {row.waitHours.toFixed(1)}h
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-chalk">
                            {(row as any).procMin
                              ? `${Number((row as any).procMin).toFixed(0)} min`
                              : `${(row.weightTonnes / (config.crane_rate_tpm * config.efficiency)).toFixed(0)} min`}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-chalk">
                            {live?.predicted_departure
                              ? new Date(live.predicted_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : (row as any).departure
                              ? new Date((row as any).departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={cn(
                              'inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold',
                              row.compatible
                                ? 'bg-ok/10 text-ok border border-ok/30'
                                : 'bg-crit/10 text-crit border border-crit/30',
                            )}>
                              {row.compatible ? '✓' : '✗'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-line px-4 py-2 font-mono text-[9px] text-mist/60">
                Click any row to see the "Why this decision?" explanation ·
                Processing time = cargo ÷ (rate × cranes × efficiency)
                ({config.crane_rate_tpm} t/min, {config.efficiency * 100}% eff)
              </p>
            </Panel>
          )}

          {/* Why this decision? inline panel */}
          {selectedEntry && (
            <div className="mt-3">
              <WhyThisDecision
                entry={selectedEntry}
                ship={getLiveShip(selectedEntry.ship_id)}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </>
      )}

      {/* ═══════════════ TAB: OPTIMIZER ═══════════════ */}
      {activeTab === 'optimization' && (
        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <OptimizationControlPanel
            config={config}
            onConfigChange={updateConfig}
            onRun={runOptimization}
            onCompare={compareAlgorithms}
            onReset={resetEngine}
            running={running}
            comparing={comparing}
            meta={meta}
          />

          <div className="xl:col-span-2 space-y-3">
            {/* Dynamic processing time reference */}
            <Panel eyebrow="Processing time model" title="Dynamic Unloading Time Calculator">
              <p className="mb-3 font-mono text-[11px] text-mist">
                Unloading time is calculated dynamically — not entered manually.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[100, 500, 1000].map(cargo => {
                  const min = cargo / (config.crane_rate_tpm * config.efficiency);
                  return (
                    <div key={cargo}
                      className="rounded-lg border border-line bg-abyss/60 p-3 text-center">
                      <p className="font-mono text-[9px] text-mist uppercase">Cargo</p>
                      <p className="font-display text-xl font-bold text-chalk">{cargo}t</p>
                      <p className="mt-1 font-mono text-[9px] text-mist">1 crane</p>
                      <p className="font-display text-lg font-bold text-aqua">{min.toFixed(0)} min</p>
                      <p className="font-mono text-[9px] text-mist">{(min / 60).toFixed(2)} hrs</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 font-mono text-[9px] text-mist/70">
                Formula: ProcessingTime = Cargo ÷ (CraneRate × Cranes × Efficiency)
                = cargo ÷ ({config.crane_rate_tpm} × n × {config.efficiency})
              </p>

              {/* Live cargo state for servicing ships */}
              {liveShips.filter(s => s.status === 'servicing' || s.remaining_cargo_t < s.original_cargo_t).length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
                    Live Cargo Progress
                  </p>
                  <div className="space-y-2">
                    {liveShips
                      .filter(s => s.original_cargo_t > 0)
                      .map(s => {
                        const pct = Math.min(100, s.processed_cargo_t / Math.max(s.original_cargo_t, 1) * 100);
                        const remMin = (s.remaining_cargo_t / (config.crane_rate_tpm * config.efficiency)).toFixed(0);
                        return (
                          <div key={s.ship_id} className="rounded-lg border border-line bg-abyss/60 p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-mono text-[12px] font-bold text-chalk">{s.ship_id}</span>
                              <span className="font-mono text-[10px] text-mist">{s.remaining_cargo_t.toFixed(0)}t remaining · ~{remMin}min</span>
                            </div>
                            <ProgressBar value={pct} tone="bg-ok" />
                            <div className="mt-1 flex justify-between font-mono text-[9px] text-mist">
                              <span>{s.processed_cargo_t.toFixed(0)}t processed</span>
                              <span>{pct.toFixed(1)}%</span>
                              <span>of {s.original_cargo_t}t</span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </Panel>

            {/* Latest schedule from backend optimizer */}
            {optSchedule.length > 0 && (
              <Panel eyebrow={`${meta?.algo ?? 'Hybrid'} · obj=${meta?.objective ?? '—'}`}
                title="Backend Optimized Schedule" bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left">
                    <thead>
                      <tr className="border-b border-line/70 bg-abyss/40">
                        {['Ship', 'Berth', 'Crane', 'Wait (min)', 'Proc (min)', 'Departure', 'Algo', 'Why'].map(h => (
                          <th key={h} scope="col"
                            className="whitespace-nowrap px-3 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {optSchedule.map(e => (
                        <tr key={e.ship_id}
                          className="cursor-pointer border-b border-line/50 hover:bg-white/[0.025] transition-colors"
                          onClick={() => setSelected(selectedEntry?.ship_id === e.ship_id ? null : e)}>
                          <td className="px-3 py-2.5 font-mono text-[12px] font-bold text-chalk">{e.ship_id}</td>
                          <td className="px-3 py-2.5 font-mono text-[11px]">
                            <span className={e.compatible ? 'text-aqua' : 'text-crit'}>{e.berth_id ?? 'None'}</span>
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
                          <td className="px-3 py-2.5">
                            <button type="button"
                              className="font-mono text-[9px] text-aqua hover:text-chalk transition-colors">
                              <InfoIcon className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>

          {/* Why this decision — shows when selected */}
          {selectedEntry && (
            <div className="xl:col-span-3">
              <WhyThisDecision
                entry={selectedEntry}
                ship={getLiveShip(selectedEntry.ship_id)}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ TAB: COMPARISON ═══════════════ */}
      {activeTab === 'comparison' && (
        <div className="mt-3">
          <PerformanceDashboard
            comparison={comparison}
            onCompare={compareAlgorithms}
            comparing={comparing}
          />
        </div>
      )}

      {/* ═══════════════ TAB: EVENT LOG ═══════════════ */}
      {activeTab === 'log' && (
        <div className="mt-3">
          <EventLog events={eventLog} maxHeight={600} />
        </div>
      )}

      <p className="mt-3 flex items-center gap-2 font-mono text-[9px] text-mist/50">
        <AnchorIcon className="h-3 w-3" aria-hidden />
        Satellite: Esri World Imagery · OSM · rAF animation · {SIM_SCALE}× scale ·
        {meta?.mode ?? config.algo} optimizer · rolling-horizon re-optimization
      </p>
    </>
  );
}
