import React from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { PortMap } from '../components/map/PortMap';
import { FleetTable } from '../components/vessel/FleetTable';
import { VesselDetailPanel } from '../components/vessel/VesselDetailPanel';
import { usePort } from '../contexts/PortContext';
import { useKpis } from '../hooks/useKpis';
import { fmtNumber } from '../utils/geo';

export function LiveFleet() {
  const { vessels, derived } = usePort();
  const k = useKpis();

  const farthest = vessels.
  map((v) => derived[v.id]?.distanceKm ?? 0).
  reduce((a, b) => Math.max(a, b), 0);

  return (
    <>
      <PageHeader
        eyebrow="Real-time tracking"
        title="Live Fleet"
        description={`${k.atSea} vessels on approach · ${k.waiting} at anchorage · ${k.atBerth} alongside. Furthest track ${fmtNumber(farthest)} km out.`} />
      

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel
          eyebrow="Approach tracks & anchorage"
          title="Traffic Picture"
          className="xl:col-span-2"
          bodyClassName="p-0">
          
          <div className="h-[400px] sm:h-[500px]">
            <PortMap />
          </div>
        </Panel>
        <VesselDetailPanel />
      </div>

      <FleetTable className="mt-3" />
    </>);

}