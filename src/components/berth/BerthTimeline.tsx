import React, { useMemo } from 'react';
import { usePort } from '../../contexts/PortContext';
import { Panel } from '../ui/Panel';
import { fmtDuration, fmtNumber, fmtTime, hoursBetween } from '../../utils/geo';
import { cn } from '../../utils/ui';

export function BerthTimeline({ className }: {className?: string;}) {
  const { berths, optimization, vessels, derived, now, selectedVesselId, selectVessel } = usePort();

  const assignments = optimization?.assignments ?? [];

  const window = useMemo(() => {
    if (assignments.length === 0) {
      return { start: now, end: new Date(now.getTime() + 24 * 3600_000) };
    }
    const starts = assignments.map((a) => new Date(a.start).getTime());
    const ends = assignments.map((a) => new Date(a.end).getTime());
    const start = new Date(Math.min(now.getTime(), ...starts) - 3600_000);
    const end = new Date(Math.max(...ends) + 3600_000);
    return { start, end };
  }, [assignments, now]);

  const span = Math.max(1, hoursBetween(window.start, window.end));
  const pct = (d: Date | string) => hoursBetween(window.start, d) / span * 100;

  const ticks = useMemo(() => {
    const step = span > 36 ? 6 : span > 18 ? 3 : 2;
    const out: {label: string;left: number;}[] = [];
    for (let h = 0; h <= span; h += step) {
      const t = new Date(window.start.getTime() + h * 3600_000);
      out.push({ label: fmtTime(t), left: h / span * 100 });
    }
    return out;
  }, [span, window.start]);

  return (
    <Panel
      eyebrow={`Plan window ${fmtTime(window.start)} → ${fmtTime(window.end)}`}
      title="Berth Allocation Timeline"
      className={className}
      bodyClassName="p-0">
      
      <div className="overflow-x-auto">
        <div className="min-w-[760px] px-4 pb-5 pt-3">
          <div className="relative mb-2 ml-[110px] h-5 border-b border-line">
            {ticks.map((t) =>
            <span
              key={t.label + t.left}
              className="absolute -translate-x-1/2 font-mono text-[9px] text-mist"
              style={{ left: `${t.left}%` }}>
              
                {t.label}
              </span>
            )}
          </div>

          <div className="space-y-2.5">
            {berths.map((berth) => {
              const rowAssignments = assignments.filter((a) => a.berthId === berth.id);
              return (
                <div key={berth.id} className="flex items-center gap-3">
                  <div className="w-[98px] shrink-0">
                    <p className="font-display text-[11px] font-semibold uppercase tracking-wider text-chalk">
                      {berth.name}
                    </p>
                    <p className="font-mono text-[9px] text-mist">
                      {berth.maxLoa}m · {berth.maxDraft}m
                    </p>
                  </div>
                  <div
                    className={cn(
                      'relative h-12 flex-1 overflow-hidden rounded-md border border-line bg-abyss/70 np-grid-fine',
                      berth.status === 'maintenance' && 'opacity-50'
                    )}>
                    
                    {berth.status === 'maintenance' &&
                    <span className="absolute inset-0 grid place-items-center font-mono text-[10px] tracking-wider text-mist">
                        MAINTENANCE — EXCLUDED FROM ALLOCATION
                      </span>
                    }

                    <span
                      className="absolute inset-y-0 z-20 w-px bg-aqua/70"
                      style={{ left: `${Math.max(0, Math.min(100, pct(now)))}%` }}
                      aria-hidden />
                    

                    {rowAssignments.map((a) => {
                      const vessel = vessels.find((v) => v.id === a.vesselId);
                      if (!vessel) return null;
                      const d = derived[vessel.id];
                      const left = Math.max(0, pct(a.start));
                      const width = Math.max(2, pct(a.end) - pct(a.start));
                      const risk = d?.spoilageRisk === 'breach';
                      const selected = selectedVesselId === vessel.id;
                      const active =
                      now.getTime() >= new Date(a.start).getTime() &&
                      now.getTime() < new Date(a.end).getTime();
                      return (
                        <button
                          key={a.vesselId}
                          type="button"
                          onClick={() => selectVessel(vessel.id)}
                          title={`${vessel.id} · ${vessel.operator} · ${fmtTime(a.start)}–${fmtTime(
                            a.end
                          )} · wait ${fmtDuration(a.waitingHours)}`}
                          className={cn(
                            'absolute inset-y-1 z-10 overflow-hidden rounded border px-2 text-left transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-px',
                            risk ?
                            'border-crit/60 bg-crit/15 hover:border-crit' :
                            active ?
                            'border-ok/60 bg-ok/15 hover:border-ok' :
                            'border-aqua/45 bg-aqua/10 hover:border-aqua/80',
                            selected && 'ring-1 ring-aqua'
                          )}
                          style={{ left: `${left}%`, width: `${width}%` }}>
                          
                          <span className="block truncate font-mono text-[11px] font-semibold text-chalk">
                            {vessel.id}
                          </span>
                          <span className="block truncate font-mono text-[9px] text-mist">
                            {fmtNumber(vessel.loadTonnes)}t · {fmtDuration(vessel.unloadingHours)}
                          </span>
                        </button>);

                    })}

                    {rowAssignments.length === 0 && berth.status === 'operational' &&
                    <span className="absolute inset-0 grid place-items-center font-mono text-[10px] tracking-wider text-mist/60">
                        AVAILABLE
                      </span>
                    }
                  </div>
                </div>);

            })}
          </div>

          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[9px] text-mist">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm border border-ok/60 bg-ok/20" /> OCCUPIED NOW
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm border border-aqua/50 bg-aqua/15" /> SCHEDULED
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm border border-crit/60 bg-crit/20" /> DEADLINE RISK
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-px bg-aqua/70" /> CURRENT PORT TIME
            </span>
          </p>
        </div>
      </div>
    </Panel>);

}