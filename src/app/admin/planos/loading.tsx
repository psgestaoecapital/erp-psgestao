import { COR } from '@/components/admin/colors';

export default function PlanosLoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton width={220} height={26} />
        <Skeleton width={320} height={14} />
      </div>
      <Skeleton width="100%" height={56} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={240} />
        ))}
      </div>
    </div>
  );
}

function Skeleton({ width, height }: { width: number | string; height: number }) {
  return (
    <div
      style={{
        width,
        height,
        background: `linear-gradient(90deg, ${COR.cream} 0%, ${COR.creamD} 50%, ${COR.cream} 100%)`,
        backgroundSize: '200% 100%',
        borderRadius: 10,
        animation: 'shimmer 1.6s ease-in-out infinite',
      }}
    />
  );
}
