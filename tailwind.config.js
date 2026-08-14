export default {
  content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      colors: {
        void: '#04070E',
        abyss: '#070D18',
        hull: '#0A1120',
        deck: '#0F1829',
        line: '#1A2740',
        edge: '#28395A',
        mist: '#8BA2C6',
        chalk: '#E8EFF9',
        aqua: '#22D3EE',
        ocean: '#3B82F6',
        marine: '#14B8A6',
        ok: '#34D399',
        warn: '#F5A524',
        crit: '#FB5F72',
        quantum: '#A78BFA',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 32px -18px rgba(0,0,0,0.9)',
        glow: '0 0 0 1px rgba(34,211,238,0.35), 0 0 24px -6px rgba(34,211,238,0.45)',
      },
      letterSpacing: {
        wider2: '0.14em',
      },
    },
  },
  plugins: [],
};
