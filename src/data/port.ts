import type { Berth, Crane, PortSettings } from '../types';

export const defaultSettings: PortSettings = {
  portName: 'CHENNAI PORT',
  portLat: 13.1,
  portLon: 80.3,
  timezoneLabel: 'IST (UTC+5:30)',
  waitingWeight: 1,
  spoilageWeight: 4,
  priorityWeight: 1.6,
  annealIterations: 600,
  simulationSpeed: 60,
  showRouteLines: true,
  showVesselLabels: true
};

export const berths: Berth[] = [
{ id: 'BTH-01', name: 'BERTH 01', maxLoa: 320, maxDraft: 14, craneSlots: 3, status: 'operational' },
{ id: 'BTH-02', name: 'BERTH 02', maxLoa: 300, maxDraft: 13, craneSlots: 2, status: 'operational' },
{ id: 'BTH-03', name: 'BERTH 03', maxLoa: 260, maxDraft: 12, craneSlots: 2, status: 'operational' },
{ id: 'BTH-04', name: 'BERTH 04', maxLoa: 200, maxDraft: 10, craneSlots: 1, status: 'operational' },
{ id: 'BTH-05', name: 'BERTH 05', maxLoa: 180, maxDraft: 9, craneSlots: 1, status: 'maintenance' }];


export const cranes: Crane[] = [
{ id: 'CRN-01', name: 'CRANE 01', berthId: 'BTH-01', capacityTph: 420, status: 'operational' },
{ id: 'CRN-02', name: 'CRANE 02', berthId: 'BTH-01', capacityTph: 380, status: 'operational' },
{ id: 'CRN-03', name: 'CRANE 03', berthId: 'BTH-02', capacityTph: 360, status: 'operational' },
{ id: 'CRN-04', name: 'CRANE 04', berthId: 'BTH-02', capacityTph: 340, status: 'operational' },
{ id: 'CRN-05', name: 'CRANE 05', berthId: 'BTH-03', capacityTph: 300, status: 'operational' },
{ id: 'CRN-06', name: 'CRANE 06', berthId: 'BTH-04', capacityTph: 240, status: 'operational' },
{ id: 'CRN-07', name: 'CRANE 07', berthId: 'BTH-05', capacityTph: 220, status: 'maintenance' }];