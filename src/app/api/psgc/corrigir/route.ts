// src/app/api/psgc/corrigir/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withAuth } from '@/lib/withAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handler(req: NextRequest, user: any) {
  try {
    const body = await req.json();
    const { company_id, origem_codigo, psgc_codigo_correto } = body;
    
    if (!company_id || !origem_codigo || !psgc_codigo_correto) {
      return NextResponse.json({ 
        error: 'company_id, origem_codigo e psgc_codigo_correto são obrigatórios' 
      }, { status: 400 });
    }
    
    const supabase = supabaseAdmin;
    const { data, error } = await supabase.rpc('fn_psgc_corrigir_mapeamento', {
      p_company_id: company_id,
      p_origem_codigo: origem_codigo,
      p_psgc_codigo_correto: psgc_codigo_correto,
      p_user_id: user?.userId || null
    });
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ 
      sucesso: true,
      resultado: data?.[0] || null,
      mensagem: 'Mapeamento corrigido. DRE dos últimos 12 meses será recalculada em segundo plano.'
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const POST = withAuth(handler);
