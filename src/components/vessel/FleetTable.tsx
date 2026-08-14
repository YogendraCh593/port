import React, { useMemo, useState } from 'react';
import { SearchIcon, ArrowUpDownIcon } from 'lucide-react';
import { usePort } from '../../contexts/PortContext';
import { Panel } from '../ui/Panel';
import { StatusDot } from '../ui/StatusDot';
import { statusLabel, statusToken } from '../../utils/fleet';
import { fmtDuration, fmtNumber, fmtTime, fmtDate } from '../../utils/geo';
import { cn, inputClass } from '../../utils/ui';
import type { Vessel } from '../../types';

type SortKey = 'id' | 'eta' | 'load' | 'distance' | 'wait';

const filters: (Vessel['status'] | 'all')[] = [
'all',
'approaching',
'waiting',
'berthed',
'departing'];


export function FleetTable({ className }: {className?: string;}) {
  const { vessels, derived, optimization, selectedVesselId, selectVessel } = usePort();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Vessel['status'] | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('eta');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = vessels.
    filter((v) => status === 'all' ? true : v.status === status).
    filter(
      (v) =>
      !q ||
      v.id.toLowerCase().includes(q) ||
      v.operator.toLowerCase().includes(q) ||
      v.cargoType.toLowerCase().includes(q)
    ).
    map((v) => ({
      vessel: v,
      d: derived[v.id],
      assignment: optimization?.assignments.find((a) => a.vesselId === v.id)
    }));

    return list.sort((a, b) => {
      switch (sort) {
        case 'id':
          return a.vessel.id.localeCompare(b.vessel.id);
        case 'load':
          return b.vessel.loadTonnes - a.vessel.loadTonnes;
        case 'distance':
          return (a.d?.distanceKm ?? 0) - (b.d?.distanceKm ?? 0);
        case 'wait':
          return (b.assignment?.waitingHours ?? 0) - (a.assignment?.waitingHours ?? 0);
        default:
          return (a.d?.eta.getTime() ?? 0) - (b.d?.eta.getTime() ?? 0);
      }
    });
  }, [vessels, derived, optimization, query, status, sort]);

  return (
    <Panel
      eyebrow={`${rows.length} of ${vessels.length} vessels`}
      title="Fleet Register"
      className={className}
      bodyClassName="p-0"
      actions={
      <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mist"
            aria-hidden />
          
            <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ID / operator"
            aria-label="Search fleet"
            className={cn(inputClass, 'w-44 py-1.5 pl-8 text-[11px]')} />
          
          </div>
          <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort vessels"
          className={cn(inputClass, 'w-auto py-1.5 text-[11px]')}>
          
            <option value="eta" className="bg-abyss">Sort: ETA</option>
            <option value="id" className="bg-abyss">Sort: Ship ID</option>
            <option value="load" className="bg-abyss">Sort: Load</option>
            <option value="distance" className="bg-abyss">Sort: Distance</option>
            <option value="wait" className="bg-abyss">Sort: Waiting</option>
          </select>
        </div>
      }>
      
      <div className="flex flex-wrap gap-1.5 border-b border-line/70 px-4 py-2.5">
        {filters.map((f) =>
        <button
          key={f}
          type="button"
          onClick={() => setStatus(f)}
          className={cn(
            'rounded border px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-wider transition-colors duration-150 ease-out',
            status === f ?
            'border-aqua/60 bg-aqua/12 text-aqua' :
            'border-line text-mist hover:border-edge hover:text-chalk'
          )}>
          
            {f === 'all' ? 'All' : statusLabel[f]}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line/70 bg-abyss/40">
              {['Vessel', 'Cargo', 'Load / TEU', 'LOA · Draft', 'Distance', 'ETA', 'Berth', 'Wait', 'Status'].map(
                (h) =>
                <th
                  key={h}
                  scope="col"
                  className="whitespace-nowrap px-4 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
                  
                    <span className="inline-flex items-center gap-1">
                      {h}
                      {h === 'ETA' && <ArrowUpDownIcon className="h-2.5 w-2.5 opacity-50" aria-hidden />}
                    </span>
                  </th>

              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ vessel, d, assignment }) => {
              const token = statusToken[vessel.status];
              const selected = selectedVesselId === vessel.id;
              return (
                <tr
                  key={vessel.id}
                  onClick={() => selectVessel(vessel.id)}
                  className={cn(
                    'cursor-pointer border-b border-line/50 transition-colors duration-150 ease-out hover:bg-white/[0.035]',
                    selected && 'bg-aqua/[0.06]'
                  )}>
                  
                  <td className="px-4 py-2.5">
                    <span className="block font-mono text-[12px] font-semibold text-chalk">
                      {vessel.id}
                    </span>
                    <span className="block font-mono text-[10px] text-mist">{vessel.operator}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-mist">
                    {vessel.cargoType}
                    {vessel.spoilable &&
                    <span
                      className={cn(
                        'ml-1.5',
                        d?.spoilageRisk === 'breach' ? 'text-crit' : 'text-warn'
                      )}>
                      
                        ⚠
                      </span>
                    }
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-chalk">
                    {fmtNumber(vessel.loadTonnes)} t
                    <span className="text-mist"> / {vessel.teu ? fmtNumber(vessel.teu) : '—'}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-mist">
                    {vessel.loa} m · {vessel.draft} m
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-aqua">
                    {d ? `${fmtNumber(d.distanceKm)} km` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-chalk">
                    {d ?
                    <>
                        {fmtTime(d.eta)}
                        <span className="block text-[10px] text-mist">{fmtDate(d.eta)}</span>
                      </> :

                    '—'
                    }
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px]">
                    <span className={assignment ? 'text-ok' : 'text-warn'}>
                      {assignment ? assignment.berthId : 'PENDING'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px]">
                    <span
                      className={
                      assignment && assignment.waitingHours > 1 ? 'text-warn' : 'text-mist'
                      }>
                      
                      {assignment ? fmtDuration(assignment.waitingHours) : '—'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className={cn('inline-flex items-center gap-1.5 font-mono text-[10px]', token.text)}>
                      <StatusDot color={token.dot} pulse={vessel.status === 'approaching'} />
                      {statusLabel[vessel.status]}
                    </span>
                  </td>
                </tr>);

            })}
            {rows.length === 0 &&
            <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-mist">
                  No vessels match the current filter.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </Panel>);

}