import React, { useState } from 'react';
import { ListIcon, PlusIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { FleetTable } from '../components/vessel/FleetTable';
import { VesselRegistrationConsole } from '../components/vessel/VesselRegistrationConsole';
import { VesselDetailPanel } from '../components/vessel/VesselDetailPanel';
import { usePort } from '../contexts/PortContext';

type Tab = 'register' | 'fleet';

export function VesselOperations() {
  const [tab, setTab] = useState<Tab>('register');
  const { vessels } = usePort();

  return (
    <>
      <PageHeader
        eyebrow="Vessel Registration Console"
        title="Vessel Operations"
        description="Register inbound vessels and inspect the live register. Voyage math is computed as you type — distance, travel time, ETA, berth end and spoilage deadline."
        actions={
        <div className="flex items-center gap-1 rounded-lg border border-line bg-deck/70 p-1">
            <Button
            variant={tab === 'register' ? 'primary' : 'ghost'}
            size="sm"
            icon={<PlusIcon className="h-3 w-3" />}
            onClick={() => setTab('register')}>
            
              New Vessel
            </Button>
            <Button
            variant={tab === 'fleet' ? 'primary' : 'ghost'}
            size="sm"
            icon={<ListIcon className="h-3 w-3" />}
            onClick={() => setTab('fleet')}>
            
              Register · {vessels.length}
            </Button>
          </div>
        } />
      

      {tab === 'register' ?
      <VesselRegistrationConsole /> :

      <div className="grid gap-3 xl:grid-cols-3">
          <FleetTable className="xl:col-span-2" />
          <VesselDetailPanel />
        </div>
      }
    </>);

}