// src/app/api/psgc/linha-negocio/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withAuth } from '@/lib/withAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET: lista LNs de uma empresa + keywords
async function getHandler(req: NextRequest, user: any) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('company_id');
  
  if (!companyId) {
    return NextResponse.json({ error: 'company_id obrigatório' }, { status: 400 });
  }
  
  const supabase = supabaseAdmin;
  
  const { data: lns } = await supabase
    .from('business_lines')
    .select('id, name, type, is_active, ln_number')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('ln_number');
  
  const { data: keywords } = await supabase
    .from('business_line_keywords')
    .select('id, business_line_id, keyword, prioridade')
    .in('business_line_id', (lns || []).map((l: any) => l.id));
  
  const lnsComKeywords = (lns || []).map((ln: any) => ({
    ...ln,
    keywords: (keywords || []).filter((k: any) => k.business_line_id === ln.id)
  }));
  
  return NextResponse.json({ company_id: companyId, linhas_negocio: lnsComKeywords });
}

// POST: cria nova LN com keywords
async function postHandler(req: NextRequest, user: any) {
  try {
    const body = await req.json();
    const { company_id, nome, tipo, keywords, cor } = body;
    
    if (!company_id || !nome) {
      return NextResponse.json({ error: 'company_id e nome obrigatórios' }, { status: 400 });
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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({
      sucesso: true,
      resultado: data?.[0] || null,
      mensagem: 'Linha de negócio cadastrada. Reprocessando DRE dos últimos 12 meses em background.'
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const GET = withAuth(getHandler);
export const POST = withAuth(postHandler);
