/**
 * PortMap – Leaflet satellite map with smooth rAF-driven ship animation.
 *
 * AnimatedShipMarker imperatively calls marker.setLatLng() on every render
 * so ships glide smoothly without React remounting the marker.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer, TileLayer, LayersControl,
  Marker, Circle, Polyline, Popup, Tooltip, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { usePort } from '../../contexts/PortContext';
import type { ShipPosition } from '../../hooks/useSimulation';
import { shipColor } from '../../hooks/useSimulation';
import type { MapBerth } from '../../services/api';

// ── Fix Leaflet icon paths broken by bundlers ───────────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Icon builders ───────────────────────────────────────────────────────────

/**
 * Berth marker — prominent coloured pin so berths are always visible.
 *   GREEN  = berth is free and ready
 *   RED    = berth is occupied / scheduled
 */
function berthIcon(name: string, capacity: number, occupied: boolean): L.DivIcon {
  const bg         = occupied ? '#ef4444' : '#22c55e';
  const glow       = occupied
    ? '0 0 14px 4px rgba(239,68,68,0.55)'
    : '0 0 14px 4px rgba(34,197,94,0.55)';
  const statusText = occupied ? 'BUSY' : 'FREE';
  const statusClr  = occupied ? '#fca5a5' : '#bbf7d0';

  return L.divIcon({
    className: '',
    // anchor: centre-bottom of the pin tip
    iconAnchor: [22, 54],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:0;">
        <!-- Label chip -->
        <div style="
          background:${bg};
          color:#06101c;
          border:2px solid #fff;
          border-radius:8px;
          padding:3px 8px 2px;
          font-weight:900;
          font-size:10px;
          white-space:nowrap;
          box-shadow:${glow},0 2px 8px rgba(0,0,0,0.5);
          font-family:monospace;
          line-height:1.3;
          text-align:center;
        ">
          ${name}<br/>
          <span style="font-size:8px;color:${statusClr};">
            ${statusText} · ${(capacity / 1000).toFixed(0)}k t
          </span>
        </div>
        <!-- Pin stem -->
        <div style="
          width:3px;
          height:12px;
          background:${bg};
          box-shadow:${glow};
        "></div>
        <!-- Pin dot -->
        <div style="
          width:10px;
          height:10px;
          border-radius:50%;
          background:${bg};
          border:2px solid #fff;
          box-shadow:${glow};
        "></div>
      </div>`,
  });
}

function portIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconAnchor: [18, 18],
    html: `<div style="width:36px;height:36px;border-radius:50%;
      background:rgba(34,211,238,0.2);border:3px solid #22d3ee;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 0 18px rgba(34,211,238,0.6);">⚓</div>`,
  });
}

function makeShipIcon(ship: ShipPosition): L.DivIcon {
  const isWaiting = ship.status === 'Waiting at Anchorage';
  const isHalted  = ship.halted;
  const bg    = isHalted ? '#ef4444' : isWaiting ? '#f59e0b' : ship.color;
  const glow  = isHalted
    ? '0 0 0 4px rgba(239,68,68,0.4),0 2px 10px rgba(0,0,0,.6)'
    : isWaiting
    ? '0 0 0 4px rgba(245,158,11,0.35),0 2px 10px rgba(0,0,0,.6)'
    : '0 2px 10px rgba(0,0,0,.55)';
  const short = ship.ship_id.replace(/[A-Za-z-]*/g, '').replace('0', '') || ship.index + 1;
  return L.divIcon({
    className: '',
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;border-radius:50%;background:${bg};
      border:3px solid #fff;box-shadow:${glow};
      display:flex;align-items:center;justify-content:center;
      color:#06101c;font-weight:900;font-size:11px;font-family:monospace;">
      ${isHalted ? '⚠' : short}</div>`,
  });
}

// ── Re-centre map when port changes ────────────────────────────────────────
function MapRecentre({ lat, lon, zoom }: { lat: number; lon: number; zoom: number }) {
  const map = useMap();
  const prev = useRef('');
  useEffect(() => {
    const key = `${lat},${lon}`;
    if (key !== prev.current) {
      map.setView([lat, lon], zoom, { animate: true });
      prev.current = key;
    }
  }, [lat, lon, zoom, map]);
  return null;
}

// ── AnimatedShipMarker ──────────────────────────────────────────────────────
// Creates the Leaflet marker once, then imperatively moves it every render.
// This gives sub-frame smooth animation without React reconciliation overhead.
function AnimatedShipMarker({
  ship,
  berthCoords,
  showRoutes,
  selected,
  onSelect,
}: {
  ship: ShipPosition;
  berthCoords: Record<string, [number, number]>;
  showRoutes: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const map       = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const posStr    = `${ship.lat.toFixed(6)},${ship.lon.toFixed(6)}`;

  // Create marker once on mount, clean up on unmount
  useEffect(() => {
    const m = L.marker([ship.lat, ship.lon], {
      icon: makeShipIcon(ship),
      zIndexOffset: selected ? 1000 : 100,
    }).addTo(map);
    m.on('click', onSelect);
    markerRef.current = m;
    return () => { m.remove(); markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]); // ← only depends on map, never recreated

  // Move + restyle on every render (called every rAF tick from parent)
  useEffect(() => {
    const m = markerRef.current;
    if (!m) return;
    m.setLatLng([ship.lat, ship.lon]);
    m.setIcon(makeShipIcon(ship));
    m.setZIndexOffset(selected ? 1000 : 100);
  }); // ← no dep array → runs after every render

  const isApproach = ship.status === 'Approaching';
  const isWaiting  = ship.status === 'Waiting at Anchorage';
  const pos: [number, number] = [ship.lat, ship.lon];
  const color = ship.halted ? '#ef4444' : isWaiting ? '#f59e0b' : ship.color;
  const berthLL = berthCoords[ship.ship_id] ?? null;

  return (
    <>
      {/* Anchorage holding ring */}
      {isWaiting && (
        <Circle center={pos} radius={300}
          pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.15, weight: 1.5 }} />
      )}
      {/* Emergency halt ring */}
      {ship.halted && (
        <Circle center={pos} radius={400}
          pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.1, weight: 2, dashArray: '5 4' }} />
      )}
      {/* Selection highlight */}
      {selected && (
        <Circle center={pos} radius={220}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: '4 4' }} />
      )}
      {/* Route line to assigned berth */}
      {showRoutes && berthLL && (isApproach || isWaiting) && (
        <Polyline
          positions={[pos, berthLL]}
          pathOptions={{
            color: isWaiting ? '#f59e0b' : 'rgba(34,211,238,0.5)',
            weight: isWaiting ? 2.5 : 1.5,
            dashArray: '7 8',
          }}
        />
      )}
    </>
  );
}

// ── Props ───────────────────────────────────────────────────────────────────
interface PortMapProps {
  className?: string;
  animatedPositions?: ShipPosition[];
  berthShipMap?: Record<string, string>;
}

// ── Main map ────────────────────────────────────────────────────────────────
export function PortMap({ className, animatedPositions, berthShipMap = {} }: PortMapProps) {
  const {
    port, vessels, optimization, selectedVesselId, selectVessel,
    mapSnapshot, activePort, settings,
  } = usePort();

  const zoom = activePort ? (activePort.berths > 15 ? 13 : 14) : 13;
  const portLabel = activePort?.short ?? port.name;
  const snapshotBerths: MapBerth[] = mapSnapshot?.berths ?? [];

  // ship_id → berth [lat, lon] for route lines
  const berthCoords = useMemo<Record<string, [number, number]>>(() => {
    const nameToLL: Record<string, [number, number]> = {};
    snapshotBerths.forEach((b) => { nameToLL[b.name] = [b.lat, b.lon]; });
    const out: Record<string, [number, number]> = {};
    Object.entries(berthShipMap).forEach(([bName, shipId]) => {
      if (nameToLL[bName]) out[shipId] = nameToLL[bName];
    });
    optimization?.assignments?.forEach((a) => {
      const b = snapshotBerths.find((b) => b.name === a.berthId);
      if (b) out[a.vesselId] = [b.lat, b.lon];
    });
    return out;
  }, [snapshotBerths, berthShipMap, optimization]);

  // Resolve ship entries: animated > snapshot > local
  const shipEntries: ShipPosition[] = useMemo(() => {
    if (animatedPositions && animatedPositions.length > 0) return animatedPositions;
    if (mapSnapshot?.ships?.length) {
      return mapSnapshot.ships.map((s) => ({
        ship_id: s.ship_id, lat: s.lat, lon: s.lon,
        status: s.status as ShipPosition['status'],
        color: s.color ?? shipColor(s.index), index: s.index,
        speed_knots: 0, eta: s.eta,
        cargo_type: s.cargo_type, weight_tonnes: Number(s.weight_tonnes),
        operator: s.operator, loa_m: Number(s.loa_m), draft_m: Number(s.draft_m),
        halted: false, halt_hours: 0, halt_reason: '', progress: 0,
      }));
    }
    return vessels.map((v, i) => ({
      ship_id: v.id, lat: v.lat, lon: v.lon,
      status: 'Approaching' as const, color: shipColor(i), index: i,
      speed_knots: v.speedKnots, eta: v.departure,
      cargo_type: v.cargoType, weight_tonnes: v.loadTonnes,
      operator: v.operator, loa_m: v.loa, draft_m: v.draft,
      halted: false, halt_hours: 0, halt_reason: '', progress: 0,
    }));
  }, [animatedPositions, mapSnapshot, vessels]);

  return (
    <div
      className={className}
      style={{ width: '100%', height: '100%', minHeight: 400, position: 'relative' }}
    >
      <MapContainer
        center={[port.lat, port.lon]}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        zoomControl
        attributionControl
      >
        <MapRecentre lat={port.lat} lon={port.lon} zoom={zoom} />

        <LayersControl position="topright">
          {/* ── Base layers ── */}
          <LayersControl.BaseLayer checked name="Satellite (Esri)">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri"
              maxZoom={20}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Street Map (OSM)">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* ── Port anchor ── */}
          <LayersControl.Overlay checked name="Port">
            <Marker position={[port.lat, port.lon]} icon={portIcon()}>
              <Tooltip permanent direction="top" offset={[0, -22]}>
                <span style={{ fontWeight: 800, color: '#22d3ee', fontSize: 12, letterSpacing: '0.1em' }}>
                  {portLabel}
                </span>
              </Tooltip>
              <Popup>
                <b style={{ fontSize: 14 }}>{portLabel}</b><br />
                {activePort && <><span style={{ color: '#666' }}>State: </span>{activePort.state}<br /></>}
                <span style={{ color: '#666' }}>Berths: </span><b>{activePort?.berths ?? '—'}</b><br />
                <span style={{ color: '#666' }}>Lat/Lon: </span>{port.lat.toFixed(4)}, {port.lon.toFixed(4)}
              </Popup>
            </Marker>
          </LayersControl.Overlay>

          {/* ── Berth markers ── */}
          <LayersControl.Overlay checked name="Berths">
            <>
              {snapshotBerths.map((b) => (
                <Marker
                  key={b.name}
                  position={[b.lat, b.lon]}
                  icon={berthIcon(b.name, b.capacity_tonnes, b.occupied)}
                >
                  <Popup>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 230 }}>
                      <div style={{
                        background: b.occupied ? '#7f1d1d' : '#14532d',
                        color: b.occupied ? '#fca5a5' : '#bbf7d0',
                        border: `1px solid ${b.occupied ? '#ef4444' : '#22c55e'}`,
                        borderRadius: 6, padding: '4px 10px',
                        marginBottom: 8, fontWeight: 900,
                        fontSize: 13, textAlign: 'center',
                        letterSpacing: '0.08em',
                      }}>
                        {b.occupied ? '🔴  OCCUPIED' : '🟢  AVAILABLE'}
                      </div>
                      <b style={{ fontSize: 14 }}>{b.name}</b><br />
                      <span style={{ color: '#888' }}>Capacity: </span>
                      <b>{b.capacity_tonnes.toLocaleString()} t</b><br />
                      <span style={{ color: '#888' }}>Max LOA: </span>{b.max_loa_m} m
                      &nbsp;&nbsp;
                      <span style={{ color: '#888' }}>Draft: </span>{b.max_draft_m} m<br />
                      <span style={{ color: '#888' }}>Cargo: </span>
                      {b.cargo_types.join(', ')}<br />
                      {b.assigned_ships.length > 0 && (
                        <>
                          <span style={{ color: '#888' }}>Assigned: </span>
                          <b style={{ color: '#ef4444' }}>{b.assigned_ships.join(', ')}</b>
                        </>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </>
          </LayersControl.Overlay>

          {/* ── Animated ships ── */}
          <LayersControl.Overlay checked name="Ships">
            <>
              {shipEntries.map((ship) => (
                <AnimatedShipMarker
                  key={ship.ship_id}
                  ship={ship}
                  berthCoords={berthCoords}
                  showRoutes={settings.showRouteLines}
                  selected={selectedVesselId === ship.ship_id}
                  onSelect={() => selectVessel(ship.ship_id)}
                />
              ))}
            </>
          </LayersControl.Overlay>
        </LayersControl>
      </MapContainer>

      {/* ── Status legend ── */}
      <div style={{
        position: 'absolute', bottom: 30, left: 8, zIndex: 1000,
        background: 'rgba(6,11,21,0.92)', border: '1px solid rgba(103,155,206,0.2)',
        borderRadius: 8, padding: '6px 10px', backdropFilter: 'blur(4px)',
        display: 'flex', flexWrap: 'wrap', gap: '6px 14px', pointerEvents: 'none',
      }}>
        {([
          ['APPROACHING', '#22d3ee'],
          ['SERVICING',   '#34d399'],
          ['ANCHORAGE',   '#f59e0b'],
          ['HALTED',      '#ef4444'],
          ['DEPARTED',    '#3b82f6'],
          ['BERTH FREE',  '#22c55e'],
          ['BERTH BUSY',  '#ef4444'],
        ] as [string, string][]).map(([lbl, clr]) => (
          <span key={lbl} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontFamily: 'monospace', fontSize: 9,
            color: 'rgba(139,162,198,0.9)', letterSpacing: '0.08em',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: clr, display: 'inline-block' }} />
            {lbl}
          </span>
        ))}
      </div>
    </div>
  );
}
