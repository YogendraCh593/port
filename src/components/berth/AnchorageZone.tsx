import React from 'react';
import { AnchorIcon, TriangleAlertIcon } from 'lucide-react';
import { usePort } from '../../contexts/PortContext';
import { Panel } from '../ui/Panel';
import { ProgressBar } from '../ui/ProgressBar';
import { DataRow } from '../ui/DataRow';
import { fmtDuration } from '../../utils/geo';
import { cn } from '../../utils/ui';

export function AnchorageZone({ className }: {className?: string;}) {
  const { optimization, vessels, selectedVesselId, selectVessel } = usePort();
  const entries = optimization?.anchorage ?? [];
  const worst = Math.max(1, ...entries.map((e) => e.waitingHours));

  const zones = ['ANCHORAGE ZONE A', 'ANCHORAGE ZONE B'];

  return (
    <Panel
      eyebrow={`${entries.length} vessels holding`}
      title="Anchorage / Waiting Area"
      className={className}
      bodyClassName="p-0">
      
      {entries.length === 0 ?
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <AnchorIcon className="h-6 w-6 text-ok/70" aria-hidden />
          <p className="text-sm text-mist">
            No vessels waiting — every allocated berth is free at its vessel's ETA.
          </p>
        </div> :

      <div className="divide-y divide-line/70">
          {zones.map((zone) => {
          const zoneEntries = entries.filter((e) => e.zone === zone);
          if (zoneEntries.length === 0) return null;
          return (
            <div key={zone} className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                  <h3 className="font-display text-[11px] font-semibold uppercase tracking-wider2 text-warn">
                    {zone}
                  </h3>
                  <span className="ml-auto font-mono text-[10px] text-mist">
                    {zoneEntries.length} HOLDING
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {zoneEntries.map((entry) => {
                  const vessel = vessels.find((v) => v.id === entry.vesselId);
                  const selected = selectedVesselId === entry.vesselId;
                  const risky = entry.spoilageRisk !== 'none';
                  return (
                    <button
                      key={entry.vesselId}
                      type="button"
                      onClick={() => selectVessel(entry.vesselId)}
                      className={cn(
                        'rounded-lg border bg-abyss/60 p-3 text-left transition-[transform,border-color] duration-200 ease-out hover:-translate-y-0.5',
                        risky ? 'border-crit/40' : 'border-warn/30',
                        selected && 'ring-1 ring-aqua',
                        'hover:border-edge'
                      )}>
                      
                        <div className="flex items-center gap-2">
                          <AnchorIcon
                          className={cn('h-3.5 w-3.5', risky ? 'text-crit' : 'text-warn')}
                          aria-hidden />
                        
                          <span className="font-mono text-[13px] font-semibold text-chalk">
                            {entry.vesselId}
                          </span>
                          <span className="ml-auto font-mono text-[11px] text-warn">
                            WAITING {fmtDuration(entry.waitingHours)}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-mist">
                          {vessel ? `${vessel.operator} · ${vessel.cargoType}` : '—'}
                        </p>
                        <div className="mt-2.5">
                          <ProgressBar
                          value={entry.waitingHours / worst * 100}
                          tone={risky ? 'bg-crit' : 'bg-warn'} />
                        
                        </div>
                        <dl className="mt-2">
                          <DataRow label="Reason" value={entry.reason} tone="text-mist" />
                          <DataRow label="Expected Berth" value={entry.expectedBerthId} />
                          <DataRow
                          label="Cargo Priority"
                          value={entry.priority.toUpperCase()}
                          tone={
                          entry.priority === 'critical' ?
                          'text-crit' :
                          entry.priority === 'high' ?
                          'text-warn' :
                          'text-mist'
                          } />
                        
                          <DataRow
                          label="Spoilage Risk"
                          value={
                          entry.spoilageRisk === 'breach' ?
                          'BREACH' :
                          entry.spoilageRisk === 'watch' ?
                          'WATCH' :
                          'NONE'
                          }
                          tone={
                          entry.spoilageRisk === 'breach' ?
                          'text-crit' :
                          entry.spoilageRisk === 'watch' ?
                          'text-warn' :
                          'text-ok'
                          } />
                        
                        </dl>
                        {entry.spoilageRisk === 'breach' &&
                      <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-crit">
                            <TriangleAlertIcon className="h-3 w-3" aria-hidden />
                            DEADLINE BREACH PROJECTED
                          </p>
                      }
                      </button>);

                })}
                </div>
              </div>);

        })}
        </div>
      }
    </Panel>);

}