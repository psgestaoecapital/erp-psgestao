'use client';

import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens';

interface PSGCMetricProps {
  label: string;
  valor: string | number;
  delta?: { valor: number | null; sufixo?: string } | null;
  icon?: string;
  cor?: string;
  corBg?: string;
  destaque?: boolean;
  pequeno?: boolean;
  onClick?: () => void;
}

export default function PSGCMetric({
  label,
  valor,
  delta,
  icon,
  cor = PSGC_COLORS.espresso,
  corBg = PSGC_COLORS.offWhite,
  destaque = false,
  pequeno = false,
  onClick,
}: PSGCMetricProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: corBg,
        borderLeft: `4px solid ${cor}`,
        borderRadius: PSGC_RADIUS.lg,
        padding: pequeno ? '10px 12px' : '14px 16px',
        cursor: onClick ? 'pointer' : 'default',
        ...(destaque && { boxShadow: `0 0 0 2px ${cor}30` }),
      }}
    >
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: cor,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div style={{
        fontSize: pequeno ? 18 : 22,
        fontWeight: 800,
        color: PSGC_COLORS.espresso,
        letterSpacing: -0.5,
        lineHeight: 1.1,
      }}>
        {valor}
      </div>
      {delta && delta.valor !== null && delta.valor !== undefined && (
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          marginTop: 4,
          color: delta.valor > 0 ? PSGC_COLORS.baixa : delta.valor < 0 ? PSGC_COLORS.alta : PSGC_COLORS.espressoLight,
        }}>
          {delta.valor > 0 ? '+' : ''}{delta.valor.toFixed(1)}{delta.sufixo || '%'}
        </div>
      )}
    </div>
  );
}
