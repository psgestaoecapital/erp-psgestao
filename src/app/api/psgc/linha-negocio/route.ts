import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withAuth } from '@/lib/withAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getHandler(req: NextRequest, user: any) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('company_id');

  if (!companyId) {
    return NextResponse.json({ erro: 'company_id obrigatório' }, { status: 400 });
  }

  const supabase = supabaseAdmin;

  const { data: lns } = await supabase
    .from('business_lines')
    .select('id, name, type, is_active, ln_number')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('ln_number');

  const lnIds = (lns || []).map((l: any) => l.id);

  const { data: keywords } = lnIds.length > 0
    ? await supabase
        .from('business_line_keywords')
        .select('id, business_line_id, keyword, prioridade')
        .in('business_line_id', lnIds)
    : { data: [] };

  const lnsComKeywords = (lns || []).map((ln: any) => ({
    ...ln,
    keywords: (keywords || []).filter((k: any) => k.business_line_id === ln.id)
  }));

  return NextResponse.json({ company_id: companyId, linhas_negocio: lnsComKeywords });
}

async function postHandler(req: NextRequest, user: any) {
  try {
    const body = await req.json();
    const { company_id, nome, tipo, keywords, cor } = body;

    if (!company_id || !nome) {
      return NextResponse.json({ erro: 'company_id e nome obrigatórios' }, { status: 400 });
    }

    const supabase = supabaseAdmin;
    const { data, error } = await supabase.rpc('fn_psgc_cadastrar_ln', {
      p_company_id: company_id,
      p_nome: nome,
      p_tipo: tipo || 'servico',
      p_keywords: keywords || [],
      p_cor: cor || '#C8941A'
    });

    if (error) {
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }

    return NextResponse.json({
      sucesso: true,
      resultado: data?.[0] || null,
      mensagem: 'Linha de negócio cadastrada. Reprocessando DRE dos últimos 12 meses em background.'
    });
  } catch (error: any) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
}

export const GET = withAuth(getHandler);
export const POST = withAuth(postHandler);
