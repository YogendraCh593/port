/**
 * WhyThisDecision
 * ────────────────
 * Shows a detailed explanation of why a ship was assigned to a berth/crane.
 * Rendered as an inline panel when a schedule row is selected.
 */
import React from 'react';
import {
  CheckCircle2Icon, XCircleIcon, InfoIcon,
  AnchorIcon, ConstructionIcon, ClockIcon,
  ZapIcon, ScaleIcon,
} from 'lucide-react';
import { Panel } from '../ui/Panel';
import { cn } from '../../utils/ui';
import type { ScheduleEntry, LiveShipState } from '../../hooks/useOptimization';

function fmtMs(ms: number | undefined | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtMin(min: number): string {
  if (min < 60) return `${min.toFixed(1)} min`;
  return `${(min / 60).toFixed(2)} hr`;
}

interface Props {
  entry:    ScheduleEntry;
  ship?:    LiveShipState;
  onClose?: () => void;
}

export function WhyThisDecision({ entry, ship, onClose }: Props) {
  // Parse the reason string (backend returns bullet-separated parts)
  const parts = entry.reason ? entry.reason.split(' · ').filter(Boolean) : [];

  return (
    <Panel
      eyebrow="Decision explanation"
      title={`Why → ${entry.ship_id}`}
      actions={
        onClose && (
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[10px] text-mist hover:text-chalk transition-colors"
            aria-label="Close"
          >
            CLOSE
          </button>
        )
      }
    >
      {/* Status badge */}
      <div className={cn(
        'mb-3 flex items-center gap-2 rounded-lg border px-3 py-2',
        entry.compatible
          ? 'border-ok/35 bg-ok/[0.07]'
          : 'border-crit/35 bg-crit/[0.07]',
      )}>
        {entry.compatible
          ? <CheckCircle2Icon className="h-4 w-4 text-ok shrink-0" />
          : <XCircleIcon className="h-4 w-4 text-crit shrink-0" />}
        <span className={cn('font-display text-[12px] font-bold uppercase tracking-wider',
          entry.compatible ? 'text-ok' : 'text-crit')}>
          {entry.compatible ? 'ALLOCATED' : 'INCOMPATIBLE — HELD AT ANCHORAGE'}
        </span>
        <span className="ml-auto font-mono text-[10px] text-mist">
          {entry.algo}
        </span>
      </div>

      {/* Assignment summary */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { Icon: AnchorIcon,      label: 'Berth',       value: entry.berth_id ?? 'None' },
          { Icon: ConstructionIcon,label: 'Crane',       value: entry.crane_id ?? 'None' },
          { Icon: ClockIcon,       label: 'Wait',        value: fmtMin(entry.wait_min) },
          { Icon: ZapIcon,         label: 'Process',     value: fmtMin(entry.processing_time_min) },
        ].map(({ Icon, label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-abyss/60 p-3 text-center">
            <Icon className="mx-auto h-4 w-4 text-aqua mb-1" aria-hidden />
            <p className="font-mono text-[9px] uppercase tracking-wider text-mist">{label}</p>
            <p className="mt-1 font-mono text-[12px] font-bold text-chalk">{value}</p>
          </div>
        ))}
      </div>

      {/* Reason bullets */}
      {parts.length > 0 && (
        <div className="mb-3">
          <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
            Reasoning
          </p>
          <ul className="space-y-1.5">
            {parts.map((part, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <CheckCircle2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
                <span className="font-mono text-[11px] leading-snug text-mist">{part}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Timing */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          { label: 'Service Start', value: fmtMs(entry.service_start_ms) },
          { label: 'Service End',   value: fmtMs(entry.service_end_ms) },
          { label: 'Departure',     value: entry.predicted_departure
              ? new Date(entry.predicted_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="rounded border border-line bg-abyss/40 px-2 py-1.5 text-center">
            <p className="font-mono text-[9px] text-mist">{label}</p>
            <p className="font-mono text-[12px] font-bold text-chalk">{value}</p>
          </div>
        ))}
      </div>

      {/* Live cargo state */}
      {ship && (
        <div className="mb-3">
          <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
            Live Cargo State
          </p>
          <div className="rounded-lg border border-line bg-abyss/60 px-3 py-2.5">
            <div className="grid grid-cols-3 gap-2 text-center mb-2">
              <div>
                <p className="font-mono text-[9px] text-mist">ORIGINAL</p>
                <p className="font-mono text-[12px] font-bold text-chalk">
                  {ship.original_cargo_t.toLocaleString()} t
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] text-mist">PROCESSED</p>
                <p className="font-mono text-[12px] font-bold text-ok">
                  {ship.processed_cargo_t.toFixed(0)} t
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] text-mist">REMAINING</p>
                <p className="font-mono text-[12px] font-bold text-warn">
                  {ship.remaining_cargo_t.toFixed(0)} t
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-2 w-full rounded-full bg-line overflow-hidden">
              <div
                className="h-full rounded-full bg-ok transition-all duration-500"
                style={{
                  width: `${Math.min(100, ship.processed_cargo_t / Math.max(ship.original_cargo_t, 1) * 100).toFixed(1)}%`,
                }}
              />
            </div>
            <p className="mt-1.5 font-mono text-[9px] text-mist">
              Rate: {ship.processing_rate_tpm} t/min &nbsp;·&nbsp;
              Predicted departure: {ship.predicted_departure
                ? new Date(ship.predicted_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Cost breakdown */}
      <div>
        <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
          Objective Cost Breakdown
        </p>
        <div className="space-y-1.5">
          {[
            { label: 'Waiting time',      value: entry.wait_min,             weight: 4 },
            { label: 'Crane idle time',   value: entry.crane_idle_min,       weight: 2 },
            { label: 'Berth idle time',   value: entry.berth_idle_min,       weight: 1 },
            { label: 'Switch cost',       value: entry.switch_cost_min,      weight: 1.5 },
            { label: 'Departure delay',   value: entry.departure_delay_min,  weight: 3 },
            { label: 'Fairness penalty',  value: entry.fairness_penalty,     weight: 2 },
          ].map(({ label, value, weight }) => {
            const contribution = value * weight;
            return (
              <div key={label} className="flex items-center gap-2">
                <ScaleIcon className="h-3 w-3 text-mist/50 shrink-0" aria-hidden />
                <span className="flex-1 font-mono text-[10px] text-mist">{label}</span>
                <span className="font-mono text-[10px] text-chalk w-16 text-right">
                  {fmtMin(value)}
                </span>
                <span className="font-mono text-[9px] text-mist/50 w-8 text-right">
                  ×{weight}
                </span>
                <span className="font-mono text-[10px] text-aqua w-16 text-right">
                  = {contribution.toFixed(1)}
                </span>
              </div>
            );
          })}
          <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
            <InfoIcon className="h-3 w-3 text-aqua shrink-0" aria-hidden />
            <span className="flex-1 font-mono text-[10px] font-bold text-chalk">Total contribution</span>
            <span className="font-mono text-[12px] font-bold text-aqua">
              {(
                entry.wait_min * 4 +
                entry.crane_idle_min * 2 +
                entry.berth_idle_min +
                entry.switch_cost_min * 1.5 +
                entry.departure_delay_min * 3 +
                entry.fairness_penalty * 2
              ).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
