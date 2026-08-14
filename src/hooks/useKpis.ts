import { useMemo } from 'react';
import { usePort } from '../contexts/PortContext';

export interface Kpis {
  active: number;
  atSea: number;
  atBerth: number;
  waiting: number;
  departing: number;
  totalCargo: number;
  totalTeu: number;
  berthUtilization: number;
  craneUtilization: number;
  optimizationScore: number;
  avgWaitingHours: number;
  totalWaitingHours: number;
  spoilageRiskCount: number;
  activeCranes: number;
  operationalCranes: number;
}

export function useKpis(): Kpis {
  const { vessels, derived, optimization, craneAllocations, cranes } = usePort();

  return useMemo(() => {
    const inPort = vessels.filter((v) => v.status !== 'departing');
    const operational = craneAllocations.filter((c) => c.status !== 'maintenance');
    const craneUtilization = operational.length ?
    Math.round(operational.reduce((s, c) => s + c.utilization, 0) / operational.length) :
    0;
    const assignments = optimization?.assignments ?? [];

    return {
      active: inPort.length,
      atSea: vessels.filter((v) => v.status === 'approaching').length,
      atBerth: vessels.filter((v) => v.status === 'berthed').length,
      waiting: vessels.filter((v) => v.status === 'waiting').length,
      departing: vessels.filter((v) => v.status === 'departing').length,
      totalCargo: inPort.reduce((s, v) => s + v.loadTonnes, 0),
      totalTeu: inPort.reduce((s, v) => s + v.teu, 0),
      berthUtilization: optimization?.berthUtilization ?? 0,
      craneUtilization,
      optimizationScore: optimization?.score ?? 0,
      avgWaitingHours: assignments.length ?
      (optimization?.totalWaitingHours ?? 0) / assignments.length :
      0,
      totalWaitingHours: optimization?.totalWaitingHours ?? 0,
      spoilageRiskCount: vessels.filter((v) => {
        const d = derived[v.id];
        return d && d.spoilageRisk !== 'none';
      }).length,
      activeCranes: craneAllocations.filter((c) => c.status === 'active').length,
      operationalCranes: cranes.filter((c) => c.status === 'operational').length
    };
  }, [vessels, derived, optimization, craneAllocations, cranes]);
}