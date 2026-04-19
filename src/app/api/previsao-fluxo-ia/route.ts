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
    const { company_id, projecao, saldo_inicial, alertas, periodo_dias } = body;
    if (!company_id || !projecao) return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 });

    const sb = getAdmin();
    const { data: empresa } = await sb.from('companies').select('razao_social, nome_fantasia').eq('id', company_id).maybeSingle();

    // Calcula totais
    const totalEntradas = projecao.reduce((s: number, d: any) => s + Number(d.entrada_provavel || 0), 0);
    const totalSaidas = projecao.reduce((s: number, d: any) => s + Number(d.saida_certa || 0) + Number(d.saida_recorrente || 0), 0);
    const saldoFinal = projecao[projecao.length - 1]?.saldo_acumulado || saldo_inicial;
    const menorSaldo = Math.min(...projecao.map((d: any) => Number(d.saldo_acumulado || 0)));
    const diasNegativos = projecao.filter((d: any) => Number(d.saldo_acumulado || 0) < 0).length;

    // Pega 10 maiores entradas e saídas
    const todosEventos: any[] = projecao.flatMap((d: any) => (d.eventos || []).map((e: any) => ({ ...e, data: d.data })));
    const maiores = todosEventos.sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0)).slice(0, 10);

    const prompt = `Você é um CFO virtual que analisa fluxo de caixa pra pequenas e médias empresas brasileiras. Analise a projeção abaixo e forneça um parecer direto e acionável em português.

EMPRESA: ${empresa?.nome_fantasia || empresa?.razao_social || 'Empresa'}
PERÍODO PROJETADO: ${periodo_dias} dias (${projecao[0]?.data} a ${projecao[projecao.length-1]?.data})

SITUAÇÃO ATUAL:
- Saldo inicial: R$ ${Number(saldo_inicial).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

PROJEÇÃO (${periodo_dias} dias):
- Total de entradas esperadas: R$ ${totalEntradas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Total de saídas previstas: R$ ${totalSaidas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Resultado do período: R$ ${(totalEntradas - totalSaidas).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Saldo final projetado: R$ ${Number(saldoFinal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Menor saldo no período: R$ ${menorSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Dias com saldo negativo: ${diasNegativos}

ALERTAS DE CAIXA:
${(alertas || []).slice(0, 5).map((a: any) => `- ${a.data}: ${a.mensagem}`).join('\n') || 'Nenhum alerta crítico'}

PRINCIPAIS EVENTOS DO PERÍODO:
${maiores.slice(0, 10).map((e: any) => `- ${e.data}: ${e.tipo === 'receita' ? 'RECEBER' : 'PAGAR'} R$ ${Number(e.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} - ${e.descricao}${e.cliente ? ' (' + e.cliente + ')' : ''}${e.score ? ' [score: ' + e.score + ']' : ''}`).join('\n')}

Forneça uma análise estruturada com:

**1. DIAGNÓSTICO** (2-3 linhas)
Situação geral do fluxo nos próximos ${periodo_dias} dias.

**2. PONTOS CRÍTICOS** (bullet points)
Dias críticos, riscos de caixa, clientes de alto risco concentrados, gargalos identificados.

**3. AÇÕES IMEDIATAS** (próximos 7 dias)
O que fazer AGORA pra não ter problema de caixa.

**4. AÇÕES PREVENTIVAS** (7-30 dias)
Renegociações, antecipações de recebíveis, cortes sugeridos.

**5. OPORTUNIDADES** (se houver sobra de caixa)
O que fazer com saldo excedente (aplicação, quitação antecipada de dívidas, investimentos).

Seja específico com valores em R$ e datas. Use linguagem direta de gestão financeira. Se os números forem saudáveis, diga claramente.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return NextResponse.json({ error: `Claude API: ${claudeRes.status} - ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const data = await claudeRes.json();
    const parecer = data.content?.[0]?.text || 'Sem parecer gerado';

    return NextResponse.json({ success: true, parecer });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Erro interno' }, { status: 500 });
  }
}
