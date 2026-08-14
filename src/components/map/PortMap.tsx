/**
 * PortMap – real interactive satellite map powered by React-Leaflet.
 *
 * Tile layers (matching live.py folium setup):
 *   1. Esri World Imagery  (satellite, default)
 *   2. OpenStreetMap       (street, switchable via layer control)
 *
 * Features ported from live.py:
 *   • Port anchor marker with popup
 *   • Berth markers on the sea-facing side (green = free, red = occupied)
 *   • Ship markers coloured by index, positioned by simulation state
 *   • Amber anchorage circles for waiting ships
 *   • Dashed route lines from approaching ships to their assigned berth
 *   • Layer control to toggle satellite / street view
 *   • Live legend (status colours)
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  LayersControl,
  Marker,
  Circle,
  Polyline,
  Popup,
  Tooltip,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { usePort } from '../../contexts/PortContext';
import type { MapBerth, MapShip } from '../../services/api';

// ── Fix Leaflet default icon paths broken by bundlers ──────────────────────
// (must run before any map renders)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Colour helpers (same algorithm as live.py ship_color()) ────────────────
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const r = Math.round(f(5) * 255);
  const g = Math.round(f(3) * 255);
  const b = Math.round(f(1) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
function shipColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return hsvToHex(hue, 0.72, 0.95);
}

// ── Custom DivIcon factories ──────────────────────────────────────────────
function berthIcon(name: string, capacity: number, occupied: boolean): L.DivIcon {
  const bg = occupied ? '#ef4444' : '#22c55e';
  return L.divIcon({
    className: '',
    iconAnchor: [36, 11],
    html: `<div style="
      background:${bg};color:#06101c;border:2px solid #fff;
      border-radius:7px;padding:4px 7px;font-weight:800;
      font-size:10px;white-space:nowrap;
      box-shadow:0 2px 7px rgba(0,0,0,.45);font-family:'JetBrains Mono',monospace;">
      ${name}<br/><span style="font-size:9px;">${(capacity / 1000).toFixed(0)}k t</span>
    </div>`,
  });
}

function portIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconAnchor: [18, 18],
    html: `<div style="
      width:36px;height:36px;border-radius:50%;
      background:rgba(34,211,238,0.2);border:3px solid #22d3ee;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 0 18px rgba(34,211,238,0.6);">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83
                 M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
    </div>`,
  });
}

function shipIcon(index: number, label: string, status: string): L.DivIcon {
  const isAnchorage = status === 'Waiting at Anchorage';
  const bg = isAnchorage ? '#f59e0b' : shipColor(index);
  const textColor = isAnchorage ? '#201100' : '#06101c';
  const short = label.replace('SHP-', '');
  return L.divIcon({
    className: '',
    iconAnchor: [17, 17],
    html: `<div style="
      width:34px;height:34px;border-radius:50%;
      background:${bg};border:3px solid #fff;
      box-shadow:0 2px 10px rgba(0,0,0,.55);
      display:flex;align-items:center;justify-content:center;
      color:${textColor};font-weight:900;font-size:10px;
      font-family:'JetBrains Mono',monospace;">
      ${short}
    </div>`,
  });
}

// ── Re-centre map when active port changes ─────────────────────────────────
function MapRecentre({ lat, lon, zoom }: { lat: number; lon: number; zoom: number }) {
  const map = useMap();
  const prevRef = useRef<string>('');
  useEffect(() => {
    const key = `${lat},${lon}`;
    if (key !== prevRef.current) {
      map.setView([lat, lon], zoom, { animate: true });
      prevRef.current = key;
    }
  }, [lat, lon, zoom, map]);
  return null;
}

// ── Props ──────────────────────────────────────────────────────────────────
interface PortMapProps {
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────
export function PortMap({ className }: PortMapProps) {
  const {
    port,
    vessels,
    optimization,
    selectedVesselId,
    selectVessel,
    mapSnapshot,
    activePort,
    settings,
  } = usePort();

  // Zoom based on berth count: more berths → slightly wider view
  const zoom = activePort ? (activePort.berths > 15 ? 13 : 14) : 13;

  // ── Berths from backend snapshot ────────────────────────────────────────
  const snapshotBerths: MapBerth[] = mapSnapshot?.berths ?? [];
  const snapshotShips:  MapShip[]  = mapSnapshot?.ships  ?? [];

  // ── Berth → assigned ship lookup (for route lines) ────────────────────
  const berthCoords = useMemo<Record<string, [number, number]>>(() => {
    const out: Record<string, [number, number]> = {};
    snapshotBerths.forEach((b) => { out[b.name] = [b.lat, b.lon]; });
    return out;
  }, [snapshotBerths]);

  // ── Ship positions ────────────────────────────────────────────────────
  // Use backend snapshot when available, fall back to vessel register coords.
  const shipEntries = useMemo(() => {
    if (snapshotShips.length > 0) return snapshotShips;
    // Fallback: map local vessels to MapShip-compatible shape
    return vessels.map((v, i) => ({
      ship_id: v.id,
      lat: v.lat,
      lon: v.lon,
      color: shipColor(i),
      status: v.status === 'approaching' ? 'Approaching'
            : v.status === 'waiting'     ? 'Waiting at Anchorage'
            : v.status === 'berthed'     ? 'Servicing'
            : 'Departed',
      wait_hours: 0,
      assigned_berth: optimization?.assignments?.find(a => a.vesselId === v.id)?.berthId ?? '—',
      eta: v.departure,
      cargo_type: v.cargoType,
      weight_tonnes: v.loadTonnes,
      loa_m: v.loa,
      draft_m: v.draft,
      operator: v.operator,
      index: i,
    } as MapShip));
  }, [snapshotShips, vessels, optimization]);

  const portLabel = activePort?.short ?? port.name;

  return (
    <div className={className} style={{ width: '100%', height: '100%', minHeight: 400 }}>
      <MapContainer
        center={[port.lat, port.lon]}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
        attributionControl={true}
      >
        {/* Re-centre when port changes */}
        <MapRecentre lat={port.lat} lon={port.lon} zoom={zoom} />

        {/* ── Tile layers (matching live.py folium setup) ── */}
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
              maxZoom={20}
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Street Map">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* ── Port marker ── */}
          <LayersControl.Overlay checked name="Port">
            <Marker position={[port.lat, port.lon]} icon={portIcon()}>
              <Tooltip permanent direction="top" offset={[0, -20]}
                className="nexus-tooltip-port">
                <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, letterSpacing: '0.1em', color: '#22d3ee', fontSize: 12 }}>
                  {portLabel}
                </span>
              </Tooltip>
              <Popup>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, minWidth: 200 }}>
                  <b style={{ fontSize: 14 }}>{portLabel}</b><br />
                  {activePort && (<><span style={{ color: '#666' }}>State: </span>{activePort.state}<br /></>)}
                  <span style={{ color: '#666' }}>Berths: </span>
                  <b>{activePort?.berths ?? '—'}</b><br />
                  <span style={{ color: '#666' }}>Coords: </span>
                  {port.lat.toFixed(5)}, {port.lon.toFixed(5)}<br />
                  {activePort && (
                    <a href={activePort.url} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#0ea5e9', fontSize: 10 }}>
                      {activePort.source}
                    </a>
                  )}
                </div>
              </Popup>
            </Marker>
          </LayersControl.Overlay>

          {/* ── Berth markers ── */}
          <LayersControl.Overlay checked name="Berths">
            <>
              {snapshotBerths.map((berth) => (
                <Marker
                  key={berth.name}
                  position={[berth.lat, berth.lon]}
                  icon={berthIcon(berth.name, berth.capacity_tonnes, berth.occupied)}
                >
                  <Popup>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, minWidth: 220 }}>
                      <b style={{ fontSize: 13 }}>{berth.name}</b><br />
                      <span style={{ color: '#666' }}>Capacity: </span>
                      {berth.capacity_tonnes.toLocaleString()} t<br />
                      <span style={{ color: '#666' }}>Max LOA: </span>{berth.max_loa_m} m<br />
                      <span style={{ color: '#666' }}>Max draft: </span>{berth.max_draft_m} m<br />
                      <span style={{ color: '#666' }}>Cargo: </span>
                      {berth.cargo_types.join(', ')}<br />
                      <span style={{ color: '#666' }}>Status: </span>
                      <b style={{ color: berth.occupied ? '#ef4444' : '#22c55e' }}>
                        {berth.occupied ? 'OCCUPIED' : 'AVAILABLE'}
                      </b><br />
                      {berth.assigned_ships.length > 0 && (
                        <><span style={{ color: '#666' }}>Ship: </span>
                        {berth.assigned_ships.join(', ')}</>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </>
          </LayersControl.Overlay>

          {/* ── Ships + anchorage circles + route lines ── */}
          <LayersControl.Overlay checked name="Ships">
            <>
              {shipEntries.map((ship) => {
                const isWaiting  = ship.status === 'Waiting at Anchorage';
                const isApproach = ship.status === 'Approaching';
                const color      = isWaiting ? '#f59e0b' : (ship.color ?? shipColor(ship.index));
                const berthLatLon = berthCoords[ship.assigned_berth];
                const isSelected = selectedVesselId === ship.ship_id;

                return (
                  <React.Fragment key={ship.ship_id}>
                    {/* Amber anchorage ring for waiting ships */}
                    {isWaiting && (
                      <Circle
                        center={[ship.lat, ship.lon]}
                        radius={260}
                        pathOptions={{
                          color: '#f59e0b',
                          fillColor: '#f59e0b',
                          fillOpacity: 0.18,
                          weight: 2,
                        }}
                      />
                    )}

                    {/* Selection highlight ring */}
                    {isSelected && (
                      <Circle
                        center={[ship.lat, ship.lon]}
                        radius={180}
                        pathOptions={{
                          color,
                          fillColor: color,
                          fillOpacity: 0.12,
                          weight: 2,
                          dashArray: '6 4',
                        }}
                      />
                    )}

                    {/* Route line: approaching → assigned berth (solid cyan) */}
                    {isApproach && berthLatLon && settings.showRouteLines && (
                      <Polyline
                        positions={[[ship.lat, ship.lon], berthLatLon]}
                        pathOptions={{
                          color: isSelected ? '#22d3ee' : 'rgba(34,211,238,0.45)',
                          weight: isSelected ? 2 : 1.5,
                          dashArray: '7 8',
                        }}
                      />
                    )}

                    {/* Anchorage holding line: waiting → assigned berth (amber dashed) */}
                    {isWaiting && berthLatLon && (
                      <Polyline
                        positions={[[ship.lat, ship.lon], berthLatLon]}
                        pathOptions={{
                          color: '#f59e0b',
                          weight: 2.5,
                          dashArray: '4 7',
                          opacity: 0.85,
                        }}
                      />
                    )}

                    {/* Ship marker */}
                    <Marker
                      position={[ship.lat, ship.lon]}
                      icon={shipIcon(ship.index, ship.ship_id, ship.status)}
                      eventHandlers={{ click: () => selectVessel(ship.ship_id) }}
                    >
                      <Tooltip direction="top" offset={[0, -20]}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                          {ship.ship_id} | {ship.status}
                        </span>
                      </Tooltip>
                      <Popup>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, minWidth: 230 }}>
                          <b style={{ fontSize: 13 }}>{ship.ship_id}</b><br />
                          <span style={{ color: '#666' }}>Operator: </span>{ship.operator}<br />
                          <span style={{ color: '#666' }}>Cargo: </span>{ship.cargo_type}<br />
                          <span style={{ color: '#666' }}>Load: </span>
                          {Number(ship.weight_tonnes).toLocaleString()} t<br />
                          <span style={{ color: '#666' }}>LOA: </span>{ship.loa_m} m &nbsp;
                          <span style={{ color: '#666' }}>Draft: </span>{ship.draft_m} m<br />
                          <span style={{ color: '#666' }}>Status: </span>
                          <b style={{ color: isWaiting ? '#f59e0b' : isApproach ? '#22d3ee' : '#34d399' }}>
                            {ship.status}
                          </b><br />
                          <span style={{ color: '#666' }}>Assigned berth: </span>
                          {ship.assigned_berth}<br />
                          {isWaiting && ship.wait_hours > 0 && (
                            <><span style={{ color: '#f59e0b' }}>
                              Waiting {ship.wait_hours.toFixed(1)} h at anchorage
                            </span><br /></>
                          )}
                          <span style={{ color: '#666' }}>ETA: </span>
                          {ship.eta ? ship.eta.slice(0, 16).replace('T', ' ') : '—'}
                        </div>
                      </Popup>
                    </Marker>
                  </React.Fragment>
                );
              })}
            </>
          </LayersControl.Overlay>
        </LayersControl>
      </MapContainer>

      {/* ── Status legend (bottom-left, matching live.py colour coding) ── */}
      <div style={{
        position: 'absolute', bottom: 28, left: 8, zIndex: 1000,
        background: 'rgba(6,11,21,0.88)', border: '1px solid rgba(103,155,206,0.25)',
        borderRadius: 8, padding: '6px 10px', backdropFilter: 'blur(4px)',
        display: 'flex', flexWrap: 'wrap', gap: '6px 14px', pointerEvents: 'none',
      }}>
        {[
          ['AVAILABLE',  '#22c55e'],
          ['OCCUPIED',   '#ef4444'],
          ['APPROACHING','#22d3ee'],
          ['SERVICING',  '#34d399'],
          ['ANCHORAGE',  '#f59e0b'],
          ['DEPARTED',   '#3b82f6'],
        ].map(([label, color]) => (
          <span key={label} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
            color: 'rgba(139,162,198,0.9)', letterSpacing: '0.08em',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
