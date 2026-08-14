import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, CheckCheckIcon, BellIcon, RefreshCwIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { StatusDot } from '../components/ui/StatusDot';
import { usePort } from '../contexts/PortContext';
import { fmtDate, fmtTime } from '../utils/geo';
import { cn, severityToken } from '../utils/ui';
import type { AlertSeverity } from '../types';
import { api } from '../services/api';

const categories: (AlertSeverity | 'all')[] = ['all', 'critical', 'warning', 'info', 'system'];

export function Alerts() {
  const { alerts, acknowledgeAlert, acknowledgeAll, selectVessel } = usePort();
  const [category, setCategory] = useState<AlertSeverity | 'all'>('all');
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Keep a local copy of raw server alerts for manual refresh
  const [serverAlerts, setServerAlerts] = useState<typeof alerts>([]);

  useEffect(() => {
    setServerAlerts(alerts);
  }, [alerts]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const raw = await api.getAlerts();
      // Map to PortAlert shape
      const mapped = raw.map((a) => ({
        id: a.id,
        severity: a.severity,
        title: a.title,
        message: a.message,
        at: new Date().toISOString(),
        acknowledged: false,
      }));
      setServerAlerts(mapped);
    } finally {
      setRefreshing(false);
    }
  }

  // Merge server alerts with acknowledgements from context
  const merged = serverAlerts.length > 0 ? serverAlerts : alerts;

  const counts = {
    all: merged.length,
    critical: merged.filter((a) => a.severity === 'critical').length,
    warning: merged.filter((a) => a.severity === 'warning').length,
    info: merged.filter((a) => a.severity === 'info').length,
    system: merged.filter((a) => a.severity === 'system').length,
  };

  const visible = merged
    .filter((a) => (category === 'all' ? true : a.severity === category))
    .filter((a) => (showAcknowledged ? true : !a.acknowledged));

  return (
    <>
      <PageHeader
        eyebrow="Intelligent alert center"
        title="Alerts"
        description="Every alert is derived from live vessel, berth and crane state — spoilage exposure, berth congestion, infeasible allocations and equipment status."
        actions={
          <>
            <Button
              icon={<RefreshCwIcon className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              Refresh
            </Button>
            <Button
              onClick={() => setShowAcknowledged((s) => !s)}
              icon={<CheckIcon className="h-3.5 w-3.5" />}
            >
              {showAcknowledged ? 'Hide Acknowledged' : 'Show Acknowledged'}
            </Button>
            <Button
              variant="primary"
              icon={<CheckCheckIcon className="h-3.5 w-3.5" />}
              onClick={acknowledgeAll}
            >
              Acknowledge All
            </Button>
          </>
        }
      />

      {/* ── Severity cards ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(['critical', 'warning', 'info', 'system'] as AlertSeverity[]).map((sev) => {
          const token = severityToken[sev];
          const open = merged.filter((a) => a.severity === sev && !a.acknowledged).length;
          return (
            <button
              key={sev}
              type="button"
              onClick={() => setCategory(category === sev ? 'all' : sev)}
              className={cn(
                'rounded-xl border bg-deck/70 p-4 text-left shadow-panel backdrop-blur transition-[transform,border-color] duration-200 ease-out hover:-translate-y-0.5',
                category === sev ? token.border : 'border-line hover:border-edge',
              )}
            >
              <p className="flex items-center gap-2 font-display text-[10px] font-semibold uppercase tracking-wider2 text-mist">
                <StatusDot color={token.dot} pulse={sev === 'critical' && open > 0} />
                {sev}
              </p>
              <p className={cn('mt-2 font-display text-3xl font-semibold', token.text)}>{open}</p>
              <p className="mt-1 font-mono text-[10px] text-mist">
                {counts[sev]} total · {counts[sev] - open} acknowledged
              </p>
            </button>
          );
        })}
      </div>

      {/* ── Alert list ── */}
      <Panel
        eyebrow={`${visible.length} shown`}
        title={category === 'all' ? 'All Alerts' : `${category.toUpperCase()} Alerts`}
        className="mt-3"
        bodyClassName="p-0"
        actions={
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded border px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-wider transition-colors duration-150 ease-out',
                  category === c
                    ? 'border-aqua/60 bg-aqua/12 text-aqua'
                    : 'border-line text-mist hover:border-edge hover:text-chalk',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        }
      >
        <ul className="divide-y divide-line/70">
          {visible.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-4 py-14 text-center">
              <BellIcon className="h-6 w-6 text-ok/70" aria-hidden />
              <p className="text-sm text-mist">Nothing outstanding in this category.</p>
            </li>
          )}
          {visible.map((alert) => {
            const token = severityToken[alert.severity];
            return (
              <li
                key={alert.id}
                className={cn(
                  'flex items-start gap-3.5 px-4 py-4 transition-colors duration-150',
                  alert.acknowledged && 'opacity-55',
                  alert.severity === 'critical' && !alert.acknowledged && 'bg-crit/[0.05]',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 h-9 w-1 shrink-0 rounded-full',
                    token.dot,
                    alert.acknowledged && 'opacity-40',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2
                      className={cn(
                        'font-display font-semibold uppercase tracking-wider',
                        alert.severity === 'critical' ? 'text-[14px]' : 'text-[12px]',
                        token.text,
                      )}
                    >
                      {alert.title}
                    </h2>
                    {alert.vesselId && (
                      <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-mist">
                        {alert.vesselId}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-mist/70">
                      {fmtDate(alert.at)} · {fmtTime(alert.at)}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'mt-1 leading-snug text-mist',
                      alert.severity === 'critical' ? 'text-sm text-chalk' : 'text-[13px]',
                    )}
                  >
                    {alert.message}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {alert.vesselId && (
                      <Link
                        to="/fleet"
                        onClick={() => selectVessel(alert.vesselId!)}
                        className="font-mono text-[10px] text-aqua transition-colors duration-150 hover:text-chalk"
                      >
                        OPEN VESSEL
                      </Link>
                    )}
                    {alert.title?.includes('CONGESTION') && (
                      <Link
                        to="/berths"
                        className="font-mono text-[10px] text-aqua transition-colors duration-150 hover:text-chalk"
                      >
                        OPEN BERTH PLAN
                      </Link>
                    )}
                    {!alert.acknowledged ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<CheckIcon className="h-3 w-3" />}
                        onClick={() => acknowledgeAlert(alert.id)}
                      >
                        Acknowledge
                      </Button>
                    ) : (
                      <span className="font-mono text-[10px] text-ok">ACKNOWLEDGED</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}
