import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { exigirLogin, type ContextoGuarda } from '@/lib/auth/guardaApi';
import { resolverEmpresasDashboard } from '@/lib/auth/empresasDashboard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

async function handler(req: NextRequest, user: ContextoGuarda) {
  try {
    const supabase = supabaseAdmin;
    const searchParams = req.nextUrl.searchParams;
    const ano = searchParams.get('ano') ? parseInt(searchParams.get('ano')!) : null;
    const mes = searchParams.get('mes') ? parseInt(searchParams.get('mes')!) : null;
    const regime = (searchParams.get('regime') || 'competencia') as 'competencia' | 'caixa';
    // Empresas conferidas: ids explícitos todos do usuário (403); grupo → interseção com as do usuário.
    const resolvidas = await resolverEmpresasDashboard(user, searchParams);
    if (resolvidas instanceof NextResponse) return resolvidas;
    const companyIds = resolvidas;

    if (companyIds.length === 0) {
      return NextResponse.json({ erro: 'sem_empresas', requer_config: true });
    }

    const { data, error } = await supabase.rpc('fn_psgc_raiox_1', {
      p_company_ids: companyIds,
      p_ano: ano,
      p_mes: mes,
      p_regime: regime,
    });

    if (error) {
      console.error('[raiox] erro RPC:', error);
      return NextResponse.json({ erro: 'rpc_falhou', detalhe: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ...data,
      contexto: {
        company_ids: companyIds,
        ano: ano,
        mes: mes,
        regime: regime,
      },
    });
  } catch (e: any) {
    console.error('[raiox] excecao:', e);
    return NextResponse.json({ erro: 'excecao', detalhe: e.message }, { status: 500 });
  }
}

export const GET = exigirLogin(handler);
