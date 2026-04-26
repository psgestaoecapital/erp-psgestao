import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withAuth } from '@/lib/withAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

async function handler(req: NextRequest, user: any) {
  try {
    const supabase = supabaseAdmin;
    const sp = req.nextUrl.searchParams;

    const grupoId = sp.get('grupo_id');
    const companyIdsParam = sp.get('company_ids');
    const companyIdParam = sp.get('company_id');
    const ano = sp.get('ano') ? parseInt(sp.get('ano')!) : null;
    const mes = sp.get('mes') ? parseInt(sp.get('mes')!) : null;

    let companyIds: string[] = [];
    if (grupoId) {
      const { data: g } = await supabase.from('dashboard_grupos_empresas')
        .select('company_id').eq('grupo_id', grupoId);
      companyIds = (g || []).map((x: any) => x.company_id);
    } else if (companyIdsParam) {
      companyIds = companyIdsParam.split(',').filter(Boolean);
    } else if (companyIdParam) {
      companyIds = [companyIdParam];
    }

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

export const GET = withAuth(handler);
