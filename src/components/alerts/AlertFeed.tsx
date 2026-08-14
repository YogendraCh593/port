import React from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon } from 'lucide-react';
import { usePort } from '../../contexts/PortContext';
import { Panel } from '../ui/Panel';
import { StatusDot } from '../ui/StatusDot';
import { fmtTime } from '../../utils/geo';
import { cn, severityToken } from '../../utils/ui';

export function AlertFeed({ limit = 5, className }: {limit?: number;className?: string;}) {
  const { alerts, acknowledgeAlert, selectVessel } = usePort();
  const open = alerts.filter((a) => !a.acknowledged).slice(0, limit);

  return (
    <Panel
      eyebrow="Live"
      title="Alert Stream"
      className={className}
      bodyClassName="p-0"
      actions={
      <Link
        to="/alerts"
        className="font-display text-[10px] font-semibold uppercase tracking-wider text-aqua transition-colors duration-150 hover:text-chalk">
        
          View all
        </Link>
      }>
      
      <ul className="divide-y divide-line/70">
        {open.length === 0 &&
        <li className="px-4 py-8 text-center text-sm text-mist">
            All alerts acknowledged. Operations nominal.
          </li>
        }
        {open.map((alert) => {
          const token = severityToken[alert.severity];
          return (
            <li key={alert.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-1.5">
                <StatusDot color={token.dot} pulse={alert.severity === 'critical'} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p
                    className={cn(
                      'font-display text-[10px] font-semibold uppercase tracking-wider2',
                      token.text
                    )}>
                    
                    {alert.title}
                  </p>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-mist/70">
                    {fmtTime(alert.at)}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] leading-snug text-mist">{alert.message}</p>
                <div className="mt-1.5 flex items-center gap-3">
                  {alert.vesselId &&
                  <button
                    type="button"
                    onClick={() => selectVessel(alert.vesselId!)}
                    className="font-mono text-[10px] text-aqua transition-colors duration-150 hover:text-chalk">
                    
                      INSPECT {alert.vesselId}
                    </button>
                  }
                  <button
                    type="button"
                    onClick={() => acknowledgeAlert(alert.id)}
                    className="inline-flex items-center gap-1 font-mono text-[10px] text-mist transition-colors duration-150 hover:text-chalk">
                    
                    <CheckIcon className="h-3 w-3" aria-hidden />
                    ACK
                  </button>
                </div>
              </div>
            </li>);

        })}
      </ul>
    </Panel>);

}