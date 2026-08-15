/**
 * EventLog
 * ─────────
 * Rolling display of optimization events from the backend engine.
 * Shows what happened, when, and why the schedule changed.
 */
import React, { useEffect, useRef } from 'react';
import {
  ZapIcon, ShipIcon, AnchorIcon, AlertOctagonIcon,
  RefreshCwIcon, InfoIcon, CheckIcon,
} from 'lucide-react';
import { Panel } from '../ui/Panel';
import { cn } from '../../utils/ui';
import type { OptEvent } from '../../hooks/useOptimization';

const EVENT_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  ARRIVAL:       { icon: <ShipIcon className="h-3 w-3" />,         color: 'text-aqua',    bg: 'bg-aqua/10' },
  BERTH_FREE:    { icon: <AnchorIcon className="h-3 w-3" />,       color: 'text-ok',      bg: 'bg-ok/10' },
  HALT:          { icon: <AlertOctagonIcon className="h-3 w-3" />, color: 'text-crit',    bg: 'bg-crit/10' },
  HALT_CLEARED:  { icon: <CheckIcon className="h-3 w-3" />,        color: 'text-ok',      bg: 'bg-ok/10' },
  OPTIMIZED:     { icon: <ZapIcon className="h-3 w-3" />,          color: 'text-quantum', bg: 'bg-quantum/10' },
  TRIGGER:       { icon: <RefreshCwIcon className="h-3 w-3" />,    color: 'text-warn',    bg: 'bg-warn/10' },
  CONFIG:        { icon: <InfoIcon className="h-3 w-3" />,         color: 'text-mist',    bg: 'bg-mist/10' },
  SHIP_LOADED:   { icon: <ShipIcon className="h-3 w-3" />,         color: 'text-mist',    bg: 'bg-mist/10' },
};

function getConfig(type: string) {
  return EVENT_CONFIG[type] ?? { icon: <InfoIcon className="h-3 w-3" />, color: 'text-mist', bg: 'bg-mist/10' };
}

interface Props {
  events:    OptEvent[];
  maxHeight?: number;
}

export function EventLog({ events, maxHeight = 360 }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <Panel
      eyebrow={`${events.length} events`}
      title="Optimization Event Log"
      bodyClassName="p-0"
    >
      <div
        className="overflow-y-auto font-mono text-[11px]"
        style={{ maxHeight }}
        role="log"
        aria-live="polite"
        aria-label="Optimization event log"
      >
        {events.length === 0 && (
          <p className="px-4 py-8 text-center text-mist">
            No events yet. Run the optimizer or start the simulation.
          </p>
        )}
        {events.map((ev, i) => {
          const cfg = getConfig(ev.event_type);
          return (
            <div
              key={i}
              className={cn(
                'flex gap-3 border-b border-line/50 px-4 py-2.5 transition-colors hover:bg-white/[0.02]',
              )}
            >
              {/* Icon */}
              <span className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded',
                cfg.bg, cfg.color,
              )}>
                {cfg.icon}
              </span>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={cn('font-semibold uppercase tracking-wider text-[10px]', cfg.color)}>
                    {ev.event_type}
                  </span>
                  {ev.ship_id && (
                    <span className="rounded border border-line px-1.5 py-0.5 text-[9px] text-mist">
                      {ev.ship_id}
                    </span>
                  )}
                  {ev.berth_id && (
                    <span className="rounded border border-line px-1.5 py-0.5 text-[9px] text-mist">
                      {ev.berth_id}
                    </span>
                  )}
                  {ev.crane_id && (
                    <span className="rounded border border-line px-1.5 py-0.5 text-[9px] text-ok">
                      {ev.crane_id}
                    </span>
                  )}
                  <span className="ml-auto text-[9px] text-mist/60 shrink-0">
                    {ev.timestamp?.slice(11, 19) ?? ''}
                  </span>
                </div>
                <p className="mt-0.5 leading-snug text-mist">{ev.description}</p>
                {ev.old_value && ev.new_value && (
                  <p className="mt-0.5 text-[9px]">
                    <span className="text-mist/50">{ev.old_value}</span>
                    <span className="mx-1.5 text-mist/30">→</span>
                    <span className="text-chalk">{ev.new_value}</span>
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </Panel>
  );
}
