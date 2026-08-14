import React from 'react';
import { Link } from 'react-router-dom';
import {
  AnchorIcon,
  ArrowRightIcon,
  GaugeIcon,
  ShipIcon,
  Trash2Icon,
  TriangleAlertIcon } from
'lucide-react';
import { usePort } from '../../contexts/PortContext';
import { Panel } from '../ui/Panel';
import { DataRow } from '../ui/DataRow';
import { StatusDot } from '../ui/StatusDot';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/ProgressBar';
import { statusLabel, statusToken, vesselProgress } from '../../utils/fleet';
import { fmtCoord, fmtDate, fmtDuration, fmtNumber, fmtTime } from '../../utils/geo';
import { cn, inputClass } from '../../utils/ui';
import type { Vessel } from '../../types';

const statuses: Vessel['status'][] = ['approaching', 'waiting', 'berthed', 'departing'];

export function VesselDetailPanel({ className }: {className?: string;}) {
  const {
    vessels,
    derived,
    selectedVesselId,
    selectVessel,
    updateVessel,
    removeVessel,
    optimization,
    now,
    port
  } = usePort();

  const vessel = vessels.find((v) => v.id === selectedVesselId) ?? null;

  if (!vessel) {
    return (
      <Panel title="Vessel Information" eyebrow="Telemetry" className={className}>
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <ShipIcon className="h-7 w-7 text-mist/50" aria-hidden />
          <p className="max-w-[220px] text-sm text-mist">
            Select a vessel on the port map or fleet list to inspect its telemetry.
          </p>
        </div>
      </Panel>);

  }

  const d = derived[vessel.id];
  const token = statusToken[vessel.status];
  const assignment = optimization?.assignments.find((a) => a.vesselId === vessel.id);
  const progress = d ? vesselProgress(vessel, d, now) * 100 : 0;

  return (
    <Panel
      eyebrow={vessel.operator}
      title={`${vessel.id} · ${vessel.cargoType}`}
      className={className}
      actions={
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px]',
          token.text,
          token.ring
        )}>
        
          <StatusDot color={token.dot} />
          {statusLabel[vessel.status]}
        </span>
      }>
      
      {d?.spoilageRisk !== 'none' && d?.spoilageDeadline &&
      <div
        className={cn(
          'mb-4 flex items-start gap-2.5 rounded-lg border p-3',
          d.spoilageRisk === 'breach' ?
          'border-crit/45 bg-crit/10' :
          'border-warn/45 bg-warn/10'
        )}>
        
          <TriangleAlertIcon
          className={cn('mt-0.5 h-4 w-4 shrink-0', d.spoilageRisk === 'breach' ? 'text-crit' : 'text-warn')}
          aria-hidden />
        
          <div>
            <p
            className={cn(
              'font-display text-[10px] font-semibold uppercase tracking-wider2',
              d.spoilageRisk === 'breach' ? 'text-crit' : 'text-warn'
            )}>
            
              Spoilage Deadline
            </p>
            <p className="font-mono text-xs text-chalk">
              {fmtDate(d.spoilageDeadline)} | {fmtTime(d.spoilageDeadline)}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-mist">
              {d.spoilageSlackHours !== null && d.spoilageSlackHours < 0 ?
            `Projected overrun ${fmtDuration(Math.abs(d.spoilageSlackHours))}` :
            `Slack ${fmtDuration(d.spoilageSlackHours ?? 0)}`}
            </p>
          </div>
        </div>
      }

      {vessel.status === 'approaching' &&
      <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] text-mist">
            <span>APPROACH PROGRESS</span>
            <span className="text-aqua">{Math.round(progress)}%</span>
          </div>
          <ProgressBar value={progress} tone="bg-aqua" />
        </div>
      }

      <div className="grid gap-x-6 sm:grid-cols-2">
        <dl>
          <DataRow label="Ship ID" value={vessel.id} />
          <DataRow label="Operator" value={vessel.operator} />
          <DataRow label="Cargo" value={vessel.cargoType} />
          <DataRow label="Load" value={`${fmtNumber(vessel.loadTonnes)} t`} />
          <DataRow label="TEU" value={vessel.teu ? fmtNumber(vessel.teu) : '—'} />
          <DataRow label="LOA" value={`${vessel.loa} m`} />
          <DataRow label="Draft" value={`${vessel.draft} m`} />
          <DataRow label="Speed" value={`${vessel.speedKnots} knots`} />
        </dl>
        <dl>
          <DataRow
            label="Position"
            value={
            <span className="text-right">
                {fmtCoord(vessel.lat, 'lat')}
                <br />
                {fmtCoord(vessel.lon, 'lon')}
              </span>
            } />
          
          <DataRow
            label="Distance to Port"
            value={d ? `${fmtNumber(d.distanceKm)} km` : '—'}
            tone="text-aqua" />
          
          <DataRow label="Travel Time" value={d ? fmtDuration(d.travelHours) : '—'} />
          <DataRow
            label="ETA"
            value={
            d ?
            <span className="text-right">
                  {fmtDate(d.eta)}
                  <br />
                  {fmtTime(d.eta)}
                </span> :

            '—'

            }
            tone="text-chalk" />
          
          <DataRow
            label="Expected Berth End"
            value={
            d ?
            <span className="text-right">
                  {fmtDate(d.expectedEnd)}
                  <br />
                  {fmtTime(d.expectedEnd)}
                </span> :

            '—'

            } />
          
          <DataRow label="Unloading Window" value={fmtDuration(vessel.unloadingHours)} />
          <DataRow
            label="Allocated Berth"
            value={assignment ? assignment.berthId : 'PENDING'}
            tone={assignment ? 'text-ok' : 'text-warn'} />
          
          <DataRow
            label="Queue Wait"
            value={assignment ? fmtDuration(assignment.waitingHours) : '—'}
            tone={assignment && assignment.waitingHours > 1 ? 'text-warn' : 'text-chalk'} />
          
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <label className="flex-1 min-w-[160px]">
          <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
            Operational Status
          </span>
          <select
            className={inputClass}
            value={vessel.status}
            onChange={(e) => updateVessel(vessel.id, { status: e.target.value as Vessel['status'] })}>
            
            {statuses.map((s) =>
            <option key={s} value={s} className="bg-abyss">
                {statusLabel[s]}
              </option>
            )}
          </select>
        </label>
        <Link to="/berths" onClick={() => selectVessel(vessel.id)}>
          <Button variant="primary" icon={<ArrowRightIcon className="h-3.5 w-3.5" />}>
            Berth Plan
          </Button>
        </Link>
        <Button
          variant="danger"
          icon={<Trash2Icon className="h-3.5 w-3.5" />}
          onClick={() => removeVessel(vessel.id)}>
          
          Remove
        </Button>
      </div>

      <p className="mt-3 flex items-center gap-2 font-mono text-[10px] text-mist/70">
        <GaugeIcon className="h-3 w-3" aria-hidden />
        Bearing to {port.name} computed from live coordinates
        <AnchorIcon className="ml-auto h-3 w-3" aria-hidden />
      </p>
    </Panel>);

}