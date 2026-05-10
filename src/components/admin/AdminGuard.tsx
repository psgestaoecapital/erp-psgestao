'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthProvider';
import { COR } from './colors';

// Wrapper de protecao para todas as paginas /admin/*.
// Reutiliza o useAuth() existente (role === 'adm') em vez de inventar
// novo padrao via middleware (per Regra: nao inventar novo padrao).

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/cliente?next=/admin/planos');
      return;
    }
    if (!isAdmin) {
      router.replace('/dashboard?error=admin_required');
    }
  }, [loading, user, isAdmin, router]);

  if (loading || !user || !isAdmin) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          color: COR.espressoM,
          fontSize: 14,
        }}
      >
        Verificando permissoes...
      </div>
    );
  }

  return <>{children}</>;
}
