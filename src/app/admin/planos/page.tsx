'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AdminGuard from '@/components/admin/AdminGuard';
import PlanosFiltrosGrid from '@/components/admin/PlanosFiltrosGrid';
import { type PlanoRow } from '@/components/admin/PlanoCard';
import PlanosLoadingSkeleton from './loading';
import { COR } from '@/components/admin/colors';

export default function PlanosPage() {
  return (
    <AdminGuard>
      <PlanosContent />
    </AdminGuard>
  );
}

function PlanosContent() {
  const [planos, setPlanos] = useState<PlanoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: err } = await supabase
        .from('v_admin_planos_completo')
        .select('*')
        .order('clientes_ativos', { ascending: false, nullsFirst: false });

      if (!alive) return;

      if (err) {
        setError(err.message);
        return;
      }
      setPlanos((data ?? []) as PlanoRow[]);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div
        style={{
          background: COR.redBg,
          border: `1px solid ${COR.red}`,
          borderRadius: 10,
          padding: 18,
          color: COR.red,
          fontSize: 13,
        }}
      >
        Erro ao carregar planos: {error}
      </div>
    );
  }

  if (planos == null) {
    return <PlanosLoadingSkeleton />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: COR.espresso,
            margin: 0,
          }}
        >
          Planos comerciais
        </h1>
        <p style={{ fontSize: 13, color: COR.espressoM, margin: 0 }}>
          {planos.length} planos no catalogo. Clique em qualquer um para ver modulos e features.
        </p>
      </header>

      <PlanosFiltrosGrid planos={planos} />
    </div>
  );
}
