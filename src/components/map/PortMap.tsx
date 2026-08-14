/**
 * PortMap – Leaflet satellite map with smooth rAF-driven ship animation.
 *
 * Berth markers:
 *   GREEN  = berth is FREE (no ship servicing)
 *   RED    = berth is OCCUPIED (ship actively servicing)
 *   Colour driven by berthState prop from useSimulation — updates every frame.
 *
 * Ship lifecycle:
 *   APPROACHING  → coloured circle moving toward port
 *   ANCHORAGE    → amber circle with holding ring, waiting for a free berth
 *   SERVICING    → green circle parked at berth; berth turns RED
 *   DEPARTED     → faded blue ↗ circle sailing away; berth immediately turns GREEN
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

// ── Fix Leaflet default icon paths ─────────────────────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Geometry: must match useSimulation exactly ──────────────────────────────
function berthSlotPos(portLat: number, portLon: number, slot: number, total: number) {
  const SEA_OFFSET_KM  = 0.30;
  const BERTH_SPACE_KM = 0.12;
  const EARTH_R        = 6371.0;
  const halfSpan       = ((total - 1) / 2) * BERTH_SPACE_KM;
  const along          = slot * BERTH_SPACE_KM - halfSpan;
  const dLat           = along / EARTH_R * (180 / Math.PI);
  const dLon           = SEA_OFFSET_KM / (EARTH_R * Math.cos(portLat * Math.PI / 180)) * (180 / Math.PI);
  return [portLat + dLat, portLon + dLon] as [number, number];
}

// ── Icon builders ───────────────────────────────────────────────────────────

function berthIcon(slotName: string, capacity: number, occupied: boolean): L.DivIcon {
  const bg      = occupied ? '#ef4444' : '#22c55e';
  const glow    = occupied ? '0 0 14px 5px rgba(239,68,68,0.65)' : '0 0 14px 5px rgba(34,197,94,0.65)';
  const badge   = occupied ? 'OCCUPIED' : 'FREE';
  const badgeClr = occupied ? '#fca5a5' : '#bbf7d0';
  return L.divIcon({
    className: '',
    iconAnchor: [24, 60],
    iconSize:   [48, 60],
    html: `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="background:${bg};color:#06101c;border:2.5px solid #fff;
        border-radius:9px;padding:3px 8px 2px;font-weight:900;font-size:10px;
        white-space:nowrap;box-shadow:${glow},0 2px 8px rgba(0,0,0,0.6);
        font-family:monospace;line-height:1.35;text-align:center;min-width:52px;">
        ${slotName}
        <br/><span style="font-size:8px;color:${badgeClr};letter-spacing:.04em;">
          ${badge} · ${(capacity/1000).toFixed(0)}kt
        </span>
      </div>
      <div style="width:3px;height:14px;background:${bg};box-shadow:${glow};"></div>
      <div style="width:12px;height:12px;border-radius:50%;background:${bg};
        border:2.5px solid #fff;box-shadow:${glow};margin-top:-1px;"></div>
    </div>`,
  });
}

function portIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconAnchor: [20, 20],
    iconSize:   [40, 40],
    html: `<div style="width:40px;height:40px;border-radius:50%;
      background:rgba(34,211,238,0.18);border:3px solid #22d3ee;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 0 20px 6px rgba(34,211,238,0.5);font-size:18px;">⚓</div>`,
  });
}

function makeShipIcon(ship: ShipPosition): L.DivIcon {
  const isDep      = ship.status === 'Departed';
  const isWaiting  = ship.status === 'Waiting at Anchorage';
  const isService  = ship.status === 'Servicing';
  const isHalted   = ship.halted;

  const bg =
    isHalted  ? '#ef4444' :
    isDep     ? '#3b82f6' :
    isWaiting ? '#f59e0b' :
    isService ? '#34d399' :
    ship.color;

  const opacity = isDep ? '0.6' : '1';
  const border  = isDep ? '#94a3b8' : '#fff';
  const glow    =
    isHalted  ? '0 0 0 5px rgba(239,68,68,0.45),0 2px 10px rgba(0,0,0,.6)' :
    isWaiting ? '0 0 0 4px rgba(245,158,11,0.4),0 2px 10px rgba(0,0,0,.6)' :
    isService ? '0 0 0 4px rgba(52,211,153,0.4),0 2px 10px rgba(0,0,0,.6)' :
    isDep     ? '0 2px 6px rgba(0,0,0,.4)' :
    '0 2px 10px rgba(0,0,0,.55)';

  const num   = ship.ship_id.replace(/\D/g, '') || String(ship.index + 1);
  const label = isHalted ? '⚠' : isDep ? '↗' : num;

  return L.divIcon({
    className: '',
    iconAnchor: [18, 18],
    iconSize:   [36, 36],
    html: `<div style="width:36px;height:36px;border-radius:50%;
      background:${bg};border:3px solid ${border};
      box-shadow:${glow};opacity:${opacity};
      display:flex;align-items:center;justify-content:center;
      color:#06101c;font-weight:900;font-size:12px;font-family:monospace;">
      ${label}</div>`,
  });
}

// ── Re-centre when port changes ─────────────────────────────────────────────
function MapRecentre({ lat, lon, zoom }: { lat: number; lon: number; zoom: number }) {
  const map  = useMap();
  const prev = useRef('');
  useEffect(() => {
    const key = `${lat},${lon}`;
    if (key !== prev.current) { map.setView([lat, lon], zoom, { animate: true }); prev.current = key; }
  }, [lat, lon, zoom, map]);
  return null;
}

// ── Animated ship marker ────────────────────────────────────────────────────
function AnimatedShipMarker({
  ship, berthLatLon, showRoutes, selected, onSelect,
}: {
  ship: ShipPosition;
  berthLatLon: [number, number] | null;
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

  // Move + restyle every render (driven by rAF)
  useEffect(() => {
    const m = markerRef.current;
    if (!m) return;
    m.setLatLng([ship.lat, ship.lon]);
    m.setIcon(makeShipIcon(ship));
    m.setZIndexOffset(selected ? 1000 : 100);
  });

  const isApproach  = ship.status === 'Approaching';
  const isWaiting   = ship.status === 'Waiting at Anchorage';
  const isDep       = ship.status === 'Departed';
  const isService   = ship.status === 'Servicing';
  const pos: [number, number] = [ship.lat, ship.lon];
  const color = ship.halted ? '#ef4444' : isWaiting ? '#f59e0b' : isService ? '#34d399' : isDep ? '#3b82f6' : ship.color;

  return (
    <>
      {/* Anchorage holding ring */}
      {isWaiting && (
        <Circle center={pos} radius={320}
          pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.13, weight: 2, dashArray: '6 5' }} />
      )}
      {/* Servicing glow at berth */}
      {isService && (
        <Circle center={pos} radius={140}
          pathOptions={{ color: '#34d399', fillColor: '#34d399', fillOpacity: 0.15, weight: 2 }} />
      )}
      {/* Departed faded ring */}
      {isDep && (
        <Circle center={pos} radius={180}
          pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.07, weight: 1, dashArray: '4 6' }} />
      )}
      {/* Halt ring */}
      {ship.halted && (
        <Circle center={pos} radius={430}
          pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.07, weight: 2, dashArray: '5 4' }} />
      )}
      {/* Selection ring */}
      {selected && (
        <Circle center={pos} radius={240}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: '4 4' }} />
      )}
      {/* Route line to assigned berth */}
      {showRoutes && berthLatLon && (isApproach || isWaiting) && (
        <Polyline
          positions={[pos, berthLatLon]}
          pathOptions={{
            color: isWaiting ? '#f59e0b' : 'rgba(34,211,238,0.55)',
            weight: isWaiting ? 2.5 : 1.5,
            dashArray: '8 7',
          }}
        />
      )}
      {/* Departure trail */}
      {isDep && (
        <Polyline
          positions={[[ship.lat - 0.03, ship.lon - 0.03], pos]}
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
  /** Live berth occupancy from useSimulation — drives green/red in real-time */
  berthState?: { slot: number; occupied: boolean; shipId: string | null }[];
  numBerths?: number;
  berthShipMap?: Record<string, string>;
}

// ── Main map ────────────────────────────────────────────────────────────────
export function PortMap({
  className,
  animatedPositions,
  berthState = [],
  numBerths = 5,
  berthShipMap = {},
}: PortMapProps) {
  const {
    port, vessels, optimization, selectedVesselId, selectVessel,
    mapSnapshot, activePort, settings,
  } = usePort();

  const zoom      = activePort ? (activePort.berths > 15 ? 13 : 14) : 13;
  const portLabel = activePort?.short ?? port.name;

  // ── Berth positions computed from slot geometry (matches simulation) ──────
  const effectiveBerths = activePort?.berths ?? numBerths;
  const berthSlots = useMemo(() => {
    return Array.from({ length: effectiveBerths }, (_, i) => {
      const pos     = berthSlotPos(port.lat, port.lon, i, effectiveBerths);
      const state   = berthState.find(b => b.slot === i);
      const snapB   = mapSnapshot?.berths?.[i];
      const capacity = snapB?.capacity_tonnes ?? 40000;
      const name    = snapB?.name ?? `Berth ${i + 1}`;
      const occupied = state ? state.occupied : (snapB?.occupied ?? false);
      const shipId   = state?.shipId ?? snapB?.assigned_ships?.[0] ?? null;
      return { slot: i, pos, name, capacity, occupied, shipId };
    });
  }, [effectiveBerths, port.lat, port.lon, berthState, mapSnapshot]);

  // ship_id → berth position for route lines
  const shipToBerth = useMemo<Record<string, [number, number]>>(() => {
    const out: Record<string, [number, number]> = {};
    // From live simulation
    animatedPositions?.forEach(ship => {
      if (ship.berthSlot >= 0) {
        const pos = berthSlotPos(port.lat, port.lon, ship.berthSlot, effectiveBerths);
        out[ship.ship_id] = pos;
      }
    });
    // From optimization assignments
    optimization?.assignments?.forEach(a => {
      if (!out[a.vesselId]) {
        const idx = berthSlots.findIndex(b => b.name === a.berthId);
        if (idx >= 0) out[a.vesselId] = berthSlots[idx].pos;
      }
    });
    return out;
  }, [animatedPositions, optimization, berthSlots, port.lat, port.lon, effectiveBerths]);

  // Resolve ship entries
  const shipEntries: ShipPosition[] = useMemo(() => {
    if (animatedPositions && animatedPositions.length > 0) return animatedPositions;
    if (mapSnapshot?.ships?.length) {
      return mapSnapshot.ships.map(s => ({
        ship_id: s.ship_id, lat: s.lat, lon: s.lon,
        status: s.status as ShipPosition['status'],
        color: s.color ?? shipColor(s.index), index: s.index,
        speed_knots: 0, eta: s.eta,
        cargo_type: s.cargo_type, weight_tonnes: Number(s.weight_tonnes),
        operator: s.operator, loa_m: Number(s.loa_m), draft_m: Number(s.draft_m),
        halted: false, halt_hours: 0, halt_reason: '', progress: 0, berthSlot: -1,
      }));
    }
    return vessels.map((v, i) => ({
      ship_id: v.id, lat: v.lat, lon: v.lon,
      status: 'Approaching' as const, color: shipColor(i), index: i,
      speed_knots: v.speedKnots, eta: v.departure,
      cargo_type: v.cargoType, weight_tonnes: v.loadTonnes,
      operator: v.operator, loa_m: v.loa, draft_m: v.draft,
      halted: false, halt_hours: 0, halt_reason: '', progress: 0, berthSlot: -1,
    }));
  }, [animatedPositions, mapSnapshot, vessels]);

  return (
    <div className={className}
      style={{ width: '100%', height: '100%', minHeight: 400, position: 'relative' }}>
      <MapContainer
        center={[port.lat, port.lon]} zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        zoomControl attributionControl>

        <MapRecentre lat={port.lat} lon={port.lon} zoom={zoom} />

        <LayersControl position="topright">

          {/* ── Tile layers ── */}
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

          {/* ── Port anchor marker ── */}
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
                  <span style={{ color: '#666' }}>Berths: </span><b>{activePort?.berths ?? effectiveBerths}</b><br />
                  <span style={{ color: '#666' }}>Coords: </span>{port.lat.toFixed(4)}, {port.lon.toFixed(4)}
                </div>
              </Popup>
            </Marker>
          </LayersControl.Overlay>

          {/* ── Berth markers — GREEN=free, RED=occupied, live from berthState ── */}
          <LayersControl.Overlay checked name="Berths">
            <>
              {berthSlots.map(b => (
                <Marker key={b.slot} position={b.pos}
                  icon={berthIcon(b.name, b.capacity, b.occupied)}>
                  <Popup>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 230 }}>
                      <div style={{
                        background: b.occupied ? '#7f1d1d' : '#14532d',
                        color: b.occupied ? '#fca5a5' : '#bbf7d0',
                        border: `2px solid ${b.occupied ? '#ef4444' : '#22c55e'}`,
                        borderRadius: 7, padding: '5px 12px', marginBottom: 10,
                        fontWeight: 900, fontSize: 14, textAlign: 'center',
                        letterSpacing: '0.06em',
                      }}>
                        {b.occupied ? '🔴  OCCUPIED' : '🟢  AVAILABLE'}
                      </div>
                      <b style={{ fontSize: 13 }}>{b.name}</b><br />
                      <span style={{ color: '#888' }}>Capacity: </span>
                      <b>{b.capacity.toLocaleString()} t</b><br />
                      {b.shipId && (
                        <><span style={{ color: '#888' }}>Ship: </span>
                          <b style={{ color: '#ef4444' }}>{b.shipId}</b></>
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
              {shipEntries.map(ship => (
                <AnimatedShipMarker
                  key={ship.ship_id}
                  ship={ship}
                  berthLatLon={shipToBerth[ship.ship_id] ?? null}
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
          ['BERTH FREE',  '#22c55e'],
          ['BERTH BUSY',  '#ef4444'],
          ['APPROACHING', '#22d3ee'],
          ['ANCHORAGE',   '#f59e0b'],
          ['SERVICING',   '#34d399'],
          ['DEPARTED',    '#3b82f6'],
          ['HALTED',      '#ef4444'],
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
