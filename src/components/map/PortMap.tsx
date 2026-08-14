/**
 * PortMap – Leaflet satellite map with smooth rAF-driven ship animation.
 *
 * Berth markers:
 *   GREEN  = no ship currently servicing at this berth
 *   RED    = a ship is currently at this berth (Servicing status)
 *   Driven by animatedPositions in real-time, NOT just backend snapshot.
 *
 * Ship lifecycle on map:
 *   APPROACHING  → coloured circle moving toward port
 *   ANCHORAGE    → amber circle with holding ring, dashed line to berth
 *   SERVICING    → green circle parked at berth, berth turns RED
 *   DEPARTED     → blue faded circle moving away from port with dotted trail
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

// ── Fix Leaflet icon paths ──────────────────────────────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Berth pin icon ──────────────────────────────────────────────────────────
// GREEN when free, RED when a ship is servicing there.
// The pin has a label chip + stem + dot so it's clearly visible on satellite.
function berthIcon(name: string, capacity: number, occupied: boolean): L.DivIcon {
  const bg       = occupied ? '#ef4444' : '#22c55e';
  const glow     = occupied
    ? '0 0 12px 4px rgba(239,68,68,0.6)'
    : '0 0 12px 4px rgba(34,197,94,0.6)';
  const badge    = occupied ? 'BUSY' : 'FREE';
  const badgeClr = occupied ? '#fca5a5' : '#bbf7d0';

  return L.divIcon({
    className: '',
    iconAnchor: [24, 58],
    iconSize:   [48, 58],
    html: `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="
        background:${bg};color:#06101c;border:2.5px solid #fff;
        border-radius:9px;padding:3px 8px 2px;font-weight:900;font-size:10px;
        white-space:nowrap;box-shadow:${glow},0 2px 8px rgba(0,0,0,0.55);
        font-family:monospace;line-height:1.35;text-align:center;min-width:48px;">
        ${name}
        <br/><span style="font-size:8px;color:${badgeClr};letter-spacing:.04em;">
          ${badge} · ${(capacity/1000).toFixed(0)}kt
        </span>
      </div>
      <div style="width:3px;height:14px;background:${bg};box-shadow:${glow};"></div>
      <div style="width:11px;height:11px;border-radius:50%;background:${bg};
        border:2.5px solid #fff;box-shadow:${glow};margin-top:-1px;"></div>
    </div>`,
  });
}

// ── Port icon ───────────────────────────────────────────────────────────────
function portIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconAnchor: [20, 20],
    iconSize:   [40, 40],
    html: `<div style="width:40px;height:40px;border-radius:50%;
      background:rgba(34,211,238,0.18);border:3px solid #22d3ee;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 0 20px 6px rgba(34,211,238,0.45);font-size:18px;">⚓</div>`,
  });
}

// ── Ship icon ───────────────────────────────────────────────────────────────
function makeShipIcon(ship: ShipPosition): L.DivIcon {
  const isDep     = ship.status === 'Departed';
  const isWaiting = ship.status === 'Waiting at Anchorage';
  const isService = ship.status === 'Servicing';
  const isHalted  = ship.halted;

  const bg =
    isHalted  ? '#ef4444' :
    isDep     ? '#3b82f6' :
    isWaiting ? '#f59e0b' :
    isService ? '#34d399' :
    ship.color;

  const opacity = isDep ? '0.6' : '1';
  const border  = isDep ? '#94a3b8' : '#fff';

  const glow =
    isHalted  ? '0 0 0 5px rgba(239,68,68,0.45),0 2px 10px rgba(0,0,0,.6)' :
    isWaiting ? '0 0 0 4px rgba(245,158,11,0.4),0 2px 10px rgba(0,0,0,.6)' :
    isService ? '0 0 0 4px rgba(52,211,153,0.4),0 2px 10px rgba(0,0,0,.6)' :
    isDep     ? '0 2px 6px rgba(0,0,0,.4)' :
    '0 2px 10px rgba(0,0,0,.55)';

  // Short label: strip letters, show just the number
  const num = ship.ship_id.replace(/\D/g, '') || String(ship.index + 1);
  const label =
    isHalted  ? '⚠' :
    isDep     ? '↗' :
    isService ? num :
    num;

  return L.divIcon({
    className: '',
    iconAnchor: [18, 18],
    iconSize:   [36, 36],
    html: `<div style="
      width:36px;height:36px;border-radius:50%;
      background:${bg};border:3px solid ${border};
      box-shadow:${glow};opacity:${opacity};
      display:flex;align-items:center;justify-content:center;
      color:#06101c;font-weight:900;font-size:12px;font-family:monospace;">
      ${label}
    </div>`,
  });
}

// ── Map re-centre ───────────────────────────────────────────────────────────
function MapRecentre({ lat, lon, zoom }: { lat: number; lon: number; zoom: number }) {
  const map  = useMap();
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
// Creates the Leaflet marker once, imperatively moves it every render tick.
function AnimatedShipMarker({
  ship, berthCoords, showRoutes, selected, onSelect,
}: {
  ship: ShipPosition;
  berthCoords: Record<string, [number, number]>;
  showRoutes: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const map       = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  // Create once on mount
  useEffect(() => {
    const m = L.marker([ship.lat, ship.lon], {
      icon: makeShipIcon(ship),
      zIndexOffset: selected ? 1000 : 100,
    }).addTo(map);
    m.on('click', onSelect);
    markerRef.current = m;
    return () => { m.remove(); markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Update position + icon on every render (every rAF tick)
  useEffect(() => {
    const m = markerRef.current;
    if (!m) return;
    m.setLatLng([ship.lat, ship.lon]);
    m.setIcon(makeShipIcon(ship));
    m.setZIndexOffset(selected ? 1000 : 100);
  });

  const isApproach  = ship.status === 'Approaching';
  const isWaiting   = ship.status === 'Waiting at Anchorage';
  const isDeparted  = ship.status === 'Departed';
  const isServicing = ship.status === 'Servicing';
  const pos: [number, number]   = [ship.lat, ship.lon];
  const color = ship.halted ? '#ef4444' : isWaiting ? '#f59e0b' : isServicing ? '#34d399' : isDeparted ? '#3b82f6' : ship.color;
  const berthLL = berthCoords[ship.ship_id] ?? null;

  return (
    <>
      {/* Anchorage holding ring — amber pulsing */}
      {isWaiting && (
        <Circle center={pos} radius={320}
          pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.12, weight: 2, dashArray: '6 5' }} />
      )}

      {/* Servicing ring — green glow at berth */}
      {isServicing && (
        <Circle center={pos} radius={150}
          pathOptions={{ color: '#34d399', fillColor: '#34d399', fillOpacity: 0.14, weight: 2 }} />
      )}

      {/* Departed trail — faded blue circle */}
      {isDeparted && (
        <Circle center={pos} radius={200}
          pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.08, weight: 1, dashArray: '4 6' }} />
      )}

      {/* Emergency halt ring */}
      {ship.halted && (
        <Circle center={pos} radius={420}
          pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.08, weight: 2, dashArray: '5 4' }} />
      )}

      {/* Selection ring */}
      {selected && (
        <Circle center={pos} radius={240}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: '4 4' }} />
      )}

      {/* Route line: approaching / waiting → berth */}
      {showRoutes && berthLL && (isApproach || isWaiting) && (
        <Polyline
          positions={[pos, berthLL]}
          pathOptions={{
            color: isWaiting ? '#f59e0b' : 'rgba(34,211,238,0.55)',
            weight: isWaiting ? 2.5 : 1.5,
            dashArray: '8 7',
            opacity: selected ? 1 : 0.7,
          }}
        />
      )}

      {/* Departure trail: dotted line back from port */}
      {isDeparted && (
        <Polyline
          positions={[
            [ship.lat - 0.04, ship.lon - 0.04],
            pos,
          ]}
          pathOptions={{ color: '#3b82f6', weight: 1.5, dashArray: '4 8', opacity: 0.4 }}
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

  const zoom       = activePort ? (activePort.berths > 15 ? 13 : 14) : 13;
  const portLabel  = activePort?.short ?? port.name;

  // Berths: prefer backend snapshot for geo coords; override occupied state
  // from animatedPositions so berths turn red/green in real-time.
  const snapshotBerths: MapBerth[] = mapSnapshot?.berths ?? [];

  // Build set of berths currently occupied by servicing ships
  const servicingBerths = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    if (!animatedPositions) return s;
    animatedPositions.forEach((ship) => {
      if (ship.status === 'Servicing') {
        // Find the berth nearest to this ship's current position
        let nearest = '';
        let minDist = Infinity;
        snapshotBerths.forEach((b) => {
          const d = Math.hypot(b.lat - ship.lat, b.lon - ship.lon);
          if (d < minDist) { minDist = d; nearest = b.name; }
        });
        if (nearest) s.add(nearest);
      }
    });
    // Also respect backend snapshot assignments
    snapshotBerths.forEach((b) => { if (b.occupied) s.add(b.name); });
    return s;
  }, [animatedPositions, snapshotBerths]);

  // berth name → [lat, lon] for route lines
  const berthNameToLL = useMemo<Record<string, [number, number]>>(() => {
    const out: Record<string, [number, number]> = {};
    snapshotBerths.forEach((b) => { out[b.name] = [b.lat, b.lon]; });
    return out;
  }, [snapshotBerths]);

  // ship_id → nearest berth [lat,lon] for route lines
  const berthCoords = useMemo<Record<string, [number, number]>>(() => {
    const out: Record<string, [number, number]> = {};
    Object.entries(berthShipMap).forEach(([bName, shipId]) => {
      if (berthNameToLL[bName]) out[shipId] = berthNameToLL[bName];
    });
    optimization?.assignments?.forEach((a) => {
      const b = snapshotBerths.find((b) => b.name === a.berthId);
      if (b) out[a.vesselId] = [b.lat, b.lon];
    });
    return out;
  }, [berthNameToLL, berthShipMap, optimization, snapshotBerths]);

  // Resolve ship entries: animated > snapshot > local register
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
    <div className={className}
      style={{ width: '100%', height: '100%', minHeight: 400, position: 'relative' }}>
      <MapContainer
        center={[port.lat, port.lon]}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        zoomControl attributionControl>

        <MapRecentre lat={port.lat} lon={port.lon} zoom={zoom} />

        <LayersControl position="topright">

          {/* ── Base tile layers ── */}
          <LayersControl.BaseLayer checked name="Satellite (Esri)">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri" maxZoom={20} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Street Map (OSM)">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
              maxZoom={19} />
          </LayersControl.BaseLayer>

          {/* ── Port marker ── */}
          <LayersControl.Overlay checked name="Port">
            <Marker position={[port.lat, port.lon]} icon={portIcon()}>
              <Tooltip permanent direction="top" offset={[0, -24]}>
                <span style={{ fontWeight: 800, color: '#22d3ee', fontSize: 12, letterSpacing: '0.1em' }}>
                  {portLabel}
                </span>
              </Tooltip>
              <Popup>
                <div style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 200 }}>
                  <b style={{ fontSize: 14 }}>{portLabel}</b><br />
                  {activePort && <><span style={{ color: '#666' }}>State: </span>{activePort.state}<br /></>}
                  <span style={{ color: '#666' }}>Berths: </span>
                  <b>{activePort?.berths ?? '—'}</b><br />
                  <span style={{ color: '#666' }}>Coords: </span>
                  {port.lat.toFixed(4)}, {port.lon.toFixed(4)}
                </div>
              </Popup>
            </Marker>
          </LayersControl.Overlay>

          {/* ── Berth markers ── */}
          {/* Coloured in real-time: GREEN=free, RED=ship servicing here */}
          <LayersControl.Overlay checked name="Berths">
            <>
              {snapshotBerths.map((b) => {
                const occupied = servicingBerths.has(b.name);
                return (
                  <Marker
                    key={b.name}
                    position={[b.lat, b.lon]}
                    icon={berthIcon(b.name, b.capacity_tonnes, occupied)}>
                    <Popup>
                      <div style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 230 }}>
                        {/* Status banner */}
                        <div style={{
                          background: occupied ? '#7f1d1d' : '#14532d',
                          color: occupied ? '#fca5a5' : '#bbf7d0',
                          border: `2px solid ${occupied ? '#ef4444' : '#22c55e'}`,
                          borderRadius: 7, padding: '5px 12px',
                          marginBottom: 10, fontWeight: 900, fontSize: 14,
                          textAlign: 'center', letterSpacing: '0.06em',
                        }}>
                          {occupied ? '🔴  OCCUPIED' : '🟢  AVAILABLE'}
                        </div>
                        <b style={{ fontSize: 13 }}>{b.name}</b><br />
                        <span style={{ color: '#888' }}>Capacity: </span>
                        <b>{b.capacity_tonnes.toLocaleString()} t</b><br />
                        <span style={{ color: '#888' }}>Max LOA: </span>{b.max_loa_m} m &nbsp;
                        <span style={{ color: '#888' }}>Draft: </span>{b.max_draft_m} m<br />
                        <span style={{ color: '#888' }}>Cargo: </span>
                        {b.cargo_types.join(', ')}<br />
                        {b.assigned_ships.length > 0 && (
                          <><span style={{ color: '#888' }}>Ship: </span>
                            <b style={{ color: '#ef4444' }}>{b.assigned_ships.join(', ')}</b></>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
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

      {/* ── Legend ── */}
      <div style={{
        position: 'absolute', bottom: 30, left: 8, zIndex: 1000,
        background: 'rgba(6,11,21,0.92)', border: '1px solid rgba(103,155,206,0.22)',
        borderRadius: 9, padding: '7px 12px', backdropFilter: 'blur(6px)',
        display: 'flex', flexWrap: 'wrap', gap: '6px 16px', pointerEvents: 'none',
      }}>
        {([
          ['BERTH FREE',   '#22c55e'],
          ['BERTH BUSY',   '#ef4444'],
          ['APPROACHING',  '#22d3ee'],
          ['ANCHORAGE',    '#f59e0b'],
          ['SERVICING',    '#34d399'],
          ['DEPARTED',     '#3b82f6'],
          ['HALTED',       '#ef4444'],
        ] as [string, string][]).map(([lbl, clr]) => (
          <span key={lbl} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontFamily: 'monospace', fontSize: 9,
            color: 'rgba(200,215,230,0.9)', letterSpacing: '0.07em',
          }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: clr, flexShrink: 0 }} />
            {lbl}
          </span>
        ))}
      </div>
    </div>
  );
}
