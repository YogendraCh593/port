import React from 'react';
import { usePort } from '../../contexts/PortContext';
import { Panel } from '../ui/Panel';
import { StatusDot } from '../ui/StatusDot';
import { statusLabel, statusToken } from '../../utils/fleet';
import { fmtDuration, fmtNumber, fmtTime, hoursBetween } from '../../utils/geo';
import { cn } from '../../utils/ui';

interface ArrivalQueueProps {
  limit?: number;
  className?: string;
}

export function ArrivalQueue({ limit = 6, className }: ArrivalQueueProps) {
  const { vessels, derived, now, optimization, selectedVesselId, selectVessel } = usePort();

  const queue = vessels.
  filter((v) => v.status === 'approaching' || v.status === 'waiting').
  map((v) => ({ vessel: v, d: derived[v.id] })).
  filter((row) => Boolean(row.d)).
  sort((a, b) => a.d!.eta.getTime() - b.d!.eta.getTime()).
  slice(0, limit);

  return (
    <Panel
      eyebrow="Sequenced by ETA"
      title="Inbound Queue"
      className={className}
      bodyClassName="p-0">
      
      <ul className="divide-y divide-line/70">
        {queue.length === 0 &&
        <li className="px-4 py-8 text-center text-sm text-mist">No inbound traffic.</li>
        }
        {queue.map(({ vessel, d }) => {
          const token = statusToken[vessel.status];
          const assignment = optimization?.assignments.find((a) => a.vesselId === vessel.id);
          const toEta = hoursBetween(now, d!.eta);
          const selected = selectedVesselId === vessel.id;
          return (
            <li key={vessel.id}>
              <button
                type="button"
                onClick={() => selectVessel(vessel.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out hover:bg-white/[0.035]',
                  selected && 'bg-aqua/[0.07]'
                )}>
                
                <StatusDot color={token.dot} pulse={vessel.status === 'approaching'} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[13px] font-semibold text-chalk">
                      {vessel.id}
                    </span>
                    <span className="truncate font-mono text-[11px] text-mist">
                      {vessel.operator}
                    </span>
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-mist/80">
                    {fmtNumber(vessel.loadTonnes)} t · {vessel.cargoType} ·{' '}
                    {assignment ? assignment.berthId : 'UNALLOCATED'}
                    {d!.spoilageRisk === 'breach' &&
                    <span className="ml-1 text-crit">· SPOILAGE RISK</span>
                    }
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[13px] tabular-nums text-chalk">
                    {fmtTime(d!.eta)}
                  </span>
                  <span className={cn('block font-mono text-[10px]', token.text)}>
                    {toEta > 0 ? `T-${fmtDuration(toEta)}` : statusLabel[vessel.status]}
                  </span>
                </span>
              </button>
            </li>);

        })}
      </ul>
    </Panel>);

}