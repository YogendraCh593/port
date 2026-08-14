import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { PortProvider } from './contexts/PortContext';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommandCenter } from './pages/CommandCenter';
import { VesselOperations } from './pages/VesselOperations';
import { LiveFleet } from './pages/LiveFleet';
import { BerthOptimization } from './pages/BerthOptimization';
import { CraneOperations } from './pages/CraneOperations';
import { QuantumOptimization } from './pages/QuantumOptimization';
import { PortSimulation } from './pages/PortSimulation';
import { Analytics } from './pages/Analytics';
import { Alerts } from './pages/Alerts';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { usePort } from './contexts/PortContext';

// Loading screen shown while the backend bootstraps
function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh', background: '#04070e',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'JetBrains Mono, monospace', gap: 20,
    }}>
      {/* Animated logo mark */}
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          border: '2px solid rgba(34,211,238,0.5)',
          background: 'linear-gradient(145deg,#123a55,#18204b,#0b1728)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 32px rgba(34,211,238,0.2)',
        }}>
          <span style={{ color: '#fff', fontSize: 26, fontWeight: 800, fontFamily: 'Space Grotesk, sans-serif' }}>N</span>
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <p style={{ color: '#e8eff9', fontSize: 18, fontWeight: 800, letterSpacing: '0.2em', fontFamily: 'Space Grotesk, sans-serif', margin: 0 }}>
          NEXUSPORT
        </p>
        <p style={{ color: '#8ba2c6', fontSize: 10, letterSpacing: '0.15em', margin: '4px 0 0' }}>
          INTELLIGENT MARITIME OPERATIONS
        </p>
      </div>

      {/* Spinner bar */}
      <div style={{ width: 200, height: 2, background: '#1a2740', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: '40%', background: '#22d3ee', borderRadius: 4,
          animation: 'nexus-slide 1.4s ease-in-out infinite',
        }} />
      </div>
      <p style={{ color: '#8ba2c6', fontSize: 11, margin: 0 }}>Connecting to backend…</p>

      <style>{`
        @keyframes nexus-slide {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(350%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}

// Backend offline banner — shown at top when API is unreachable but app still renders
function OfflineBanner() {
  const { loading, portList } = usePort();
  if (loading || portList.length > 0) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'rgba(251,95,114,0.12)', borderBottom: '1px solid rgba(251,95,114,0.4)',
      padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#fb5f72',
    }}>
      <span style={{ fontWeight: 800 }}>⚠ BACKEND OFFLINE</span>
      <span style={{ color: '#8ba2c6' }}>
        Start the backend: <code style={{ color: '#22d3ee' }}>python -m uvicorn main:app --port 8000 --reload</code>
        &nbsp;then&nbsp;
        <button
          onClick={() => window.location.reload()}
          style={{ background: 'none', border: '1px solid rgba(34,211,238,0.4)', color: '#22d3ee', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}
        >
          Refresh
        </button>
      </span>
    </div>
  );
}

function AppRoutes() {
  const { loading } = usePort();
  if (loading) return <LoadingScreen />;

  return (
    <>
      <OfflineBanner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />} path="/">
            <Route index element={<CommandCenter />} />
            <Route path="vessels" element={<VesselOperations />} />
            <Route path="fleet" element={<LiveFleet />} />
            <Route path="berths" element={<BerthOptimization />} />
            <Route path="cranes" element={<CraneOperations />} />
            <Route path="quantum" element={<QuantumOptimization />} />
            <Route path="simulation" element={<PortSimulation />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<CommandCenter />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#0A1120',
            border: '1px solid #1A2740',
            color: '#E8EFF9',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '13px',
          },
        }}
      />
    </>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <PortProvider>
        <AppRoutes />
      </PortProvider>
    </ErrorBoundary>
  );
}
