'use client';

import { ReactNode } from 'react';
import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens';

interface PSGCButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'attention' | 'info' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: string;
  type?: 'button' | 'submit';
}

export default function PSGCButton({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  icon,
  type = 'button',
}: PSGCButtonProps) {
  const variantStyles: Record<string, React.CSSProperties> = {
    primary: { background: PSGC_COLORS.dourado, color: PSGC_COLORS.espresso },
    secondary: { background: PSGC_COLORS.espresso, color: PSGC_COLORS.offWhite },
    success: { background: PSGC_COLORS.baixa, color: PSGC_COLORS.offWhite },
    danger: { background: PSGC_COLORS.alta, color: PSGC_COLORS.offWhite },
    attention: { background: PSGC_COLORS.media, color: PSGC_COLORS.offWhite },
    info: { background: PSGC_COLORS.azul, color: PSGC_COLORS.offWhite },
    outline: { background: 'transparent', color: PSGC_COLORS.espresso, border: `1px solid ${PSGC_COLORS.espresso}` },
    ghost: { background: 'transparent', color: PSGC_COLORS.espressoLight, border: 'none' },
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: '6px 12px', fontSize: 11 },
    md: { padding: '9px 16px', fontSize: 12 },
    lg: { padding: '12px 20px', fontSize: 13 },
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...variantStyles[variant],
        ...sizeStyles[size],
        border: variantStyles[variant].border || 'none',
        borderRadius: PSGC_RADIUS.md,
        fontWeight: 700,
        letterSpacing: 0.3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? '100%' : undefined,
        transition: 'all 0.15s',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      {icon && <span>{icon}</span>}
      {children}
    </button>
  );
}
