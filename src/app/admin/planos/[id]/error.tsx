'use client';

import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { COR } from '@/components/admin/colors';

export default function PlanoDetalheError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
      <Link href="/admin/planos" style={{ textDecoration: 'none', color: COR.espressoM }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <ArrowLeft size={14} /> Voltar para planos
        </span>
      </Link>

      <div
        style={{
          background: COR.redBg,
          border: `1px solid ${COR.red}`,
          borderRadius: 10,
          padding: 18,
          color: COR.red,
          fontSize: 13,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <strong style={{ fontSize: 14 }}>Falha ao carregar o plano</strong>
        <span style={{ color: COR.espresso, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-word' }}>
          {error.message}
        </span>
        <button
          type="button"
          onClick={reset}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            padding: '8px 14px',
            background: COR.espresso,
            color: COR.offWhite,
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={13} /> Tentar novamente
        </button>
      </div>
    </div>
  );
}
