import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Credenciais Supabase não configuradas');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cliente_id } = body;
    if (!cliente_id) return NextResponse.json({ error: 'cliente_id obrigatório' }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada no ambiente' }, { status: 500 });

    const sb = getAdmin();

    // Busca dados do cliente
    const { data: cliente } = await sb
      .from('erp_clientes')
      .select('*')
      .eq('id', cliente_id)
      .maybeSingle();
    if (!cliente) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    // Busca histórico de score (últimos 6 registros)
    const { data: historico } = await sb
      .from('erp_score_historico')
      .select('*')
      .eq('cliente_id', cliente_id)
      .order('calculado_em', { ascending: false })
      .limit(6);

    // Busca últimos 20 lançamentos
    const { data: lancamentos } = await sb
      .from('erp_lancamentos')
      .select('valor, data_emissao, data_vencimento, data_pagamento, status, descricao')
      .or(`cliente_id.eq.${cliente_id},cliente_cnpj.eq.${cliente.cpf_cnpj}`)
      .eq('company_id', cliente.company_id)
      .in('tipo', ['receita', 'entrada', 'receber'])
      .order('data_emissao', { ascending: false })
      .limit(20);

    // Busca últimos 5 pedidos
    const { data: pedidos } = await sb
      .from('erp_pedidos')
      .select('numero, data_pedido, total, status')
      .eq('company_id', cliente.company_id)
      .or(`cliente_id.eq.${cliente_id},cliente_cnpj.eq.${cliente.cpf_cnpj}`)
      .order('data_pedido', { ascending: false })
      .limit(5);

    const componentes = historico?.[0]?.componentes || {};

    // Monta prompt para Claude
    const prompt = `Você é um analista financeiro sênior especializado em análise de crédito B2B para pequenas e médias empresas brasileiras. Analise o cliente abaixo e forneça um parecer direto e objetivo em português.

DADOS DO CLIENTE:
- Nome/Razão: ${cliente.razao_social || cliente.nome || 'N/A'}
- Nome Fantasia: ${cliente.nome_fantasia || '—'}
- CNPJ/CPF: ${cliente.cpf_cnpj || '—'}
- Categoria: ${cliente.categoria || '—'}
- Cidade/UF: ${cliente.cidade || '—'}/${cliente.uf || '—'}
- Ativo desde: ${cliente.created_at?.slice(0, 10) || '—'}
- Limite de crédito atual: R$ ${Number(cliente.limite_credito || 0).toLocaleString('pt-BR')}

SCORE DE INADIMPLÊNCIA ATUAL:
- Score: ${cliente.score_inadimplencia || 0}/100 (0=baixo risco, 100=alto risco)
- Classificação: ${cliente.classificacao_risco || 'NOVO'}
- Total comprado (12m): R$ ${Number(cliente.total_compras || 0).toLocaleString('pt-BR')}
- Qtd de títulos pagos: ${cliente.qtd_compras || 0}
- Qtd de atrasos: ${cliente.qtd_atrasos || 0}
- Dias médio de atraso: ${Number(cliente.dias_medio_atraso || 0).toFixed(1)}
- Ticket médio: R$ ${Number(cliente.ticket_medio || 0).toLocaleString('pt-BR')}

COMPONENTES DO SCORE:
${JSON.stringify(componentes, null, 2)}

HISTÓRICO DE SCORE (mais recente primeiro):
${historico?.map(h => `- ${h.calculado_em?.slice(0, 10)}: score ${h.score} (${h.classificacao})`).join('\n') || 'Nenhum histórico anterior'}

ÚLTIMOS 20 LANÇAMENTOS:
${lancamentos?.map(l => `- ${l.data_emissao}: R$ ${Number(l.valor).toFixed(2)} venc ${l.data_vencimento} | ${l.status}${l.data_pagamento ? ' pago em ' + l.data_pagamento : ''}`).join('\n') || 'Sem lançamentos'}

ÚLTIMOS 5 PEDIDOS:
${pedidos?.map(p => `- ${p.numero} em ${p.data_pedido}: R$ ${Number(p.total).toFixed(2)} (${p.status})`).join('\n') || 'Sem pedidos'}

Forneça um parecer estruturado com:

**1. DIAGNÓSTICO** (2-3 linhas, direto ao ponto)
Qual a situação atual do cliente e o que os números revelam.

**2. PONTOS DE ATENÇÃO** (bullet points)
Sinais de alerta específicos identificados.

**3. RECOMENDAÇÕES** (bullet points com ação concreta)
- Limite de crédito sugerido (com valor em R$)
- Condição de pagamento recomendada
- Ações pra reduzir risco (negociação, cobrança, etc)

**4. CENÁRIO FUTURO** (1-2 linhas)
Projeção pros próximos 3 meses.

Use linguagem profissional mas acessível. Seja específico com números. Se houver poucos dados, diga isso claramente.`;

    // Chama Claude API
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return NextResponse.json({ error: `Claude API erro: ${claudeRes.status} - ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const claudeData = await claudeRes.json();
    const parecer = claudeData.content?.[0]?.text || 'Sem parecer gerado';

    return NextResponse.json({
      success: true,
      parecer,
      cliente: {
        nome: cliente.razao_social || cliente.nome,
        score: cliente.score_inadimplencia,
        classificacao: cliente.classificacao_risco,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Erro interno' }, { status: 500 });
  }
}
