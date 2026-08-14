import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  RadarIcon,
  AnchorIcon,
  WavesIcon,
  ShipIcon,
  ConstructionIcon,
  BrainCircuitIcon,
  MapPinIcon,
  BarChart3Icon,
  TriangleAlertIcon,
  FileTextIcon,
  SettingsIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon } from
'lucide-react';
import { usePort } from '../../contexts/PortContext';
import { StatusDot } from '../ui/StatusDot';
import { cn } from '../../utils/ui';

const nav = [
{ to: '/', label: 'Command Center', Icon: RadarIcon },
{ to: '/vessels', label: 'Vessel Operations', Icon: AnchorIcon },
{ to: '/fleet', label: 'Live Fleet', Icon: WavesIcon },
{ to: '/berths', label: 'Berth Optimization', Icon: ShipIcon },
{ to: '/cranes', label: 'Crane Operations', Icon: ConstructionIcon },
{ to: '/quantum', label: 'Quantum Optimization', Icon: BrainCircuitIcon },
{ to: '/simulation', label: 'Port Simulation', Icon: MapPinIcon },
{ to: '/analytics', label: 'Analytics', Icon: BarChart3Icon },
{ to: '/alerts', label: 'Alerts', Icon: TriangleAlertIcon },
{ to: '/reports', label: 'Reports', Icon: FileTextIcon },
{ to: '/settings', label: 'Settings', Icon: SettingsIcon }];


interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

export function Sidebar({ collapsed, onToggle, onNavigate }: SidebarProps) {
  const { alerts, optimization, solving, activePort, vessels } = usePort();
  const openCritical = alerts.filter((a) => a.severity === 'critical' && !a.acknowledged).length;
  const systemStatus = openCritical > 0 ? 'DEGRADED' : 'OPTIMAL';
  const portLabel = activePort?.short ?? 'PORT';

  return (
    <div
      className={cn(
        'flex h-full flex-col border-r border-line bg-abyss/95 transition-[width] duration-200 ease-out',
        collapsed ? 'w-[76px]' : 'w-[260px]'
      )}>
      
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-aqua/40 bg-aqua/10">
          <AnchorIcon className="h-4 w-4 text-aqua" strokeWidth={2} aria-hidden />
          <span className="absolute inset-0 rounded-lg shadow-[0_0_18px_-6px_rgba(34,211,238,0.7)]" />
        </span>
        {!collapsed &&
        <div className="min-w-0">
            <p className="font-display text-sm font-bold tracking-wider2 text-chalk">NEXUSPORT</p>
            <p className="truncate font-display text-[9px] font-semibold uppercase tracking-wider2 text-aqua">
              {portLabel}
            </p>
          </div>
        }
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Primary">
        <ul className="space-y-0.5">
          {nav.map(({ to, label, Icon }) =>
          <li key={to}>
              <NavLink
              to={to}
              end={to === '/'}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-md px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wider transition-[background-color,color] duration-150 ease-out',
                isActive ?
                'bg-aqua/10 text-aqua' :
                'text-mist hover:bg-white/[0.04] hover:text-chalk',
                collapsed && 'justify-center px-0'
              )
              }>
              
                {({ isActive }) =>
              <>
                    {isActive &&
                <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-aqua shadow-[0_0_10px_0_rgba(34,211,238,0.8)]" />
                }
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {!collapsed && label === 'Alerts' && openCritical > 0 &&
                <span className="ml-auto rounded bg-crit/20 px-1.5 py-0.5 font-mono text-[10px] text-crit">
                        {openCritical}
                      </span>
                }
                  </>
              }
              </NavLink>
            </li>
          )}
        </ul>
      </nav>

      <div className="border-t border-line px-3 py-3">
        {!collapsed ?
        <dl className="space-y-2">
            <SystemRow label="System Status" value={systemStatus} tone={openCritical ? 'text-warn' : 'text-ok'} dot={openCritical ? 'bg-warn' : 'bg-ok'} />
            <SystemRow label="Vessels" value={`${vessels.length} REG.`} tone="text-aqua" dot="bg-aqua" />
            <SystemRow
            label="Optimizer"
            value={solving ? 'SOLVING' : optimization ? 'READY' : 'IDLE'}
            tone={solving ? 'text-quantum' : 'text-ok'}
            dot={solving ? 'bg-quantum' : 'bg-ok'} />
          </dl> :

        <div className="flex flex-col items-center gap-2.5 py-1">
            <StatusDot color={openCritical ? 'bg-warn' : 'bg-ok'} />
            <StatusDot color="bg-ok" />
            <StatusDot color={solving ? 'bg-quantum' : 'bg-ok'} />
          </div>
        }
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-center gap-2 border-t border-line px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist transition-colors duration-150 ease-out hover:bg-white/[0.04] hover:text-chalk"
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
        
        {collapsed ?
        <PanelLeftOpenIcon className="h-4 w-4" aria-hidden /> :

        <>
            <PanelLeftCloseIcon className="h-4 w-4" aria-hidden />
            Collapse
          </>
        }
      </button>
    </div>);

}

function SystemRow({
  label,
  value,
  tone,
  dot





}: {label: string;value: string;tone: string;dot: string;}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist/70">
        {label}
      </dt>
      <dd className={cn('flex items-center gap-1.5 font-mono text-[10px]', tone)}>
        <StatusDot color={dot} />
        {value}
      </dd>
    </div>);

}