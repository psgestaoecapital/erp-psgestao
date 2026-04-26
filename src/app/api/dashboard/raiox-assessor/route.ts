import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withAuth } from '@/lib/withAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

async function handler(req: NextRequest, user: any) {
  try {
    const supabase = supabaseAdmin;
    const searchParams = req.nextUrl.searchParams;

    const grupoId = searchParams.get('grupo_id');
    const companyIdsParam = searchParams.get('company_ids');
    const companyIdParam = searchParams.get('company_id');
    const ano = searchParams.get('ano') ? parseInt(searchParams.get('ano')!) : null;
    const mes = searchParams.get('mes') ? parseInt(searchParams.get('mes')!) : null;

    let companyIds: string[] = [];
    if (grupoId) {
      const { data: grupoEmps } = await supabase
        .from('dashboard_grupos_empresas')
        .select('company_id')
        .eq('grupo_id', grupoId);
      companyIds = (grupoEmps || []).map((g: any) => g.company_id);
    } else if (companyIdsParam) {
      companyIds = companyIdsParam.split(',').filter(Boolean);
    } else if (companyIdParam) {
      companyIds = [companyIdParam];
    }

    if (companyIds.length === 0) {
      return NextResponse.json({ erro: 'sem_empresas', requer_config: true });
    }

    // 3 RPCs em paralelo
    const [avAhRes, tributarioRes, narrativaRes] = await Promise.all([
      supabase.rpc('fn_psgc_analise_vertical_horizontal', {
        p_company_ids: companyIds, p_ano: ano, p_mes: mes,
      }),
      supabase.rpc('fn_psgc_apuracao_tributaria', {
        p_company_ids: companyIds, p_ano: ano, p_mes: mes,
      }),
      supabase.rpc('fn_psgc_narrativa_cfo', {
        p_company_ids: companyIds, p_ano: ano, p_mes: mes,
      }),
    ]);

    return NextResponse.json({
      av_ah: avAhRes.error ? null : avAhRes.data,
      tributario: tributarioRes.error ? null : tributarioRes.data,
      narrativa: narrativaRes.error ? null : narrativaRes.data,
      contexto: { company_ids: companyIds, ano, mes },
    });
  } catch (e: any) {
    console.error('[raiox-assessor] excecao:', e);
    return NextResponse.json({ erro: 'excecao', detalhe: e.message }, { status: 500 });
  }
}

export const GET = withAuth(handler);
