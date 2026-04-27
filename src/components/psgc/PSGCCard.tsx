'use client';

import { ReactNode } from 'react';
import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens';

interface PSGCCardProps {
  children: ReactNode;
  variant?: 'default' | 'outlined' | 'elevated' | 'critical' | 'attention' | 'success' | 'info';
  borderTopColor?: string;
  borderLeftColor?: string;
  padding?: number | string;
  marginBottom?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export default function PSGCCard({
  children,
  variant = 'default',
  borderTopColor,
  borderLeftColor,
  padding = '14px 16px',
  marginBottom,
  onClick,
  style = {},
}: PSGCCardProps) {
  const variantStyles: Record<string, React.CSSProperties> = {
    default: {
      background: PSGC_COLORS.offWhite,
      border: `1px solid ${PSGC_COLORS.offWhiteDark}`,
    },
    outlined: {
      background: 'transparent',
      border: `1px solid ${PSGC_COLORS.offWhiteDark}`,
    },
    elevated: {
      background: PSGC_COLORS.offWhite,
      border: `1px solid ${PSGC_COLORS.offWhiteDark}`,
      boxShadow: '0 2px 8px rgba(61, 35, 20, 0.06)',
    },
    critical: {
      background: PSGC_COLORS.vermelhoSoft,
      borderLeft: `4px solid ${PSGC_COLORS.alta}`,
    },
    attention: {
      background: PSGC_COLORS.amareloSoft,
      borderLeft: `4px solid ${PSGC_COLORS.media}`,
    },
    success: {
      background: PSGC_COLORS.verdeSoft,
      borderLeft: `4px solid ${PSGC_COLORS.baixa}`,
    },
    info: {
      background: PSGC_COLORS.azulSoft,
      borderLeft: `4px solid ${PSGC_COLORS.azul}`,
    },
  };

  return (
    <div
      onClick={onClick}
      style={{
        ...variantStyles[variant],
        borderRadius: PSGC_RADIUS.lg,
        padding,
        marginBottom,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
        ...(borderTopColor ? { borderTop: `3px solid ${borderTopColor}` } : {}),
        ...(borderLeftColor ? { borderLeft: `4px solid ${borderLeftColor}` } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
