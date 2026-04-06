import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { financial_data, empresa_nome, periodo_inicio, periodo_fim, plano_acao, contexto } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada. Adicione nas Environment Variables do Vercel." }, { status: 500 });
    }

    const d = financial_data;
    if (!d) {
      return NextResponse.json({ error: "Dados financeiros não fornecidos" }, { status: 400 });
    }

    const prompt = `Você é o PS, o consultor digital da PS Gestão e Capital. Você tem 26 anos de experiência em gestão empresarial, especialista em PMEs brasileiras. Analise os dados financeiros reais desta empresa e gere um relatório executivo completo. Assine como "PS — Seu Consultor Digital".

EMPRESA: ${empresa_nome || "Grupo Empresarial"}
PERÍODO: ${periodo_inicio} a ${periodo_fim}

=== DADOS FINANCEIROS REAIS (do sistema Omie) ===
Receita Operacional Total: R$ ${((d.total_rec_operacional || d.total_receitas || 0) / 1000).toFixed(0)}K
Empréstimos/Financiamentos Recebidos: R$ ${((d.total_emprestimos || 0) / 1000).toFixed(0)}K
Despesas Totais: R$ ${((d.total_despesas || 0) / 1000).toFixed(0)}K
Resultado Operacional: R$ ${((d.resultado_periodo || 0) / 1000).toFixed(0)}K
Margem: ${d.margem || 0}%
Clientes cadastrados: ${d.total_clientes || 0}
Empresas no grupo: ${d.num_empresas || 1}

=== TOP RECEITAS OPERACIONAIS ===
${(d.top_receitas_operacionais || []).map((r: any, i: number) => `${i + 1}. ${r.nome}: R$ ${(r.valor / 1000).toFixed(0)}K`).join("\n") || "Sem dados"}

=== TOP EMPRÉSTIMOS/FINANCIAMENTOS ===
${(d.top_emprestimos || []).map((r: any, i: number) => `${i + 1}. ${r.nome}: R$ ${(r.valor / 1000).toFixed(0)}K`).join("\n") || "Nenhum"}

=== TOP 10 MAIORES CUSTOS ===
${(d.top_custos || []).slice(0, 10).map((c: any, i: number) => `${i + 1}. ${c.nome}: R$ ${(c.valor / 1000).toFixed(0)}K`).join("\n") || "Sem dados"}

=== GRUPOS DE CUSTO ===
${(d.grupos_custo || []).map((g: any) => `${g.nome}: R$ ${(g.total / 1000).toFixed(0)}K`).join("\n") || "Sem dados"}

=== DRE MENSAL ===
${(d.dre_mensal || []).slice(-6).map((m: any) => `${m.mesLabel || m.mes}: Receita R$${((m.receita || 0) / 1000).toFixed(0)}K | Custos R$${((m.custos_diretos || 0) / 1000).toFixed(0)}K | Desp.Adm R$${((m.despesas_adm || 0) / 1000).toFixed(0)}K | Resultado R$${((m.lucro_final || 0) / 1000).toFixed(0)}K`).join("\n") || "Sem dados"}

=== PLANO DE AÇÃO ===
${plano_acao && plano_acao.length > 0 ? plano_acao.map((a: any) => `- [${a.status}] ${a.acao} (Resp: ${a.responsavel || "N/D"}, Prazo: ${a.prazo || "N/D"}, Prioridade: ${a.prioridade})`).join("\n") : "Nenhuma ação cadastrada"}

=== CONTEXTO DO EMPRESÁRIO ===
${contexto?.problemas ? "Problemas: " + contexto.problemas : ""}
${contexto?.mudancas ? "Mudanças: " + contexto.mudancas : ""}
${contexto?.decisoes ? "Decisões pendentes: " + contexto.decisoes : ""}
${contexto?.oportunidades ? "Oportunidades: " + contexto.oportunidades : ""}
${contexto?.metas ? "Metas: " + contexto.metas : ""}

=== GERE O RELATÓRIO COM ESTAS 8 SEÇÕES ===

## 1. RESUMO EXECUTIVO
3-4 parágrafos: Visão geral da situação financeira, principais indicadores, tendência.

## 2. PONTOS CRÍTICOS ⚠
Problemas URGENTES que precisam de ação imediata. Seja direto e específico com números.

## 3. PONTOS DE ATENÇÃO ⚡
Problemas que não são urgentes mas precisam monitoramento.

## 4. OPORTUNIDADES ✦
Oportunidades identificadas nos dados para melhorar resultados.

## 5. ANÁLISE DE DESPESAS
Quais custos são excessivos? Onde há oportunidade de redução? Seja específico com números.

## 6. ANÁLISE DE RECEITAS
Quais linhas de receita são as mais fortes? Quais estão fracas? Concentração de receita é um risco?

## 7. RECOMENDAÇÕES ESTRATÉGICAS
5-7 ações concretas com prazo e impacto estimado.

## 8. CARTA AO SÓCIO
Uma carta pessoal e direta ao empresário, como um conselheiro de confiança. Fale a verdade com respeito. Se a empresa está em dificuldade, diga claramente. Se está indo bem, reconheça. Termine com motivação e próximos passos concretos.

Use linguagem profissional mas acessível. Cite números específicos dos dados. Seja DIRETO e HONESTO — o empresário precisa da verdade, não de amenidades.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();

    if (claudeData.error) {
      return NextResponse.json({ error: `Erro Claude API: ${claudeData.error.message}` }, { status: 500 });
    }

    const reportText = claudeData.content?.map((c: any) => c.text || "").join("") || "Erro ao gerar relatório";

    const response = NextResponse.json({
      success: true,
      report: reportText,
      generated_at: new Date().toISOString(),
      model: "claude-sonnet-4",
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
