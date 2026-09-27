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
    const sp = req.nextUrl.searchParams;
    const ano = sp.get('ano') ? parseInt(sp.get('ano')!) : null;
    const mes = sp.get('mes') ? parseInt(sp.get('mes')!) : null;

    // Empresas conferidas: ids explícitos todos do usuário (403); grupo → interseção com as do usuário.
    const resolvidas = await resolverEmpresasDashboard(user, sp);
    if (resolvidas instanceof NextResponse) return resolvidas;
    const companyIds = resolvidas;

    if (companyIds.length === 0) {
      return NextResponse.json({ erro: 'sem_empresas' });
    }

    const { data, error } = await supabase.rpc('fn_psgc_dfc_indireto', {
      p_company_ids: companyIds, p_ano: ano, p_mes: mes,
    });

    if (error) {
      return NextResponse.json({ erro: 'rpc_falhou', detalhe: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ erro: 'excecao', detalhe: e.message }, { status: 500 });
  }
}

export const GET = exigirLogin(handler);
