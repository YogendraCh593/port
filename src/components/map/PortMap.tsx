/**
 * PortMap – Leaflet satellite map with smooth rAF-driven ship animation.
 *
 * Ships move in real-time using the SimulationEngine positions passed via
 * props (no API polling during animation — positions are computed locally
 * for zero-latency smoothness).
 *
 * Tile layers: Esri World Imagery (satellite) + OpenStreetMap (street)
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

// ── Fix Leaflet default icon paths ─────────────────────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Icon factories ─────────────────────────────────────────────────────────
function berthIcon(name: string, capacity: number, occupied: boolean): L.DivIcon {
  const bg = occupied ? '#ef4444' : '#22c55e';
  return L.divIcon({
    className: '',
    iconAnchor: [36, 11],
    html: `<div style="background:${bg};color:#06101c;border:2px solid #fff;
      border-radius:7px;padding:4px 7px;font-weight:800;font-size:10px;
      white-space:nowrap;box-shadow:0 2px 7px rgba(0,0,0,.45);
      font-family:'JetBrains Mono',monospace;">
      ${name}<br/><span style="font-size:9px;">${(capacity/1000).toFixed(0)}k t</span>
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
      box-shadow:0 0 18px rgba(34,211,238,0.6);">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round">
        <path d="M3 11l9-9 9 9M5 9v10h14V9"/>
      </svg>
    </div>`,
  });
}

function shipIcon(ship: ShipPosition): L.DivIcon {
  const isWaiting  = ship.status === 'Waiting at Anchorage';
  const isHalted   = ship.halted;
  const bg = isHalted ? '#ef4444' : isWaiting ? '#f59e0b' : ship.color;
  const short = ship.ship_id.replace('SHP-', '');
  const pulse = isHalted
    ? 'box-shadow:0 0 0 4px rgba(239,68,68,0.35),0 2px 10px rgba(0,0,0,.55);'
    : isWaiting
    ? 'box-shadow:0 0 0 4px rgba(245,158,11,0.3),0 2px 10px rgba(0,0,0,.55);'
    : 'box-shadow:0 2px 10px rgba(0,0,0,.55);';
  return L.divIcon({
    className: '',
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;border-radius:50%;
      background:${bg};border:3px solid #fff;${pulse}
      display:flex;align-items:center;justify-content:center;
      color:#06101c;font-weight:900;font-size:10px;
      font-family:'JetBrains Mono',monospace;
      transition:all 0.15s ease;">
      ${isHalted ? '⚠' : short}
    </div>`,
  });
}

// ── Re-centre helper ────────────────────────────────────────────────────────
function MapRecentre({ lat, lon, zoom }: { lat: number; lon: number; zoom: number }) {
  const map = useMap();
  const prev = useRef('');
  useEffect(() => {
    const key = `${lat},${lon}`;
    if (key !== prev.current) { map.setView([lat, lon], zoom, { animate: true }); prev.current = key; }
  }, [lat, lon, zoom, map]);
  return null;
}

// ── Animated marker: updates position without remounting ───────────────────
function AnimatedShipMarker({
  ship, berthCoords, showRoutes, selected, onSelect,
}: {
  ship: ShipPosition;
  berthCoords: Record<string, [number, number]>;
  showRoutes: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const pos: [number, number] = [ship.lat, ship.lon];

  // Create marker once
  useEffect(() => {
    const icon = shipIcon(ship);
    const m = L.marker(pos, { icon, zIndexOffset: selected ? 1000 : 0 });
    m.addTo(map);
    m.on('click', onSelect);
    markerRef.current = m;
    return () => { m.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Update position and icon every render (driven by rAF)
  useEffect(() => {
    if (!markerRef.current) return;
    markerRef.current.setLatLng(pos);
    markerRef.current.setIcon(shipIcon(ship));
    if (selected) markerRef.current.setZIndexOffset(1000);
  });

  const isApproach = ship.status === 'Approaching';
  const isWaiting  = ship.status === 'Waiting at Anchorage';
  const berthLL    = berthCoords[ship.ship_id] ?? null; // berth assigned to this ship
  const color      = ship.halted ? '#ef4444' : isWaiting ? '#f59e0b' : ship.color;

  return (
    <>
      {/* Anchorage ring */}
      {isWaiting && (
        <Circle center={pos} radius={280}
          pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.15, weight: 2 }} />
      )}
      {/* Halt pulsing ring */}
      {ship.halted && (
        <Circle center={pos} radius={350}
          pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.12, weight: 2, dashArray: '6 4' }} />
      )}
      {/* Selection ring */}
      {selected && (
        <Circle center={pos} radius={200}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: '4 4' }} />
      )}
      {/* Route line to berth */}
      {showRoutes && berthLL && (isApproach || isWaiting) && (
        <Polyline
          positions={[pos, berthLL]}
          pathOptions={{
            color: isWaiting ? '#f59e0b' : 'rgba(34,211,238,0.5)',
            weight: isWaiting ? 2.5 : 1.5,
            dashArray: '7 8',
            opacity: selected ? 1 : 0.65,
          }}
        />
      )}
    </>
  );
}

// ── Props ───────────────────────────────────────────────────────────────────
interface PortMapProps {
  className?: string;
  /** Animated positions from useSimulation hook */
  animatedPositions?: ShipPosition[];
  /** berth → assigned shipId, for route lines */
  berthShipMap?: Record<string, string>;
}

// ── Main component ──────────────────────────────────────────────────────────
export function PortMap({ className, animatedPositions, berthShipMap = {} }: PortMapProps) {
  const {
    port, vessels, optimization, selectedVesselId, selectVessel,
    mapSnapshot, activePort, settings,
  } = usePort();

  const zoom = activePort ? (activePort.berths > 15 ? 13 : 14) : 13;
  const portLabel = activePort?.short ?? port.name;

  // Berths from backend snapshot
  const snapshotBerths: MapBerth[] = mapSnapshot?.berths ?? [];

  // Build berth coords for route lines (ship_id → berth lat/lon)
  const berthCoords = useMemo<Record<string, [number, number]>>(() => {
    const out: Record<string, [number, number]> = {};
    // map berth name → coords
    const berthNameToLL: Record<string, [number, number]> = {};
    snapshotBerths.forEach((b) => { berthNameToLL[b.name] = [b.lat, b.lon]; });
    // map each ship to its assigned berth's coords
    Object.entries(berthShipMap).forEach(([berthName, shipId]) => {
      if (berthNameToLL[berthName]) out[shipId] = berthNameToLL[berthName];
    });
    // fallback from optimization assignments
    optimization?.assignments?.forEach((a) => {
      const berth = snapshotBerths.find((b) => b.name === a.berthId);
      if (berth) out[a.vesselId] = [berth.lat, berth.lon];
    });
    return out;
  }, [snapshotBerths, berthShipMap, optimization]);

  // Use animated positions when available, else fallback to snapshot/local
  const shipEntries: ShipPosition[] = useMemo(() => {
    if (animatedPositions && animatedPositions.length > 0) return animatedPositions;
    // Fallback to snapshot ships
    if (mapSnapshot?.ships && mapSnapshot.ships.length > 0) {
      return mapSnapshot.ships.map((s) => ({
        ship_id: s.ship_id,
        lat: s.lat, lon: s.lon,
        status: s.status as ShipPosition['status'],
        color: s.color ?? shipColor(s.index),
        index: s.index,
        speed_knots: 0,
        eta: s.eta,
        cargo_type: s.cargo_type,
        weight_tonnes: Number(s.weight_tonnes),
        operator: s.operator,
        loa_m: Number(s.loa_m),
        draft_m: Number(s.draft_m),
        halted: false, halt_hours: 0, halt_reason: '',
        progress: 0,
      }));
    }
    // Final fallback: vessel register
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
    <div className={className} style={{ width: '100%', height: '100%', minHeight: 400, position: 'relative' }}>
      <MapContainer
        center={[port.lat, port.lon]}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        zoomControl
        attributionControl
      >
        <MapRecentre lat={port.lat} lon={port.lon} zoom={zoom} />

        {/* ── Tile layers ── */}
        <LayersControl position="topright">
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

          {/* ── Port marker ── */}
          <LayersControl.Overlay checked name="Port">
            <Marker position={[port.lat, port.lon]} icon={portIcon()}>
              <Tooltip permanent direction="top" offset={[0, -22]}>
                <span style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, color: '#22d3ee', fontSize: 12, letterSpacing: '0.1em' }}>
                  {portLabel}
                </span>
              </Tooltip>
              <Popup>
                <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12, minWidth: 210 }}>
                  <b style={{ fontSize: 14 }}>{portLabel}</b><br />
                  {activePort && <><span style={{ color: '#666' }}>State: </span>{activePort.state}<br /></>}
                  <span style={{ color: '#666' }}>Berths: </span><b>{activePort?.berths ?? '—'}</b><br />
                  <span style={{ color: '#666' }}>Coords: </span>{port.lat.toFixed(4)}, {port.lon.toFixed(4)}
                </div>
              </Popup>
            </Marker>
          </LayersControl.Overlay>

          {/* ── Berth markers ── */}
          <LayersControl.Overlay checked name="Berths">
            <>
              {snapshotBerths.map((b) => (
                <Marker key={b.name} position={[b.lat, b.lon]}
                  icon={berthIcon(b.name, b.capacity_tonnes, b.occupied)}>
                  <Popup>
                    <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12, minWidth: 220 }}>
                      <b>{b.name}</b><br />
                      <span style={{ color: '#666' }}>Capacity: </span>{b.capacity_tonnes.toLocaleString()} t<br />
                      <span style={{ color: '#666' }}>Max LOA: </span>{b.max_loa_m} m ·{' '}
                      <span style={{ color: '#666' }}>Draft: </span>{b.max_draft_m} m<br />
                      <span style={{ color: '#666' }}>Status: </span>
                      <b style={{ color: b.occupied ? '#ef4444' : '#22c55e' }}>
                        {b.occupied ? 'OCCUPIED' : 'AVAILABLE'}
                      </b>
                      {b.assigned_ships.length > 0 && (
                        <><br /><span style={{ color: '#666' }}>Ships: </span>{b.assigned_ships.join(', ')}</>
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

      {/* ── Legend ── */}
      <div style={{
        position: 'absolute', bottom: 30, left: 8, zIndex: 1000,
        background: 'rgba(6,11,21,0.9)', border: '1px solid rgba(103,155,206,0.25)',
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
        ] as [string, string][]).map(([label, color]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5,
            fontFamily: 'JetBrains Mono,monospace', fontSize: 9,
            color: 'rgba(139,162,198,0.9)', letterSpacing: '0.08em' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
