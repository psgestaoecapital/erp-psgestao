import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withAuth } from '@/lib/withAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handler(req: NextRequest, user: any) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('company_id');
  const status = searchParams.get('status');

  if (!companyId) {
    return NextResponse.json({ erro: 'company_id obrigatório' }, { status: 400 });
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
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const contas = data || [];

  const resumo = {
    total: contas.length,
    nao_mapeada: contas.filter((r: any) => r.status_revisao === 'nao_mapeada').length,
    revisar: contas.filter((r: any) => r.status_revisao === 'revisar').length,
    auto_alta_conf: contas.filter((r: any) => r.status_revisao === 'auto_alta_conf').length,
    revisado: contas.filter((r: any) => r.status_revisao === 'revisado').length
  };

  const { data: psgcContas } = await supabase
    .from('psgc_contas')
    .select('codigo, nome, natureza, dre_grupo')
    .eq('ativo', true)
    .eq('nivel', 2)
    .order('dre_ordem');

  return NextResponse.json({
    company_id: companyId,
    resumo,
    contas,
    psgc_disponiveis: psgcContas || []
  });
}

export const GET = withAuth(handler);
