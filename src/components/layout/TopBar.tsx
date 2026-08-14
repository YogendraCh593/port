import React from 'react';
import { Link } from 'react-router-dom';
import {
  BellIcon,
  MenuIcon,
  RadioIcon,
  UserRoundIcon,
  ActivityIcon } from
'lucide-react';
import { usePort } from '../../contexts/PortContext';
import { StatusDot } from '../ui/StatusDot';
import { fmtClock, fmtDate } from '../../utils/geo';
import { cn } from '../../utils/ui';

interface TopBarProps {
  onOpenNav: () => void;
}

export function TopBar({ onOpenNav }: TopBarProps) {
  const { vessels, alerts, now, settings, playing, speed, activePort } = usePort();

  const active  = vessels.length;
  const waiting = vessels.filter((v) => v.status === 'waiting').length;
  const openAlerts = alerts.filter(
    (a) => !a.acknowledged && (a.severity === 'critical' || a.severity === 'warning')
  ).length;

  const portLabel = activePort?.short ?? settings.portName;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-abyss/90 px-3 backdrop-blur-xl sm:px-4">
      <button
        type="button"
        onClick={onOpenNav}
        className="grid h-9 w-9 place-items-center rounded-md border border-line text-mist transition-colors duration-150 ease-out hover:border-edge hover:text-chalk lg:hidden"
        aria-label="Open navigation">
        
        <MenuIcon className="h-4 w-4" aria-hidden />
      </button>

      <div className="min-w-0">
        <p className="truncate font-display text-xs font-bold tracking-wider2 text-chalk">
          {portLabel}
        </p>
        <p className="flex items-center gap-1.5 font-mono text-[10px] text-ok">
          <StatusDot color="bg-ok" />
          SYSTEM ONLINE
        </p>
      </div>

      <div className="mx-1 hidden h-8 w-px bg-line md:block" />

      <div className="hidden md:block">
        <p className="font-mono text-[10px] uppercase tracking-wider text-mist">
          {fmtDate(now)}
        </p>
        <p className="font-mono text-sm tabular-nums text-chalk">{fmtClock(now)}</p>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <span
          className="hidden items-center gap-1.5 rounded-md border border-line bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10px] text-mist xl:inline-flex"
          title={`Simulation clock ${playing ? 'running' : 'paused'} at ${speed}×`}>
          
          <RadioIcon className={cn('h-3.5 w-3.5', playing ? 'text-aqua' : 'text-mist')} aria-hidden />
          SYNC {playing ? `LIVE ${speed}×` : 'HELD'}
        </span>

        <div className="flex items-center divide-x divide-line rounded-md border border-line bg-white/[0.02]">
          <Metric label="ACTIVE" value={active} tone="text-aqua" />
          <Metric label="WAITING" value={waiting} tone="text-warn" />
          <Metric label="ALERTS" value={openAlerts} tone={openAlerts ? 'text-crit' : 'text-mist'} />
        </div>

        <Link
          to="/alerts"
          className="relative grid h-9 w-9 place-items-center rounded-md border border-line text-mist transition-colors duration-150 ease-out hover:border-edge hover:text-chalk"
          aria-label={`Alerts, ${openAlerts} unacknowledged`}>
          
          <BellIcon className="h-4 w-4" aria-hidden />
          {openAlerts > 0 &&
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-crit px-1 font-mono text-[9px] font-semibold text-void">
              {openAlerts}
            </span>
          }
        </Link>

        <div className="flex items-center gap-2 rounded-md border border-line bg-white/[0.02] py-1 pl-1 pr-2.5">
          <span className="grid h-7 w-7 place-items-center rounded bg-aqua/12 text-aqua">
            <UserRoundIcon className="h-4 w-4" aria-hidden />
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block font-display text-[10px] font-semibold tracking-wider text-chalk">
              R. NARAYANAN
            </span>
            <span className="block font-mono text-[9px] text-mist">DUTY CONTROLLER</span>
          </span>
        </div>
      </div>
    </header>);

}

function Metric({ label, value, tone }: {label: string;value: number;tone: string;}) {
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1.5">
      <ActivityIcon className="hidden h-3 w-3 text-mist/60 sm:block" aria-hidden />
      <span className="font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist">
        {label}
      </span>
      <span className={cn('font-mono text-xs font-semibold tabular-nums', tone)}>{value}</span>
    </span>);

}