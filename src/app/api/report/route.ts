import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { company_ids, periodo_inicio, periodo_fim, dados_financeiros } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseKey);
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    // Load plano de ação
    let planoAcao: any[] = [];
    if (company_ids?.length > 0) {
      const { data } = await supabase.from("plano_acao").select("*").in("company_id", company_ids).order("created_at", { ascending: false });
      planoAcao = data || [];
    }

    // Load company info
    let empresas: any[] = [];
    if (company_ids?.length > 0) {
      const { data } = await supabase.from("companies").select("*").in("id", company_ids);
      empresas = data || [];
    }

    const d = dados_financeiros;
    const nomeGrupo = empresas.length > 0 ? (empresas[0].nome_fantasia || empresas[0].razao_social) : "Empresa";

    // Build the prompt
    const prompt = `Você é um consultor financeiro sênior da PS Gestão e Capital, especializado em análise de PMEs brasileiras. Analise os dados financeiros abaixo e gere um relatório executivo completo.

EMPRESA: ${nomeGrupo} (${empresas.length} CNPJ${empresas.length>1?"s":""})
PERÍODO: ${periodo_inicio} a ${periodo_fim}

DADOS FINANCEIROS:
- Receita Operacional: R$ ${((d.total_rec_operacional||d.total_receitas||0)/1000).toFixed(0)}K
- Despesas Totais: R$ ${((d.total_despesas||0)/1000).toFixed(0)}K
- Resultado: R$ ${((d.resultado_periodo||0)/1000).toFixed(0)}K (Margem: ${d.margem||0}%)
- Empréstimos Recebidos: R$ ${((d.total_emprestimos||0)/1000).toFixed(0)}K
- Clientes cadastrados: ${d.total_clientes||0}
- Empresas no grupo: ${d.num_empresas||1}

MAIORES CUSTOS:
${(d.top_custos||[]).slice(0,10).map((c:any,i:number)=>`${i+1}. ${c.nome}: R$ ${(c.valor/1000).toFixed(0)}K`).join("\n")}

MAIORES RECEITAS OPERACIONAIS:
${(d.top_receitas_operacionais||[]).slice(0,10).map((r:any,i:number)=>`${i+1}. ${r.nome}: R$ ${(r.valor/1000).toFixed(0)}K`).join("\n")}

PLANO DE AÇÃO ATUAL (${planoAcao.length} ações):
${planoAcao.length>0?planoAcao.map(a=>`- ${a.acao} (${a.status}, prazo: ${a.prazo||"sem prazo"}, prioridade: ${a.prioridade})`).join("\n"):"Nenhuma ação cadastrada."}

Gere um relatório com as seguintes seções:
1. DIAGNÓSTICO GERAL (2-3 parágrafos): visão geral da saúde financeira
2. PONTOS CRÍTICOS (3-5 itens): problemas que precisam de ação imediata
3. PONTOS DE ATENÇÃO (3-5 itens): riscos que precisam ser monitorados
4. OPORTUNIDADES (3-5 itens): onde a empresa pode melhorar
5. ANÁLISE DO PLANO DE AÇÃO: avalie as ações em andamento, sugira novas
6. PROJEÇÃO: cenário otimista e pessimista para os próximos 6 meses
7. RECOMENDAÇÕES IMEDIATAS: 3 ações prioritárias para esta semana

Seja direto, use números reais, e fale como um consultor experiente falaria com o dono da empresa. Use linguagem acessível, sem jargão técnico excessivo.`;

    let report = "";

    if (anthropicKey) {
      // Real Claude API call
      try {
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const claudeData = await claudeRes.json();
        report = claudeData.content?.[0]?.text || "Erro ao gerar relatório";
      } catch (e: any) {
        report = "Erro na API Claude: " + e.message;
      }
    } else {
      // Generate report without AI (data-driven)
      const resultado = d.resultado_periodo || 0;
      const isNegativo = resultado < 0;
      const margem = parseFloat(d.margem || "0");
      const topCusto = d.top_custos?.[0];
      const topReceita = d.top_receitas_operacionais?.[0];

      report = `# RELATÓRIO EXECUTIVO — ${nomeGrupo}
## Período: ${periodo_inicio} a ${periodo_fim}

---

## 1. DIAGNÓSTICO GERAL

${isNegativo
  ? `A empresa apresenta resultado **NEGATIVO** de R$ ${Math.abs(resultado/1000).toFixed(0)}K no período analisado, com margem de ${margem}%. As despesas totais (R$ ${(d.total_despesas/1000).toFixed(0)}K) superam a receita operacional (R$ ${((d.total_rec_operacional||d.total_receitas)/1000).toFixed(0)}K) em R$ ${Math.abs(resultado/1000).toFixed(0)}K.`
  : `A empresa apresenta resultado **POSITIVO** de R$ ${(resultado/1000).toFixed(0)}K no período, com margem de ${margem}%. A receita operacional (R$ ${((d.total_rec_operacional||d.total_receitas)/1000).toFixed(0)}K) supera as despesas (R$ ${(d.total_despesas/1000).toFixed(0)}K).`}

${d.total_emprestimos > 0 ? `\n**Atenção:** A empresa recebeu R$ ${(d.total_emprestimos/1000).toFixed(0)}K em empréstimos/financiamentos no período. Isso indica dependência de capital de terceiros para manter as operações.` : ""}

O grupo opera com ${d.num_empresas} CNPJ${d.num_empresas>1?"s":""} e ${d.total_clientes} clientes cadastrados.

---

## 2. PONTOS CRÍTICOS

${isNegativo ? `⚠ **Resultado negativo:** A empresa gasta mais do que fatura. Cada mês no negativo consome o patrimônio.` : ""}
${topCusto ? `⚠ **Maior custo:** "${topCusto.nome}" representa R$ ${(topCusto.valor/1000).toFixed(0)}K — avaliar se há espaço para redução.` : ""}
${d.total_emprestimos > d.total_rec_operacional*0.2 ? `⚠ **Dependência de empréstimos:** R$ ${(d.total_emprestimos/1000).toFixed(0)}K em financiamentos — a empresa não se sustenta com a operação.` : ""}
${(d.top_custos||[]).length > 5 ? `⚠ **Custos pulverizados:** ${(d.top_custos||[]).length} categorias de custo identificadas — dificulta o controle e a redução.` : ""}

---

## 3. PONTOS DE ATENÇÃO

${(d.top_custos||[]).slice(0,3).map((c:any)=>`⚡ **${c.nome}:** R$ ${(c.valor/1000).toFixed(0)}K — monitorar tendência mensal.`).join("\n")}
${d.total_clientes > 1000 ? `⚡ **Base de clientes grande (${d.total_clientes}):** verificar concentração de receita — se poucos clientes representam a maior parte do faturamento, há risco.` : ""}

---

## 4. OPORTUNIDADES

${topReceita ? `💡 **${topReceita.nome}** é a maior fonte de receita (R$ ${(topReceita.valor/1000).toFixed(0)}K). Investir em crescimento desta linha.` : ""}
${(d.top_receitas_operacionais||[]).length > 3 ? `💡 **Diversificação:** ${(d.top_receitas_operacionais||[]).length} fontes de receita identificadas. Avaliar quais têm maior margem e focar nelas.` : ""}
💡 **Renegociação de custos:** Os 3 maiores custos somam R$ ${((d.top_custos||[]).slice(0,3).reduce((a:number,c:any)=>a+c.valor,0)/1000).toFixed(0)}K. Uma redução de 10% geraria economia de R$ ${((d.top_custos||[]).slice(0,3).reduce((a:number,c:any)=>a+c.valor,0)/10000).toFixed(0)}K.

---

## 5. ANÁLISE DO PLANO DE AÇÃO

${planoAcao.length > 0
  ? `O plano atual tem ${planoAcao.length} ações cadastradas:\n${planoAcao.map(a=>`- **${a.acao}** — Status: ${a.status}${a.prazo?`, Prazo: ${new Date(a.prazo).toLocaleDateString("pt-BR")}`:""} (${a.prioridade})`).join("\n")}\n\n${planoAcao.filter(a=>a.status==="pendente").length > 0 ? `⚠ Há ${planoAcao.filter(a=>a.status==="pendente").length} ações pendentes que precisam ser iniciadas.` : "✓ Todas as ações estão em andamento ou concluídas."}`
  : "⚠ **Nenhuma ação cadastrada.** É fundamental criar um plano de ação com ações concretas, prazos e responsáveis para reverter o cenário atual. Acesse a aba Plano de Ação na Entrada de Dados."}

---

## 6. PROJEÇÃO (6 MESES)

**Cenário otimista (redução de 15% nos custos + crescimento de 10% na receita):**
- Receita projetada: R$ ${(((d.total_rec_operacional||d.total_receitas)*1.1)/1000).toFixed(0)}K
- Despesas projetadas: R$ ${((d.total_despesas*0.85)/1000).toFixed(0)}K
- Resultado projetado: R$ ${((((d.total_rec_operacional||d.total_receitas)*1.1)-(d.total_despesas*0.85))/1000).toFixed(0)}K

**Cenário pessimista (custos mantidos + queda de 10% na receita):**
- Receita projetada: R$ ${(((d.total_rec_operacional||d.total_receitas)*0.9)/1000).toFixed(0)}K
- Despesas projetadas: R$ ${((d.total_despesas)/1000).toFixed(0)}K
- Resultado projetado: R$ ${((((d.total_rec_operacional||d.total_receitas)*0.9)-d.total_despesas)/1000).toFixed(0)}K

---

## 7. RECOMENDAÇÕES IMEDIATAS

1. **Esta semana:** Revisar os 3 maiores custos e identificar pelo menos 1 oportunidade de redução imediata.
2. **Nos próximos 15 dias:** ${isNegativo ? "Elaborar plano de emergência para reduzir despesas em pelo menos 20%." : "Definir meta de crescimento para a principal linha de receita."}
3. **Nos próximos 30 dias:** ${planoAcao.length === 0 ? "Criar plano de ação com no mínimo 5 ações concretas com responsáveis e prazos." : "Revisar o plano de ação e atualizar o status de todas as ações."}

---
*Relatório gerado pelo PS Gestão e Capital — ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR")}*
${!anthropicKey ? "\n*Para análises mais profundas com IA, adicione a chave da API Claude nas configurações do Vercel (ANTHROPIC_API_KEY).*" : ""}`;
    }

    const response = NextResponse.json({ success: true, report, ai: !!anthropicKey });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
