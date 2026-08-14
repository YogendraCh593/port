import React from 'react';

interface State { hasError: boolean; message: string }

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', background: '#04070e', color: '#e8eff9',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: 'JetBrains Mono, monospace', padding: 32,
        }}>
          <div style={{
            border: '1px solid rgba(251,95,114,0.4)', borderRadius: 14,
            background: 'rgba(251,95,114,0.06)', padding: '32px 40px',
            maxWidth: 600, width: '100%',
          }}>
            <p style={{ color: '#fb5f72', fontWeight: 800, fontSize: 13, letterSpacing: '0.1em', marginBottom: 12 }}>
              ⚠ NEXUSPORT — STARTUP ERROR
            </p>
            <p style={{ color: '#e8eff9', fontSize: 12, marginBottom: 16 }}>
              The app crashed during initialisation. This is usually because the
              Python backend is not running.
            </p>
            <div style={{
              background: '#070d18', borderRadius: 8, padding: '12px 16px',
              border: '1px solid #1a2740', marginBottom: 20,
              color: '#8ba2c6', fontSize: 11, wordBreak: 'break-word',
            }}>
              {this.state.message || 'Unknown error'}
            </div>

            <p style={{ color: '#8ba2c6', fontSize: 11, marginBottom: 8 }}>
              Fix: start the backend first, then refresh this page.
            </p>
            <div style={{
              background: '#0a1120', borderRadius: 8, padding: '10px 14px',
              border: '1px solid #1a2740', color: '#22d3ee', fontSize: 11,
            }}>
              cd C:\Users\Lenovo\Downloads\Quantum\backend<br />
              python -m uvicorn main:app --port 8000 --reload
            </div>

            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 20, padding: '10px 24px', borderRadius: 8,
                background: 'linear-gradient(135deg,#0891b2,#4f46e5)',
                color: '#fff', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: 700, fontSize: 12,
                letterSpacing: '0.08em',
              }}
            >
              RELOAD APP
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
