import React from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { PortMap } from '../components/map/PortMap';
import { FleetTable } from '../components/vessel/FleetTable';
import { VesselDetailPanel } from '../components/vessel/VesselDetailPanel';
import { usePort } from '../contexts/PortContext';
import { useKpis } from '../hooks/useKpis';
import { useSimulation } from '../hooks/useSimulation';
import { fmtNumber } from '../utils/geo';

export function LiveFleet() {
  const { vessels, derived, port } = usePort();
  const k = useKpis();

  // Use the same simulation engine so the map shows live animated positions
  const simVessels = vessels.map((v) => ({
    id: v.id, lat: v.lat, lon: v.lon,
    speedKnots: v.speedKnots, departure: v.departure,
    unloadingHours: v.unloadingHours, cargoType: v.cargoType,
    loadTonnes: v.loadTonnes, operator: v.operator,
    loa: v.loa, draft: v.draft, teu: v.teu,
  }));

  const { positions, playing, play, pause } = useSimulation({
    portLat: port.lat, portLon: port.lon, vessels: simVessels,
  });

  const farthest = vessels
    .map((v) => derived[v.id]?.distanceKm ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);

  return (
    <>
      <PageHeader
        eyebrow="Real-time tracking"
        title="Live Fleet"
        description={`${k.atSea} vessels on approach · ${k.waiting} at anchorage · ${k.atBerth} alongside. Furthest track ${fmtNumber(farthest)} km out.`}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-line bg-deck/70 p-1">
            <Button
              size="sm"
              variant={playing ? 'primary' : 'ghost'}
              onClick={play}
              disabled={playing}
            >▶ Animate</Button>
            <Button
              size="sm"
              variant={!playing ? 'primary' : 'ghost'}
              onClick={pause}
              disabled={!playing}
            >⏸ Pause</Button>
          </div>
        }
      />
      

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel
          eyebrow="Approach tracks & anchorage"
          title="Traffic Picture"
          className="xl:col-span-2"
          bodyClassName="p-0">
          
          <div className="h-[400px] sm:h-[500px]">
            <PortMap animatedPositions={positions} />
          </div>
        </Panel>
        <VesselDetailPanel />
      </div>

      <FleetTable className="mt-3" />
    </>);

}