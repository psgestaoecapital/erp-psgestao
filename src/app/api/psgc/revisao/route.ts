// src/app/api/psgc/revisao/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withAuth } from '@/lib/withAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handler(req: NextRequest, user: any) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('company_id');
  const status = searchParams.get('status'); // 'nao_mapeada', 'revisar', 'auto_alta_conf', 'revisado'
  
  if (!companyId) {
    return NextResponse.json({ error: 'company_id obrigatório' }, { status: 400 });
  }
  
  const supabase = supabaseAdmin;
  
  let query = supabase
    .from('v_psgc_depara_revisao')
    .select('*')
    .eq('company_id', companyId)
    .order('status_revisao')
    .order('origem_descricao');
  
  if (status) {
    query = query.eq('status_revisao', status);
  }
  
  const { data, error } = await query;
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  
  // Agrupa por status pra o front mostrar contadores
  const resumo = {
    total: data.length,
    nao_mapeada: data.filter((r: any) => r.status_revisao === 'nao_mapeada').length,
    revisar: data.filter((r: any) => r.status_revisao === 'revisar').length,
    auto_alta_conf: data.filter((r: any) => r.status_revisao === 'auto_alta_conf').length,
    revisado: data.filter((r: any) => r.status_revisao === 'revisado').length
  };
  
  // Lista contas PSGC disponíveis pro dropdown
  const { data: psgcContas } = await supabase
    .from('psgc_contas')
    .select('codigo, nome, natureza, dre_grupo')
    .eq('ativo', true)
    .eq('nivel', 2)
    .order('dre_ordem');
  
  return NextResponse.json({
    company_id: companyId,
    resumo,
    contas: data,
    psgc_disponiveis: psgcContas || []
  });
}

export const GET = withAuth(handler);
