'use client';

// FIX-LANDING-AREA-RESTRITA (07/07): antes esta index redirecionava HARDCODED
// pra /dashboard/gestao-empresarial. Usuario restrito (user_areas_allowed
// restricted=true) a uma area que NAO seja GE — ex.: SST da Frioeste
// (areas_allowed=['compliance']) — caia na GE e ficava preso: o
// AreaRedirectGuard nao o tira de la porque GE nem aparece na lista de areas
// permitidas dele (entao o guard trata GE como rota transversal e deixa
// passar). Efeito percebido: 404 / tela errada pos-login.
//
// Agora: descobre as areas permitidas do usuario (fn_listar_areas_visiveis) e
// manda pra rota_raiz certa — GE quando permitida (default de todos os planos
// GE), ou a 1a area permitida quando o usuario e' restrito a outra area.
// Fallback GE em qualquer erro (comportamento antigo preservado).

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const AREA_GE = 'gestao_empresarial';
const ROTA_GE = '/dashboard/gestao-empresarial';

function lerCompanyId(): string | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem('ps_empresa_sel');
  if (!v || v === 'consolidado' || v.startsWith('group_')) return null;
  return v;
}

type AreaVisivel = { area_slug: string; rota_raiz: string | null; empresa_tem_acesso: boolean };

export default function DashboardIndex() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace(ROTA_GE); return; }

        // company: localStorage; se vazio, tenta a unica empresa do usuario.
        let companyId = lerCompanyId();
        if (!companyId) {
          const { data: ucs } = await supabase
            .from('user_companies').select('company_id').eq('user_id', user.id).limit(2);
          if (ucs && ucs.length === 1) companyId = (ucs[0] as { company_id: string }).company_id;
        }

        const { data } = await supabase.rpc('fn_listar_areas_visiveis', {
          p_company_id: companyId, p_user_id: user.id,
        });
        if (!alive) return;

        const areas = (data ?? []) as AreaVisivel[];
        // GE permitida (ou nao ha dado) -> mantem default GE.
        // Usuario restrito a outra area -> 1a area permitida com rota valida.
        const temGE = areas.some((a) => a.area_slug === AREA_GE);
        if (temGE || areas.length === 0) { router.replace(ROTA_GE); return; }
        const destino = areas.find((a) => a.rota_raiz)?.rota_raiz ?? ROTA_GE;
        router.replace(destino);
      } catch {
        if (alive) router.replace(ROTA_GE);
      }
    })();
    return () => { alive = false; };
  }, [router]);

  return (
    <div style={{
      padding: 40,
      background: '#FAF7F2',
      minHeight: '100vh',
      color: '#3D2314',
      fontFamily: 'Inter, system-ui, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      Carregando Dashboard...
    </div>
  );
}
