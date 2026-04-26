'use client';

import { ReactNode } from 'react';
import { PSGC_COLORS } from '@/lib/psgc-tokens';

interface PSGCBadgeProps {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'success' | 'attention' | 'critical' | 'info' | 'outline';
  size?: 'sm' | 'md';
}

export default function PSGCBadge({
  children,
  variant = 'default',
  size = 'sm',
}: PSGCBadgeProps) {
  const variantStyles: Record<string, React.CSSProperties> = {
    default: { background: PSGC_COLORS.espresso, color: PSGC_COLORS.offWhite },
    primary: { background: PSGC_COLORS.dourado, color: PSGC_COLORS.espresso },
    success: { background: PSGC_COLORS.baixa, color: PSGC_COLORS.offWhite },
    attention: { background: PSGC_COLORS.media, color: PSGC_COLORS.offWhite },
    critical: { background: PSGC_COLORS.alta, color: PSGC_COLORS.offWhite },
    info: { background: PSGC_COLORS.azul, color: PSGC_COLORS.offWhite },
    outline: { background: 'transparent', color: PSGC_COLORS.espresso, border: `1px solid ${PSGC_COLORS.espresso}` },
  };

  return (
    <span style={{
      ...variantStyles[variant],
      fontSize: size === 'sm' ? 10 : 12,
      fontWeight: 700,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      padding: size === 'sm' ? '2px 8px' : '4px 12px',
      borderRadius: 6,
      display: 'inline-block',
      lineHeight: 1.4,
    }}>
      {children}
    </span>
  );
}
