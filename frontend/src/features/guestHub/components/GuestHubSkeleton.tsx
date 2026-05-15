import '../GuestHubPage.css';

const C = {
  bg:      '#0C0A09',
  surface: '#141210',
  elevated:'#1C1916',
  border:  '#28231E',
} as const;

function Bone({ width = '100%', height = 16, radius = 6, style }: {
  width?:  number | string;
  height?: number;
  radius?: number;
  style?:  React.CSSProperties;
}) {
  return (
    <div
      className="gh-skeleton-bone"
      style={{ width, height, borderRadius: radius, backgroundColor: C.elevated, ...style }}
    />
  );
}

// ─── Premium hospitality loading skeleton ────────────────────────────────────
// Mirrors the actual page layout so content "fills in" without layout shift.

export default function GuestHubSkeleton() {
  return (
    <div style={{
      backgroundColor: C.bg,
      minHeight: '100dvh',
      overflowX: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", system-ui, sans-serif',
    }}>

      {/* Hero — matches new min(90vw, 520px) height */}
      <div style={{
        height: 'min(90vw, 520px)',
        background: 'linear-gradient(180deg, #241206 0%, #130A04 40%, #0C0A09 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div className="gh-skeleton-bone" style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, #2A1810 0%, #141210 55%, #0C0A09 100%)',
          borderRadius: 0,
        }} />
        {/* Simulated identity block — logo + accent bar + title + tagline */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 24px 40px' }}>
          <Bone width={52} height={52} radius={14} style={{ marginBottom: 20 }} />
          <Bone width={28} height={2} radius={1} style={{ marginBottom: 16 }} />
          <Bone width={220} height={40} radius={8} style={{ marginBottom: 12 }} />
          <Bone width={280} height={15} radius={5} />
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 24px 80px' }}>

        {/* Quick actions */}
        <div style={{ marginTop: 32 }}>
          <Bone width="100%" height={52} radius={12} style={{ marginBottom: 10 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Bone height={48} radius={12} />
            <Bone height={48} radius={12} />
          </div>
          <Bone width="100%" height={48} radius={12} style={{ marginTop: 10 }} />
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: C.border, margin: '40px 0' }} />

        {/* Featured dishes section header — no scroll button bones */}
        <div style={{ marginBottom: 20 }}>
          <Bone width={100} height={10} radius={4} style={{ marginBottom: 10 }} />
          <Bone width={180} height={24} radius={6} />
        </div>

        {/* Dish carousel — 3 card silhouettes at new 192×148 dimensions */}
        <div style={{ margin: '0 -24px', paddingLeft: 24, paddingRight: 24, display: 'flex', gap: 12, overflowX: 'hidden' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              flexShrink: 0,
              width: 192,
              borderRadius: 16,
              overflow: 'hidden',
              background: C.surface,
              border: `1px solid ${C.border}`,
            }}>
              <Bone width="100%" height={148} radius={0} />
              <div style={{ padding: '14px 16px 16px' }}>
                <Bone width="70%" height={15} radius={4} style={{ marginBottom: 7 }} />
                <Bone width="90%" height={12} radius={4} style={{ marginBottom: 4 }} />
                <Bone width="60%" height={12} radius={4} style={{ marginBottom: 10 }} />
                <Bone width={44} height={15} radius={4} />
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: C.border, margin: '40px 0' }} />

        {/* Menu categories */}
        <Bone width={70} height={10} radius={4} style={{ marginBottom: 10 }} />
        <Bone width={210} height={24} radius={6} style={{ marginBottom: 20 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{
              padding: '16px 18px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
            }}>
              <Bone width="65%" height={13} radius={4} style={{ marginBottom: 7 }} />
              <Bone width={50} height={11} radius={4} />
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: C.border, margin: '40px 0' }} />

        {/* Promotions */}
        <Bone width={70} height={10} radius={4} style={{ marginBottom: 10 }} />
        <Bone width={190} height={24} radius={6} style={{ marginBottom: 20 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              padding: '18px 18px 20px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
            }}>
              <Bone width={70} height={18} radius={5} style={{ marginBottom: 10 }} />
              <Bone width="80%" height={14} radius={4} style={{ marginBottom: 9 }} />
              <Bone width="100%" height={12} radius={4} style={{ marginBottom: 5 }} />
              <Bone width="75%" height={12} radius={4} />
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
