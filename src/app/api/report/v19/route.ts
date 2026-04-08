import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo';
const fmtR = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

export async function POST(req: NextRequest) {
  try {
    const { company_ids, periodo_inicio, periodo_fim, empresa_nome, contexto_humano } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada" }, { status: 500 });
    if (!supabaseKey) return NextResponse.json({ error: "SUPABASE key não configurada. Adicione SUPABASE_SERVICE_ROLE_KEY no Vercel." }, { status: 500 });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const compIds = company_ids || [];
    if (compIds.length === 0) return NextResponse.json({ error: "Nenhuma empresa selecionada" }, { status: 400 });

    // ══════════════════════════════════════════
    // COLETA DE DADOS — TODOS OS BLOCOS
    // ══════════════════════════════════════════

    // 1. Companies info
    const { data: companies } = await supabase.from("companies").select("*").in("id", compIds);
    const compInfo = (companies || []).map(c => `${c.nome_fantasia || c.razao_social} | CNPJ: ${c.cnpj || "N/I"} | ${c.cidade_estado || ""} | ${c.setor || ""} | ${c.num_colaboradores || "N/I"} colaboradores | Regime: ${c.regime_tributario || "N/I"}`).join("\n");

    // 2. Omie financial data
    const { data: imports } = await supabase.from("omie_imports").select("*").in("company_id", compIds);
    let totalRec = 0, totalDesp = 0, totalEmp = 0;
    const recCats: Record<string, number> = {};
    const despCats: Record<string, number> = {};
    const clienteNomes: Record<string, string> = {};
    let totalClientes = 0;

    if (imports) {
      for (const imp of imports) {
        if (imp.import_type === "clientes") {
          const cls = imp.import_data?.clientes_cadastro || [];
          if (Array.isArray(cls)) {
            totalClientes += cls.length;
            for (const c of cls) {
              const cod = c.codigo_cliente_omie || c.codigo_cliente || c.codigo;
              clienteNomes[String(cod)] = c.nome_fantasia || c.razao_social || c.nome || "";
            }
          }
        }
        if (imp.import_type === "contas_receber") {
          const regs = imp.import_data?.conta_receber_cadastro || [];
          if (Array.isArray(regs)) {
            for (const r of regs) {
              const v = Number(r.valor_documento) || 0;
              const cat = r.codigo_categoria || "sem_cat";
              const desc = r.descricao_categoria || cat;
              if (cat.startsWith("1.")) { totalRec += v; recCats[desc] = (recCats[desc] || 0) + v; }
              else if (cat.startsWith("2.") || cat.startsWith("4.") || cat.startsWith("5.")) { totalEmp += v; }
              else { totalRec += v; recCats[desc] = (recCats[desc] || 0) + v; }
            }
          }
        }
        if (imp.import_type === "contas_pagar") {
          const regs = imp.import_data?.conta_pagar_cadastro || [];
          if (Array.isArray(regs)) {
            for (const r of regs) {
              const v = Number(r.valor_documento) || 0;
              const cat = r.codigo_categoria || "sem_cat";
              const desc = r.descricao_categoria || cat;
              totalDesp += v;
              despCats[desc] = (despCats[desc] || 0) + v;
            }
          }
        }
      }
    }

    const resultado = totalRec - totalDesp;
    const margem = totalRec > 0 ? (resultado / totalRec * 100).toFixed(1) : "0";
    const topRec = Object.entries(recCats).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const topDesp = Object.entries(despCats).sort((a, b) => b[1] - a[1]).slice(0, 15);

    // 3. Balance sheet
    const { data: bpData } = await supabase.from("balanco_patrimonial").select("*").in("company_id", compIds);
    let bpText = "Não preenchido — dados insuficientes para Balanço.";
    if (bpData && bpData.length > 0) {
      const grupos: Record<string, { nome: string; valor: number }[]> = {};
      for (const item of bpData) {
        const g = `${item.lado?.toUpperCase()} — ${item.grupo}`;
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push({ nome: item.nome, valor: Number(item.valor) || 0 });
      }
      bpText = Object.entries(grupos).map(([g, itens]) => {
        const total = itens.reduce((s, i) => s + i.valor, 0);
        return `${g} (Total: ${fmtR(total)}):\n${itens.filter(i => i.valor !== 0).map(i => `  ${i.nome}: ${fmtR(i.valor)}`).join("\n")}`;
      }).join("\n\n");
    }

    // 4. Financiamentos
    const { data: finData } = await supabase.from("financiamentos").select("*").in("company_id", compIds);
    let finText = "Nenhum financiamento cadastrado.";
    if (finData && finData.length > 0) {
      finText = finData.map(f => `${f.banco} | ${f.tipo} | Original: ${fmtR(Number(f.valor_original))} | Saldo: ${fmtR(Number(f.saldo_devedor))} | Taxa: ${f.taxa_mensal}% a.m. | Parcelas: ${f.parcelas_restantes}/${f.parcelas} | Venc: ${f.vencimento} | Garantia: ${f.garantia || "Sem"}`).join("\n");
    }

    // 5. Business lines (rateio)
    const { data: blData } = await supabase.from("business_line_config").select("*").in("company_id", compIds).eq("ativo", true);
    let blText = "Linhas de negócio não configuradas.";
    if (blData && blData.length > 0) {
      const blIds = blData.map(b => b.id);
      const { data: blRec } = await supabase.from("business_line_receitas").select("*").in("business_line_id", blIds);
      const { data: blCust } = await supabase.from("business_line_custos").select("*").in("business_line_id", blIds);
      blText = blData.map(bl => {
        const rec = (blRec || []).filter(r => r.business_line_id === bl.id).reduce((s: number, r: any) => s + Number(r.valor), 0);
        const cust = (blCust || []).filter(c => c.business_line_id === bl.id).reduce((s: number, c: any) => s + Number(c.valor), 0);
        return `${bl.nome} | CNPJ: ${bl.cnpj_origem || "N/I"} | HC: ${bl.headcount || 0} | Receita: ${fmtR(rec)} | Custos Diretos: ${fmtR(cust)} | Margem Direta: ${fmtR(rec - cust)} (${rec > 0 ? ((rec - cust) / rec * 100).toFixed(1) : 0}%)`;
      }).join("\n");
    }

    // 6. Custos sede
    const { data: sedeData } = await supabase.from("custos_sede").select("*");
    let sedeText = "Custos da sede não cadastrados.";
    if (sedeData && sedeData.length > 0) {
      const totalSede = sedeData.reduce((s, c) => s + Number(c.valor), 0);
      sedeText = sedeData.map(c => `${c.nome}: ${fmtR(Number(c.valor))}/mês`).join("\n") + `\nTOTAL SEDE: ${fmtR(totalSede)}/mês`;
    }

    // 7. Contexto humano
    const { data: ctxData } = await supabase.from("ai_reports").select("report_content").eq("report_type", "contexto_humano").order("created_at", { ascending: false }).limit(1);
    let ctxText = contexto_humano || "";
    if (ctxData && ctxData.length > 0 && ctxData[0].report_content) {
      ctxText = typeof ctxData[0].report_content === "string" ? ctxData[0].report_content : JSON.stringify(ctxData[0].report_content);
    }

    // ══════════════════════════════════════════
    // MONTAGEM DOS BLOCOS V19
    // ══════════════════════════════════════════

    const blocos = `
[BLOCO 0] IDENTIFICAÇÃO E CONTEXTO
${compInfo}
Período: ${periodo_inicio} a ${periodo_fim}
Clientes cadastrados: ${totalClientes}
Empresas no grupo: ${compIds.length}

CONTEXTO DO EMPRESÁRIO:
${ctxText || "Não preenchido."}

[BLOCO 1] BALANÇO PATRIMONIAL GERENCIAL
${bpText}

[BLOCO 2] DRE DIVISIONAL (LINHAS DE NEGÓCIO)
${blText}

[BLOCO 3] DRE CONSOLIDADO — SEDE E RETAGUARDA
Receita Operacional Total: ${fmtR(totalRec)}
Empréstimos/Financiamentos: ${fmtR(totalEmp)}
Despesas Totais: ${fmtR(totalDesp)}
Resultado Operacional: ${fmtR(resultado)}
Margem: ${margem}%

TOP 15 RECEITAS POR CATEGORIA:
${topRec.map(([n, v], i) => `${i + 1}. ${n}: ${fmtR(v)}`).join("\n")}

TOP 15 DESPESAS POR CATEGORIA:
${topDesp.map(([n, v], i) => `${i + 1}. ${n}: ${fmtR(v)}`).join("\n")}

CUSTOS DA SEDE (RATEIO):
${sedeText}

[BLOCO 4] FLUXO DE CAIXA
Dados de contas a pagar e receber disponíveis no sistema.
Burn Rate estimado: ${fmtR(totalDesp / 30)}/dia

[BLOCO 5] CAPITAL DE GIRO E CICLO FINANCEIRO
Cálculos derivados do DRE + Balanço. Dados disponíveis para cálculo automático.

[BLOCO 6] INTELIGÊNCIA COMERCIAL
Clientes cadastrados: ${totalClientes}
Receita por categoria disponível acima.

[BLOCO 7] GESTÃO DE PESSOAS
${(companies || []).map(c => `${c.nome_fantasia}: ${c.num_colaboradores || "N/I"} colaboradores`).join("\n")}
${blData && blData.length > 0 ? blData.map(bl => `${bl.nome}: ${bl.headcount || 0} pessoas | Responsável: ${bl.responsavel || "N/I"}`).join("\n") : ""}

[BLOCO 8] METAS E ORÇAMENTO
Dados de orçamento não preenchidos — utilizar o DRE real como base e projetar +10% para meta.

[BLOCO 9] ESTRUTURA DE CAPITAL E DÍVIDA
${finText}
Dívida Bruta: ${fmtR(finData ? finData.reduce((s, f) => s + Number(f.saldo_devedor), 0) : 0)}

[BLOCO 10-14] GOVERNANÇA, ESG, DIGITAL, RISCO
Utilizar contexto do empresário acima para análise qualitativa.
Dados específicos devem ser complementados pelo assessor.

[BLOCO 15] VALUATION E GERAÇÃO DE VALOR
EBITDA estimado (mensal): ${fmtR(resultado + (totalDesp * 0.03))}
Base para cálculo de múltiplos setoriais.
`;

    // ══════════════════════════════════════════
    // PROMPT V19 COMPLETO + DADOS → CLAUDE
    // ══════════════════════════════════════════

    const systemPrompt = `PROMPT MESTRE V19 — CEO EDITION — PS GESTÃO E CAPITAL
PAINEL DE INTELIGÊNCIA EMPRESARIAL COMPLETA — 6 SLIDES EXECUTIVOS

[PROTOCOLO 0 — ISOLAMENTO E IDENTIDADE]
Dados válidos: EXCLUSIVAMENTE os BLOCOS fornecidos abaixo.
Você é o Conselheiro de Administração e CFO Sênior da empresa analisada.
25 anos de experiência em reestruturação e governança de PMEs no Brasil.
Cada parecer deve soar como a voz de quem tem assento no Conselho.

[PROTOCOLO 1 — TOM EXECUTIVO]
Tom: formal, técnico, direto, corajoso. Sem eufemismos.
PROIBIDO: termos em inglês sem tradução, gírias, frases vagas.
Se o dado é ruim, diga que é ruim. Se é crítico, chame de crítico.
Use o glossário: Break-even=Ponto de Equilíbrio, Valuation=Avaliação de Mercado, Markup=Fator de Formação de Preço, Compliance=Conformidade, Churn=Evasão de Clientes, Turnover=Rotatividade.

[PROTOCOLO 2 — PRECISÃO MATEMÁTICA]
Receita Bruta = APENAS faturamento operacional.
EBITDA = Lucro + Juros + Depreciação + Amortização.
Capital de Giro = Ativo Circulante - Passivo Circulante.
ROIC = EBIT(1-t) / (PL + Dívida Líquida). Se ROIC > WACC: cria valor.
Nunca interpolar dados ausentes sem sinalizar.

[PROTOCOLO 3 — CRUZAMENTOS OBRIGATÓRIOS]
DRE vs. Balanço, DRE vs. Fluxo de Caixa, Qualitativo vs. Quantitativo.

[PROTOCOLO 4 — FORMATAÇÃO]
Cada slide: --- [SLIDE X — TÍTULO] ---
Use emojis de status: 🟢 🟡 🔴
Tabelas em Markdown. Mínimo 4 linhas de análise real por parecer.
Cada ação deve ter: prazo, responsável e impacto em R$.

GERE 6 SLIDES EXECUTIVOS (máximo 500 palavras cada):
1. Painel Executivo CEO (KPIs, resultado, margem)
2. DRE Analítico (receitas, despesas, EBITDA)
3. Capital de Giro e Fluxo de Caixa
4. Pareto de Custos (top 10 maiores despesas)
5. Plano de Ação (10 ações com prazo e impacto R$)
6. Carta ao Acionista + Metas 90 Dias

REGRA FINAL: Seja conciso. Se dado ausente, sinalize. Assine como "PS — Conselheiro Digital".`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: "user", content: `DADOS DA EMPRESA — GERE 6 SLIDES EXECUTIVOS AGORA:\n\n${blocos}` }],
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      return NextResponse.json({ error: `Erro API Claude: ${data.error?.message || JSON.stringify(data.error)}` }, { status: 500 });
    }

    const reportText = data.content?.map((c: any) => c.text || "").join("") || "Erro ao gerar relatório.";

    return NextResponse.json({ success: true, report: reportText, blocos_usados: blocos.length });
  } catch (error: any) {
    return NextResponse.json({ error: `Erro no relatório: ${error.message}` }, { status: 500 });
  }
}
