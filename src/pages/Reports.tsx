import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  FileTextIcon, DownloadIcon, PrinterIcon, FileDownIcon, ChevronRightIcon, RefreshCwIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { DataRow } from '../components/ui/DataRow';
import { usePort } from '../contexts/PortContext';
import {
  buildReport, downloadCsv, reportDefinitions, summariseTable, toCsv, type ReportId,
} from '../utils/report';
import { fmtDate, fmtNumber, fmtTime } from '../utils/geo';
import { cn } from '../utils/ui';
import { api } from '../services/api';
import type { ReportData } from '../services/api';

export function Reports() {
  const {
    vessels, derived, berths, cranes, craneAllocations, optimization, now, settings, activePort,
  } = usePort();
  const [active, setActive] = useState<ReportId>('daily');
  const [backendReport, setBackendReport] = useState<ReportData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchBackendReport() {
    setRefreshing(true);
    try {
      const r = await api.getReports();
      setBackendReport(r);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { fetchBackendReport(); }, []);

  const definition = reportDefinitions.find((r) => r.id === active)!;
  const table = useMemo(
    () =>
      buildReport({
        id: active, vessels, derived, berths, cranes, craneAllocations, optimization, now,
      }),
    [active, vessels, derived, berths, cranes, craneAllocations, optimization, now],
  );

  const stamp = `${fmtDate(now)} ${fmtTime(now)}`;
  const portLabel = activePort?.short ?? settings.portName;

  function openPrintWindow(mode: 'print' | 'pdf') {
    const win = window.open('', '_blank', 'width=1024,height=768');
    if (!win) {
      toast.error('Popup blocked', { description: 'Allow popups to print or export a PDF.' });
      return;
    }
    const head = table.columns.map((c) => `<th>${c}</th>`).join('');
    const body = table.rows
      .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
      .join('');
    win.document.write(`<!doctype html><html><head><title>${definition.title} — ${portLabel}</title>
      <style>
        body{font-family:Inter,system-ui,sans-serif;color:#0b1220;margin:32px}
        h1{font-size:18px;margin:0 0 4px;letter-spacing:.06em;text-transform:uppercase}
        p.meta{font-family:ui-monospace,monospace;font-size:11px;color:#475569;margin:0 0 20px}
        table{border-collapse:collapse;width:100%;font-size:11px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
        th{background:#e2e8f0;text-transform:uppercase;font-size:9px;letter-spacing:.08em}
      </style></head><body>
      <h1>NexusPort — ${definition.title}</h1>
      <p class="meta">${portLabel} · generated ${stamp} · ${settings.timezoneLabel}</p>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
    if (mode === 'pdf') {
      toast('Choose "Save as PDF" in the print dialog', { description: `${definition.title} is ready.` });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Operational reporting"
        title="Reports"
        description="Reports are generated from the live register, berth plan and crane allocation at the moment of export."
        actions={
          <>
            <Button
              icon={<RefreshCwIcon className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />}
              onClick={fetchBackendReport}
              disabled={refreshing}
            >
              Refresh
            </Button>
            <Button
              icon={<DownloadIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                downloadCsv(
                  `nexusport-${active}-${fmtDate(now).replace(/ /g, '-')}.csv`,
                  toCsv(table),
                );
                toast.success('CSV exported', { description: definition.title });
              }}
            >
              Export CSV
            </Button>
            <Button icon={<FileDownIcon className="h-3.5 w-3.5" />} onClick={() => openPrintWindow('pdf')}>
              Export PDF
            </Button>
            <Button variant="primary" icon={<PrinterIcon className="h-3.5 w-3.5" />} onClick={() => openPrintWindow('print')}>
              Print Report
            </Button>
          </>
        }
      />

      {/* ── Backend summary card ── */}
      {backendReport && (
        <Panel eyebrow="Backend summary" title="Server Report" className="mb-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <DataRow label="Active Port" value={backendReport.port} tone="text-aqua" />
              <DataRow label="Registered Vessels" value={String(backendReport.registered_vessels)} />
              <DataRow label="Scenario Ships" value={String(backendReport.ships)} />
            </div>
            <div>
              <DataRow label="Cargo (TEU)" value={fmtNumber(backendReport.cargo_teu)} />
              <DataRow label="Unload Time" value={`${backendReport.unload_time_h} h`} />
              <DataRow label="Berths" value={String(backendReport.berths)} />
            </div>
            <div>
              <DataRow
                label="Optimized"
                value={backendReport.optimized ? 'YES' : 'NO'}
                tone={backendReport.optimized ? 'text-ok' : 'text-warn'}
              />
              <DataRow
                label="Emergency Mode"
                value={backendReport.emergency ? 'ACTIVE' : 'Normal'}
                tone={backendReport.emergency ? 'text-crit' : 'text-mist'}
              />
            </div>
          </div>
        </Panel>
      )}

      <div className="grid gap-3 xl:grid-cols-4">
        {/* ── Report type picker ── */}
        <Panel eyebrow="Library" title="Report Types" bodyClassName="p-0">
          <ul className="divide-y divide-line/70">
            {reportDefinitions.map((def) => (
              <li key={def.id}>
                <button
                  type="button"
                  onClick={() => setActive(def.id)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out hover:bg-white/[0.035]',
                    active === def.id && 'bg-aqua/[0.07]',
                  )}
                >
                  <FileTextIcon
                    className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      active === def.id ? 'text-aqua' : 'text-mist',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block font-display text-[11px] font-semibold uppercase tracking-wider',
                        active === def.id ? 'text-aqua' : 'text-chalk',
                      )}
                    >
                      {def.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-mist">
                      {def.description}
                    </span>
                  </span>
                  {active === def.id && (
                    <ChevronRightIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aqua" aria-hidden />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        {/* ── Report table ── */}
        <Panel
          eyebrow={`${portLabel} · generated ${stamp}`}
          title={definition.title}
          className="xl:col-span-3"
          bodyClassName="p-0"
          actions={
            <span className="font-mono text-[10px] text-mist">{summariseTable(table)}</span>
          }
        >
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-line bg-abyss">
                  {table.columns.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="whitespace-nowrap px-4 py-2.5 font-display text-[9px] font-semibold uppercase tracking-wider2 text-mist"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-line/50 transition-colors duration-150 hover:bg-white/[0.03]"
                  >
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={cn(
                          'whitespace-nowrap px-4 py-2 font-mono text-[11px]',
                          j === 0 ? 'text-chalk' : 'text-mist',
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
