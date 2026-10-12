import { fontFamily } from '../fonts';
import { colors, DEVICE } from '../theme';

export function StatusBar() {
  const h = DEVICE.statusBar;
  const ink = colors.textPrimary;
  const bar = (height: number) => (
    <div style={{ width: 5, height, borderRadius: 1.5, background: ink }} />
  );
  return (
    <div
      style={{
        height: h,
        background: colors.surface1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 34px 0 40px',
        boxSizing: 'border-box',
        fontFamily,
        fontWeight: 600,
        fontSize: 22,
        color: ink,
        letterSpacing: '0.01em',
      }}
    >
      <span>9:41</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2.5, height: 15 }}>
          {bar(6)}
          {bar(9)}
          {bar(12)}
          {bar(15)}
        </div>
        <svg width="22" height="16" viewBox="0 0 22 16">
          <path d="M11 15.5 L7.6 11.6 a4.8 4.8 0 0 1 6.8 0 Z" fill={ink} />
          <path d="M3.9 7.9 a10 10 0 0 1 14.2 0" stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M0.9 4.6 a14.4 14.4 0 0 1 20.2 0" stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </svg>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <div
            style={{
              width: 32,
              height: 15,
              borderRadius: 4.5,
              border: `1.6px solid ${ink}`,
              opacity: 0.95,
              padding: 1.6,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ width: '100%', height: '100%', borderRadius: 2.5, background: ink }} />
          </div>
          <div style={{ width: 2.5, height: 5, borderRadius: 1, background: ink, opacity: 0.6 }} />
        </div>
      </div>
    </div>
  );
}
