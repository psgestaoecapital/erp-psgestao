// src/app/api/dashboard/periodos/route.ts
// Lista periodos (meses) com dados disponiveis para o seletor

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const companyIdsParam = url.searchParams.get('company_ids');

    if (!companyIdsParam) {
      return NextResponse.json(
        { ok: false, error: 'Parametro company_ids obrigatorio' },
        { status: 400 }
      );
    }

    const companyIds = companyIdsParam.split(',').filter(Boolean);
    if (companyIds.length === 0) {
      return NextResponse.json({ ok: true, periodos: [] });
    }

    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supa = createClient(supaUrl, supaKey);

    const { data, error } = await supa.rpc('fn_periodos_disponiveis', {
      p_company_ids: companyIds,
    });

    if (error) {
      console.error('[dashboard/periodos] erro:', error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      periodos: data || [],
    });
  } catch (e: any) {
    console.error('[dashboard/periodos] excecao:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
