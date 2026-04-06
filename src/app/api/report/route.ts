import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { company_ids, periodo_inicio, periodo_fim, empresa_nome } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada. Adicione nas Environment Variables do Vercel." }, { status: 500 });
    }

    // 1. Get financial data from process API
    const processRes = await fetch(`${req.nextUrl.origin}/api/omie/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_ids, periodo_inicio, periodo_fim }),
    });
    const processData = await processRes.json();
    if (!processData.success) {
      return NextResponse.json({ error: "Erro ao carregar dados financeiros" }, { status: 500 });
    }
    const d = processData.data;

    // 2. Get plano de ação
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: acoes } = await supabase.from("plano_acao")
      .select("*")
      .in("company_id", company_ids || [])
      .order("created_at", { ascending: false });

    // 3. Get contexto humano
    const { data: contextoData } = await supabase.from("reports")
      .select("report_data")
      .in("company_id", company_ids || [])
      .eq("report_type", "contexto_humano")
      .order("created_at", { ascending: false })
      .limit(1);
    const contexto = contextoData?.[0]?.report_data || {};

    // 4. Build prompt
    const prompt = `Você é um consultor sênior de gestão empresarial com 26 anos de experiência, especialista em PMEs brasileiras. Analise os dados financeiros reais desta empresa e gere um relatório executivo completo.

EMPRESA: ${empresa_nome || "Grupo Empresarial"}
PERÍODO: ${periodo_inicio} a ${periodo_fim}

=== DADOS FINANCEIROS REAIS (do sistema Omie) ===
Receita Operacional Total: R$ ${((d.total_rec_operacional || d.total_receitas) / 1000).toFixed(0)}K
Empréstimos/Financiamentos Recebidos: R$ ${((d.total_emprestimos || 0) / 1000).toFixed(0)}K
Despesas Totais: R$ ${(d.total_despesas / 1000).toFixed(0)}K
Resultado Operacional: R$ ${(d.resultado_periodo / 1000).toFixed(0)}K
Margem: ${d.margem}%
Clientes cadastrados: ${d.total_clientes}
Empresas no grupo: ${d.num_empresas}

=== TOP 10 RECEITAS OPERACIONAIS ===
${(d.top_receitas_operacionais || []).map((r: any, i: number) => `${i + 1}. ${r.nome}: R$ ${(r.valor / 1000).toFixed(0)}K`).join("\n")}

=== TOP 10 EMPRÉSTIMOS/FINANCIAMENTOS ===
${(d.top_emprestimos || []).map((r: any, i: number) => `${i + 1}. ${r.nome}: R$ ${(r.valor / 1000).toFixed(0)}K`).join("\n") || "Nenhum"}

=== TOP 10 MAIORES CUSTOS ===
${(d.top_custos || []).slice(0, 10).map((c: any, i: number) => `${i + 1}. ${c.nome}: R$ ${(c.valor / 1000).toFixed(0)}K`).join("\n")}

=== GRUPOS DE CUSTO ===
${(d.grupos_custo || []).map((g: any) => `${g.nome}: R$ ${(g.total / 1000).toFixed(0)}K`).join("\n")}

=== DRE MENSAL (últimos meses) ===
${(d.dre_mensal || []).slice(-6).map((m: any) => `${m.mesLabel}: Receita R$${(m.receita / 1000).toFixed(0)}K | Custos R$${(m.custos_diretos / 1000).toFixed(0)}K | Desp.Adm R$${(m.despesas_adm / 1000).toFixed(0)}K | Resultado R$${(m.lucro_final / 1000).toFixed(0)}K`).join("\n")}

=== PLANO DE AÇÃO EM EXECUÇÃO ===
${acoes && acoes.length > 0 ? acoes.map((a: any) => `- [${a.status}] ${a.acao} (Resp: ${a.responsavel || "N/D"}, Prazo: ${a.prazo || "N/D"}, Prioridade: ${a.prioridade})`).join("\n") : "Nenhuma ação cadastrada"}

=== CONTEXTO DO EMPRESÁRIO ===
${contexto.problemas ? "Problemas: " + contexto.problemas : ""}
${contexto.mudancas ? "Mudanças: " + contexto.mudancas : ""}
${contexto.decisoes ? "Decisões pendentes: " + contexto.decisoes : ""}
${contexto.oportunidades ? "Oportunidades: " + contexto.oportunidades : ""}
${contexto.metas ? "Metas: " + contexto.metas : ""}

=== GERE O RELATÓRIO COM ESTAS SEÇÕES ===

1. **RESUMO EXECUTIVO** (3-4 parágrafos): Visão geral da situação financeira, principais indicadores, tendência.

2. **PONTOS CRÍTICOS** (⚠): Liste os problemas URGENTES que precisam de ação imediata. Seja direto e específico com números.

3. **PONTOS DE ATENÇÃO** (⚡): Problemas que não são urgentes mas precisam monitoramento.

4. **OPORTUNIDADES** (✦): Oportunidades identificadas nos dados para melhorar resultados.

5. **ANÁLISE DE DESPESAS**: Quais custos são excessivos? Onde há oportunidade de redução? Seja específico.

6. **ANÁLISE DE RECEITAS**: Quais linhas de receita são as mais fortes? Quais estão fracas? Concentração de receita é um risco?

7. **RECOMENDAÇÕES ESTRATÉGICAS**: 5-7 ações concretas com prazo e impacto estimado.

8. **CARTA AO SÓCIO**: Uma carta pessoal e direta ao empresário, como um conselheiro de confiança. Fale a verdade com respeito. Se a empresa está em dificuldade, diga claramente. Se está indo bem, reconheça. Termine com motivação e próximos passos concretos.

Use linguagem profissional mas acessível. Cite números específicos dos dados. Seja DIRETO e HONESTO — o empresário precisa da verdade, não de amenidades.`;

    // 5. Call Claude API
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

    // 6. Parse sections
    const sections = reportText.split(/\n(?=\d+\.\s\*\*)/);

    const response = NextResponse.json({
      success: true,
      report: reportText,
      sections: sections,
      generated_at: new Date().toISOString(),
      model: "claude-sonnet-4",
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
