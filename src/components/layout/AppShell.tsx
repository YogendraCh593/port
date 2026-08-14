import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { XIcon } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex h-full w-full bg-void text-chalk">
      <aside className="hidden shrink-0 lg:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </aside>

      <AnimatePresence>
        {mobileOpen &&
        <motion.div
          className="fixed inset-0 z-50 lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}>
          
            <div
            className="absolute inset-0 bg-void/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden />
          
            <motion.div
            className="absolute inset-y-0 left-0"
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}>
            
              <Sidebar
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              onNavigate={() => setMobileOpen(false)} />
            
              <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute -right-11 top-3 grid h-9 w-9 place-items-center rounded-md border border-line bg-abyss text-mist"
              aria-label="Close navigation">
              
                <XIcon className="h-4 w-4" aria-hidden />
              </button>
            </motion.div>
          </motion.div>
        }
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={() => setMobileOpen(true)} />
        <main className="relative flex-1 overflow-y-auto">
          <div className="pointer-events-none fixed inset-0 np-grid opacity-[0.25]" aria-hidden />
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="relative mx-auto w-full max-w-[1800px] p-3 sm:p-5">
              
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>);

}