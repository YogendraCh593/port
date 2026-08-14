import type {
  Berth,
  CraneAllocation,
  Crane,
  OptimizationResult,
  Vessel,
  VesselDerived } from
'../types';
import { fmtDate, fmtNumber, fmtTime, hoursBetween } from './geo';

export type ReportId =
'daily' |
'vessel' |
'berth' |
'crane' |
'optimization' |
'throughput';

export interface ReportDefinition {
  id: ReportId;
  title: string;
  description: string;
}

export const reportDefinitions: ReportDefinition[] = [
{
  id: 'daily',
  title: 'Daily Operations Report',
  description: 'Consolidated snapshot of fleet status, berth plan and queue exposure.'
},
{
  id: 'vessel',
  title: 'Vessel Report',
  description: 'Per-vessel voyage math, allocation and spoilage exposure.'
},
{
  id: 'berth',
  title: 'Berth Utilization Report',
  description: 'Occupancy hours, scheduled vessels and envelope limits per berth.'
},
{
  id: 'crane',
  title: 'Crane Utilization Report',
  description: 'Crane assignment, tonnage on the hook and utilisation against rated capacity.'
},
{
  id: 'optimization',
  title: 'Optimization Report',
  description: 'Solver configuration, convergence outcome and resulting allocation.'
},
{
  id: 'throughput',
  title: 'Cargo Throughput Report',
  description: 'Cargo and TEU volume by operator and cargo type.'
}];


export interface ReportTable {
  columns: string[];
  rows: (string | number)[][];
}

interface BuildArgs {
  id: ReportId;
  vessels: Vessel[];
  derived: Record<string, VesselDerived>;
  berths: Berth[];
  cranes: Crane[];
  craneAllocations: CraneAllocation[];
  optimization: OptimizationResult | null;
  now: Date;
}

export function buildReport({
  id,
  vessels,
  derived,
  berths,
  cranes,
  craneAllocations,
  optimization,
  now
}: BuildArgs): ReportTable {
  switch (id) {
    case 'vessel':
      return {
        columns: [
        'Ship ID',
        'Operator',
        'Cargo',
        'Load (t)',
        'TEU',
        'LOA (m)',
        'Draft (m)',
        'Speed (kn)',
        'Distance (km)',
        'ETA',
        'Expected End',
        'Berth',
        'Wait (h)',
        'Status'],

        rows: vessels.map((v) => {
          const d = derived[v.id];
          const a = optimization?.assignments.find((x) => x.vesselId === v.id);
          return [
          v.id,
          v.operator,
          v.cargoType,
          v.loadTonnes,
          v.teu,
          v.loa,
          v.draft,
          v.speedKnots,
          d ? Number(d.distanceKm.toFixed(1)) : 0,
          d ? `${fmtDate(d.eta)} ${fmtTime(d.eta)}` : '—',
          d ? `${fmtDate(d.expectedEnd)} ${fmtTime(d.expectedEnd)}` : '—',
          a ? a.berthId : 'PENDING',
          a ? Number(a.waitingHours.toFixed(2)) : 0,
          v.status.toUpperCase()];

        })
      };

    case 'berth':
      return {
        columns: ['Berth', 'Max LOA (m)', 'Max Draft (m)', 'Crane Slots', 'Scheduled Vessels', 'Occupancy (h)', 'Status'],
        rows: berths.map((b) => {
          const rows = optimization?.assignments.filter((a) => a.berthId === b.id) ?? [];
          const hours = rows.reduce((s, a) => s + hoursBetween(a.start, a.end), 0);
          return [
          b.name,
          b.maxLoa,
          b.maxDraft,
          b.craneSlots,
          rows.map((r) => r.vesselId).join(' / ') || '—',
          Number(hours.toFixed(1)),
          b.status.toUpperCase()];

        })
      };

    case 'crane':
      return {
        columns: ['Crane', 'Berth', 'Vessel', 'Assigned (t)', 'Rated (t/h)', 'Utilization (%)', 'Status'],
        rows: craneAllocations.map((a) => {
          const crane = cranes.find((c) => c.id === a.craneId);
          return [
          a.craneId,
          a.berthId,
          a.vesselId ?? '—',
          a.assignedTonnes,
          crane?.capacityTph ?? 0,
          a.utilization,
          a.status.toUpperCase()];

        })
      };

    case 'optimization':
      return {
        columns: ['Metric', 'Value'],
        rows: [
        ['Solved at', optimization ? `${fmtDate(optimization.solvedAt)} ${fmtTime(optimization.solvedAt)}` : '—'],
        ['Optimization score (%)', optimization?.score ?? 0],
        ['Objective value', optimization?.objectiveValue ?? 0],
        ['Iterations', optimization?.iterations ?? 0],
        ['QUBO variables', optimization?.quboVariables ?? 0],
        ['Constraints', optimization?.constraints ?? 0],
        ['Assignments', optimization?.assignments.length ?? 0],
        ['Infeasible vessels', optimization?.unassigned.join(' / ') || 'none'],
        ['Total waiting (h)', Number((optimization?.totalWaitingHours ?? 0).toFixed(2))],
        ['Berth utilization (%)', optimization?.berthUtilization ?? 0],
        ['Vessels at anchorage', optimization?.anchorage.length ?? 0]]

      };

    case 'throughput':{
        const byOperator = new Map<string, {tonnes: number;teu: number;count: number;}>();
        vessels.forEach((v) => {
          const cur = byOperator.get(v.operator) ?? { tonnes: 0, teu: 0, count: 0 };
          byOperator.set(v.operator, {
            tonnes: cur.tonnes + v.loadTonnes,
            teu: cur.teu + v.teu,
            count: cur.count + 1
          });
        });
        return {
          columns: ['Operator', 'Vessels', 'Cargo (t)', 'TEU', 'Share of Tonnage (%)'],
          rows: [...byOperator.entries()].map(([operator, agg]) => {
            const total = vessels.reduce((s, v) => s + v.loadTonnes, 0) || 1;
            return [
            operator,
            agg.count,
            agg.tonnes,
            agg.teu,
            Number((agg.tonnes / total * 100).toFixed(1))];

          })
        };
      }

    case 'daily':
    default:{
        const inPort = vessels.filter((v) => v.status !== 'departing');
        const operational = craneAllocations.filter((c) => c.status !== 'maintenance');
        return {
          columns: ['Metric', 'Value'],
          rows: [
          ['Report timestamp', `${fmtDate(now)} ${fmtTime(now)}`],
          ['Vessels tracked', vessels.length],
          ['Active in port', inPort.length],
          ['On approach', vessels.filter((v) => v.status === 'approaching').length],
          ['At berth', vessels.filter((v) => v.status === 'berthed').length],
          ['Waiting at anchorage', vessels.filter((v) => v.status === 'waiting').length],
          ['Departing', vessels.filter((v) => v.status === 'departing').length],
          ['Total cargo in pipeline (t)', inPort.reduce((s, v) => s + v.loadTonnes, 0)],
          ['Total TEU in pipeline', inPort.reduce((s, v) => s + v.teu, 0)],
          ['Berth utilization (%)', optimization?.berthUtilization ?? 0],
          [
          'Crane utilization (%)',
          operational.length ?
          Math.round(operational.reduce((s, c) => s + c.utilization, 0) / operational.length) :
          0],

          ['Optimization score (%)', optimization?.score ?? 0],
          ['Total waiting (h)', Number((optimization?.totalWaitingHours ?? 0).toFixed(2))],
          [
          'Spoilage-risk vessels',
          vessels.filter((v) => derived[v.id] && derived[v.id].spoilageRisk !== 'none').length]]


        };
      }
  }
}

export function toCsv(table: ReportTable): string {
  const escape = (cell: string | number) => {
    const value = String(cell);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  return [table.columns.map(escape).join(','), ...table.rows.map((r) => r.map(escape).join(','))].join(
    '\n'
  );
}

export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function summariseTable(table: ReportTable): string {
  return `${table.rows.length} rows × ${table.columns.length} columns · ${fmtNumber(
    table.rows.length * table.columns.length
  )} cells`;
}