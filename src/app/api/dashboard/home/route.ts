// src/app/api/dashboard/home/route.ts
// Retorna KPIs do Dashboard home com periodo flexivel

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const companyIdsParam = url.searchParams.get('company_ids');
    const anoParam = url.searchParams.get('ano');
    const mesParam = url.searchParams.get('mes');

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

    const ano = anoParam ? parseInt(anoParam, 10) : null;
    const mes = mesParam ? parseInt(mesParam, 10) : null;

    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supa = createClient(supaUrl, supaKey);

    const { data, error } = await supa.rpc('fn_dashboard_home', {
      p_company_ids: companyIds,
      p_ano: ano,
      p_mes: mes,
    });

    if (error) {
      console.error('[dashboard/home] erro:', error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      ...data,
    });
  } catch (e: any) {
    console.error('[dashboard/home] excecao:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
