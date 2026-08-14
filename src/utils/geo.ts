import { format } from 'date-fns';
import type { Vessel, VesselDerived, CargoPriority } from '../types';

export const KM_PER_KNOT_HOUR = 1.852;

export function haversineKm(
aLat: number,
aLon: number,
bLat: number,
bLon: number)
: number {
  const R = 6371;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
  Math.sin(dLat / 2) ** 2 +
  Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function travelHours(distanceKm: number, speedKnots: number): number {
  const kmh = Math.max(0.1, speedKnots) * KM_PER_KNOT_HOUR;
  return distanceKm / kmh;
}

export function addHours(date: Date | string, hours: number): Date {
  const d = new Date(date);
  return new Date(d.getTime() + hours * 3600_000);
}

export function hoursBetween(a: Date | string, b: Date | string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600_000;
}

export function fmtDate(d: Date | string): string {
  return format(new Date(d), 'dd MMM yyyy');
}

export function fmtTime(d: Date | string): string {
  return format(new Date(d), 'HH:mm');
}

export function fmtClock(d: Date | string): string {
  return format(new Date(d), 'HH:mm:ss');
}

export function fmtDateTime(d: Date | string): string {
  return `${fmtDate(d)} | ${fmtTime(d)}`;
}

export function fmtDuration(hours: number): string {
  if (!Number.isFinite(hours)) return '—';
  const sign = hours < 0 ? '-' : '';
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  if (h === 0) return `${sign}${m}m`;
  return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
}

export function fmtNumber(n: number, digits = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function fmtCoord(value: number, axis: 'lat' | 'lon'): string {
  const hemi = axis === 'lat' ? value >= 0 ? 'N' : 'S' : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(2)}° ${hemi}`;
}

/**
 * Core vessel math: distance to port, travel time, ETA, expected berth end and
 * the spoilage deadline for time-sensitive cargo.
 */
export function deriveVessel(
vessel: Vessel,
port: {lat: number;lon: number;})
: VesselDerived {
  const distanceKm = haversineKm(vessel.lat, vessel.lon, port.lat, port.lon);
  const hours = travelHours(distanceKm, vessel.speedKnots);
  const eta = addHours(vessel.departure, hours);
  const expectedEnd = addHours(eta, vessel.unloadingHours);
  const spoilageDeadline = vessel.spoilable ?
  addHours(vessel.departure, vessel.spoilageWindowHours) :
  null;
  const spoilageSlackHours = spoilageDeadline ?
  hoursBetween(expectedEnd, spoilageDeadline) :
  null;
  let spoilageRisk: VesselDerived['spoilageRisk'] = 'none';
  if (spoilageSlackHours !== null) {
    spoilageRisk = spoilageSlackHours < 0 ? 'breach' : spoilageSlackHours < 6 ? 'watch' : 'none';
  }
  let priority: CargoPriority = 'standard';
  if (spoilageRisk === 'breach') priority = 'critical';else
  if (spoilageRisk === 'watch' || vessel.spoilable) priority = 'high';else
  if (vessel.teu > 3000 || vessel.loadTonnes > 8000) priority = 'high';

  return {
    distanceKm,
    travelHours: hours,
    eta,
    expectedEnd,
    spoilageDeadline,
    spoilageSlackHours,
    spoilageRisk,
    priority
  };
}