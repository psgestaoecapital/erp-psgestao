// src/app/api/dashboard/home/route.ts
// v2 — suporta tanto modo mes (ano+mes) quanto modo custom (data_inicio+data_fim)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const companyIdsParam = url.searchParams.get('company_ids');
    const anoParam = url.searchParams.get('ano');
    const mesParam = url.searchParams.get('mes');
    const dataInicioParam = url.searchParams.get('data_inicio');
    const dataFimParam = url.searchParams.get('data_fim');
    const regimeParam = url.searchParams.get('regime');
    // Default 'competencia' preserva comportamento legado (zero risco para
    // empresas que nao usam regime caixa).
    const regime: 'competencia' | 'caixa' =
      regimeParam === 'caixa' ? 'caixa' : 'competencia';

    if (!companyIdsParam) {
      return NextResponse.json(
        { ok: false, error: 'Parametro company_ids obrigatorio' },
        { status: 400 }
      );
    }

    const companyIds = companyIdsParam.split(',').filter(Boolean);
    if (companyIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'company_ids vazio' }, { status: 400 });
    }

    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supa = createClient(supaUrl, supaKey);

    // Modo CUSTOM (datepicker): data_inicio + data_fim
    if (dataInicioParam && dataFimParam) {
      const { data, error } = await supa.rpc('fn_dashboard_home_periodo', {
        p_company_ids: companyIds,
        p_data_inicio: dataInicioParam,
        p_data_fim: dataFimParam,
      });

      if (error) {
        console.error('[dashboard/home periodo] erro:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, ...data });
    }

    // Modo MES (default): ano + mes
    const ano = anoParam ? parseInt(anoParam, 10) : null;
    const mes = mesParam ? parseInt(mesParam, 10) : null;

    const { data, error } = await supa.rpc('fn_dashboard_home', {
      p_company_ids: companyIds,
      p_ano: ano,
      p_mes: mes,
      p_regime: regime,
    });

    if (error) {
      console.error('[dashboard/home] erro:', error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ...data });
  } catch (e: any) {
    console.error('[dashboard/home] excecao:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
