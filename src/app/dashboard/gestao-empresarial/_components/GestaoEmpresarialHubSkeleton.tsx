import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens'

const block = (style: React.CSSProperties): React.CSSProperties => ({
  backgroundColor: PSGC_COLORS.offWhiteDark,
  borderRadius: PSGC_RADIUS.md,
  animation: 'psgcPulse 1.4s ease-in-out infinite',
  ...style,
})

export function GestaoEmpresarialHubSkeleton() {
  return (
    <div style={{ backgroundColor: PSGC_COLORS.offWhite, minHeight: '100vh' }}>
      <style>{'@keyframes psgcPulse{0%,100%{opacity:1}50%{opacity:.5}}'}</style>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
        <div style={block({ height: 40, width: '60%', marginBottom: 12 })} />
        <div style={block({ height: 16, width: 'min(100%, 420px)', marginBottom: 32 })} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 40 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={block({ height: 88 })} />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={block({ height: 240, borderRadius: PSGC_RADIUS.lg })} />
          ))}
        </div>
      </div>
    </div>
  )
}
