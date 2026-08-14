import React, { useEffect, useRef } from 'react';
import {
  PlayIcon, PauseIcon, RotateCcwIcon,
  AnchorIcon, GaugeIcon, ChevronLeftIcon, ChevronRightIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { StatusDot } from '../components/ui/StatusDot';
import { ProgressBar } from '../components/ui/ProgressBar';
import { PortMap } from '../components/map/PortMap';
import { AnchorageZone } from '../components/berth/AnchorageZone';
import { VesselDetailPanel } from '../components/vessel/VesselDetailPanel';
import { usePort } from '../contexts/PortContext';
import { statusLabel, statusToken, vesselProgress } from '../utils/fleet';
import { fmtDate, fmtClock, fmtNumber } from '../utils/geo';
import { cn } from '../utils/ui';

const speeds = [1, 30, 60, 300, 900];

export function PortSimulation() {
  const {
    now, playing, speed, play, pause, reset, setSpeed,
    vessels, derived, advanceSim, refreshMap, mapSnapshot,
  } = usePort();

  // Auto-refresh map snapshot every 10 s while playing
  const intervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (playing) {
      intervalRef.current = window.setInterval(() => {
        refreshMap();
      }, 10_000);
    } else {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, [playing, refreshMap]);

  const tracked = vessels
    .filter((v) => v.status === 'approaching')
    .map((v) => ({
      vessel: v,
      progress: derived[v.id] ? vesselProgress(v, derived[v.id], now) : 0,
    }))
    .sort((a, b) => b.progress - a.progress);

  const counters = mapSnapshot?.counters ?? { approaching: 0, waiting: 0, servicing: 0 };

  return (
    <>
      <PageHeader
        eyebrow="Time-stepped operations model"
        title="Port Simulation"
        description="Real satellite view of the port. Advance the simulation clock to watch approach tracks, berth occupancy and anchorage holding evolve in real-time on the map."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Play / Pause / Reset */}
            <div className="flex items-center gap-1 rounded-lg border border-line bg-deck/70 p-1">
              <Button
                size="sm"
                variant={playing ? 'primary' : 'ghost'}
                icon={<PlayIcon className="h-3 w-3" />}
                onClick={play}
                disabled={playing}
              >
                Play
              </Button>
              <Button
                size="sm"
                variant={!playing ? 'primary' : 'ghost'}
                icon={<PauseIcon className="h-3 w-3" />}
                onClick={pause}
                disabled={!playing}
              >
                Pause
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcwIcon className="h-3 w-3" />}
                onClick={reset}
              >
                Reset
              </Button>
            </div>

            {/* Step buttons */}
            <div className="flex items-center gap-1 rounded-lg border border-line bg-deck/70 p-1">
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronLeftIcon className="h-3 w-3" />}
                onClick={() => advanceSim(-15)}
              >
                −15 m
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronRightIcon className="h-3 w-3" />}
                onClick={() => advanceSim(15)}
              >
                +15 m
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => advanceSim(60)}
              >
                +1 h
              </Button>
            </div>

            {/* Speed selector */}
            <div className="flex items-center gap-1 rounded-lg border border-line bg-deck/70 p-1">
              <GaugeIcon className="ml-1.5 h-3.5 w-3.5 text-mist" aria-hidden />
              {speeds.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={cn(
                    'rounded px-2 py-1 font-mono text-[10px] transition-colors duration-150 ease-out',
                    speed === s
                      ? 'bg-aqua/15 text-aqua'
                      : 'text-mist hover:bg-white/[0.05] hover:text-chalk',
                  )}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="grid gap-3 xl:grid-cols-4">
        {/* ── Satellite map ── */}
        <Panel
          eyebrow="Live satellite view"
          title="Port Visualization"
          className="xl:col-span-3"
          bodyClassName="p-0"
          actions={
            <span className={cn(
              'flex items-center gap-2 font-mono text-[11px]',
              playing ? 'text-aqua' : 'text-mist',
            )}>
              <StatusDot color={playing ? 'bg-aqua' : 'bg-mist'} pulse={playing} />
              {playing ? `RUNNING ${speed}×` : 'HELD'}
            </span>
          }
        >
          {/* Simulation clock bar */}
          <div className="border-b border-line px-4 py-3">
            <p className="font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
              Simulation Time
            </p>
            <p className="font-mono text-xl tabular-nums text-chalk">
              {fmtDate(now).toUpperCase()}{' '}
              <span className="text-aqua">{fmtClock(now)}</span>
            </p>
            {/* Live counters */}
            <div className="mt-2 flex gap-4">
              <span className="font-mono text-[10px]">
                <span className="text-aqua">{counters.approaching}</span>
                <span className="ml-1 text-mist">approaching</span>
              </span>
              <span className="font-mono text-[10px]">
                <span className="text-warn">{counters.waiting}</span>
                <span className="ml-1 text-mist">at anchorage</span>
              </span>
              <span className="font-mono text-[10px]">
                <span className="text-ok">{counters.servicing}</span>
                <span className="ml-1 text-mist">servicing</span>
              </span>
            </div>
          </div>

          {/* Map fills remaining height */}
          <div style={{ position: 'relative', height: 560 }}>
            <PortMap />
          </div>
        </Panel>

        {/* ── Right column ── */}
        <div className="space-y-3">
          {/* Approach progress list */}
          <Panel
            eyebrow={`${tracked.length} on approach`}
            title="Approach Progress"
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-line/70">
              {tracked.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-mist">
                  No vessels currently on an approach leg.
                </li>
              )}
              {tracked.map(({ vessel, progress }) => {
                const d = derived[vessel.id];
                const token = statusToken[vessel.status];
                return (
                  <li key={vessel.id} className="px-4 py-3">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[12px] font-semibold text-chalk">
                        {vessel.id}
                      </span>
                      <span className={cn('font-mono text-[10px]', token.text)}>
                        {statusLabel[vessel.status]}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-aqua">
                        {Math.round(progress * 100)}%
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={progress * 100} tone="bg-aqua" />
                    </div>
                    <p className="mt-1.5 font-mono text-[10px] text-mist">
                      {d ? `${fmtNumber(d.distanceKm * (1 - progress))} km remaining` : '—'}{' '}
                      · {vessel.speedKnots} kn
                    </p>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <VesselDetailPanel />
        </div>
      </div>

      {/* ── Anchorage zone table ── */}
      <div className="mt-3 grid gap-3">
        <AnchorageZone />
      </div>

      <p className="mt-3 flex items-center gap-2 font-mono text-[10px] text-mist/70">
        <AnchorIcon className="h-3 w-3" aria-hidden />
        Satellite layer: Esri World Imagery. Street layer: OpenStreetMap.
        Ship positions update every 10 s while playing.
      </p>
    </>
  );
}
