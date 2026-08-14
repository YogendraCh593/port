import type { Vessel, VesselDerived } from '../types';
import { hoursBetween } from './geo';

/** Fraction of the approach leg completed at `now` (0 → 1). */
export function vesselProgress(
vessel: Vessel,
derived: VesselDerived,
now: Date)
: number {
  if (derived.travelHours <= 0) return 1;
  const elapsed = hoursBetween(vessel.departure, now);
  return Math.max(0, Math.min(1, elapsed / derived.travelHours));
}

/**
 * Live position: approaching vessels interpolate along the great-circle
 * approach line, departing vessels track back out, and berthed/waiting
 * vessels are pinned to their port-side slot by the map renderer.
 */
export function livePosition(
vessel: Vessel,
derived: VesselDerived,
now: Date,
port: {lat: number;lon: number;})
: {lat: number;lon: number;} {
  if (vessel.status === 'berthed' || vessel.status === 'waiting') {
    return { lat: vessel.lat, lon: vessel.lon };
  }
  const t = vesselProgress(vessel, derived, now);
  if (vessel.status === 'departing') {
    const out = Math.min(0.55, 0.12 + t * 0.2);
    return {
      lat: port.lat + (vessel.lat - port.lat) * out,
      lon: port.lon + (vessel.lon - port.lon) * out
    };
  }
  const eased = Math.min(0.97, t);
  return {
    lat: vessel.lat + (port.lat - vessel.lat) * eased,
    lon: vessel.lon + (port.lon - vessel.lon) * eased
  };
}

export const statusLabel: Record<Vessel['status'], string> = {
  approaching: 'APPROACHING',
  berthed: 'AT BERTH',
  waiting: 'WAITING',
  departing: 'DEPARTING'
};

export const statusToken: Record<Vessel['status'], {text: string;dot: string;ring: string;}> = {
  approaching: { text: 'text-aqua', dot: 'bg-aqua', ring: 'border-aqua/40' },
  berthed: { text: 'text-ok', dot: 'bg-ok', ring: 'border-ok/40' },
  waiting: { text: 'text-warn', dot: 'bg-warn', ring: 'border-warn/40' },
  departing: { text: 'text-ocean', dot: 'bg-ocean', ring: 'border-ocean/40' }
};