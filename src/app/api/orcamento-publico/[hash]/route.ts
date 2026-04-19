import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const sbAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// GET: retorna dados do orçamento para exibir ao cliente
export async function GET(req: NextRequest, { params }: { params: { hash: string } }) {
  try {
    const { hash } = params;
    if (!hash || hash.length < 8) {
      return NextResponse.json({ error: 'Hash inválido' }, { status: 400 });
    }

    const { data: orc, error } = await sbAdmin
      .from('erp_orcamentos')
      .select('*')
      .eq('hash_publico', hash)
      .maybeSingle();

    if (error || !orc) {
      return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 });
    }

    // Busca itens
    const { data: itens } = await sbAdmin
      .from('erp_orcamentos_itens')
      .select('*')
      .eq('orcamento_id', orc.id)
      .order('ordem');

    // Busca dados da empresa emitente
    const { data: empresa } = await sbAdmin
      .from('companies')
      .select('razao_social, nome_fantasia, cnpj, cidade_estado')
      .eq('id', orc.company_id)
      .maybeSingle();

    // Auto-registra visualização (se ainda não foi visto)
    const now = new Date().toISOString();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || '';
    
    if (orc.status === 'enviado') {
      await sbAdmin.from('erp_orcamentos').update({
        status: 'visualizado',
        visualizado_em: now,
        visualizado_ip: ip,
        qtd_visualizacoes: (orc.qtd_visualizacoes || 0) + 1,
      }).eq('id', orc.id);

      await sbAdmin.from('erp_orcamento_historico').insert({
        orcamento_id: orc.id,
        company_id: orc.company_id,
        evento: 'visualizado',
        detalhe: 'Cliente abriu o orçamento pela primeira vez',
        ip_address: ip,
      });

      orc.status = 'visualizado';
      orc.qtd_visualizacoes = (orc.qtd_visualizacoes || 0) + 1;
    } else if (['visualizado', 'aprovado', 'recusado'].includes(orc.status)) {
      await sbAdmin.from('erp_orcamentos').update({
        qtd_visualizacoes: (orc.qtd_visualizacoes || 0) + 1,
      }).eq('id', orc.id);
    }

    // Verifica se está expirado
    const expirado = orc.data_validade && new Date(orc.data_validade) < new Date() && 
                     !['aprovado', 'recusado', 'convertido'].includes(orc.status);

    return NextResponse.json({
      orcamento: orc,
      itens: itens || [],
      empresa: empresa || { razao_social: 'Empresa', nome_fantasia: 'Empresa' },
      expirado,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: registra aprovação ou recusa
export async function POST(req: NextRequest, { params }: { params: { hash: string } }) {
  try {
    const { hash } = params;
    const body = await req.json();
    const { acao, nome_aprovador, comentario } = body;

    if (!['aprovar', 'recusar'].includes(acao)) {
      return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
    }

    const { data: orc } = await sbAdmin
      .from('erp_orcamentos')
      .select('id, company_id, status, numero, cliente_nome, total, data_validade')
      .eq('hash_publico', hash)
      .maybeSingle();

    if (!orc) {
      return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 });
    }

    // Verifica se já foi aprovado/recusado ou expirou
    if (['aprovado', 'recusado', 'convertido'].includes(orc.status)) {
      return NextResponse.json({ error: `Este orçamento já foi ${orc.status}` }, { status: 400 });
    }

    if (orc.data_validade && new Date(orc.data_validade) < new Date()) {
      return NextResponse.json({ error: 'Orçamento expirado' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || '';
    const novoStatus = acao === 'aprovar' ? 'aprovado' : 'recusado';

    const update: any = { status: novoStatus };
    if (acao === 'aprovar') update.data_aprovacao = now;
    if (acao === 'recusar') update.data_recusa = now;

    await sbAdmin.from('erp_orcamentos').update(update).eq('id', orc.id);

    await sbAdmin.from('erp_orcamento_historico').insert({
      orcamento_id: orc.id,
      company_id: orc.company_id,
      evento: acao === 'aprovar' ? 'aprovado_cliente' : 'recusado_cliente',
      detalhe: `${acao === 'aprovar' ? '✅ Aprovado' : '❌ Recusado'} por ${nome_aprovador || 'Cliente'}${comentario ? ' — ' + comentario : ''}`,
      usuario_nome: nome_aprovador || 'Cliente (público)',
      ip_address: ip,
      metadata: { acao, nome_aprovador, comentario, via: 'link_publico' },
    });

    return NextResponse.json({ 
      success: true, 
      status: novoStatus,
      message: acao === 'aprovar' 
        ? 'Orçamento aprovado com sucesso!' 
        : 'Orçamento recusado. Obrigado pelo retorno.'
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
