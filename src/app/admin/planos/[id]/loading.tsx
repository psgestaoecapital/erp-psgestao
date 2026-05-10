import { COR } from '@/components/admin/colors';

export default function PlanoDetalheLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Skeleton width={140} height={14} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton width={300} height={28} />
        <div style={{ display: 'flex', gap: 6 }}>
          <Skeleton width={70} height={20} />
          <Skeleton width={70} height={20} />
          <Skeleton width={70} height={20} />
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={100} />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} width="100%" height={70} />
      ))}
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
