import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const fmtR = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

export async function POST(req: NextRequest) {
  try {
    const { pergunta, company_ids, historico } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "API key não configurada" }, { status: 500 });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const compIds = company_ids || [];

    // ══════════════════════════════════════
    // COLETA DE CONTEXTO — DADOS DA EMPRESA
    // ══════════════════════════════════════

    // 1. Companies info
    const { data: companies } = await supabase.from("companies").select("*").in("id", compIds);
    const compInfo = (companies || []).map(c =>
      `${c.nome_fantasia || c.razao_social} | CNPJ: ${c.cnpj || "N/I"} | ${c.cidade_estado || ""} | Setor: ${c.setor || "N/I"} | ${c.num_colaboradores || "N/I"} colaboradores | Regime: ${c.regime_tributario || "N/I"}`
    ).join("\n");

    // 2. Financial summary from Omie
    const { data: imports } = await supabase.from("omie_imports").select("import_type,import_data").in("company_id", compIds);
    let totalRec = 0, totalDesp = 0, totalCli = 0;
    const recCats: Record<string, number> = {};
    const despCats: Record<string, number> = {};

    if (imports) {
      for (const imp of imports) {
        if (imp.import_type === "clientes") {
          const cls = imp.import_data?.clientes_cadastro || [];
          if (Array.isArray(cls)) totalCli += cls.length;
        }
        if (imp.import_type === "contas_receber") {
          const regs = imp.import_data?.conta_receber_cadastro || [];
          if (Array.isArray(regs)) {
            for (const r of regs) {
              const v = Number(r.valor_documento) || 0;
              const desc = r.descricao_categoria || r.codigo_categoria || "sem_cat";
              totalRec += v;
              recCats[desc] = (recCats[desc] || 0) + v;
            }
          }
        }
        if (imp.import_type === "contas_pagar") {
          const regs = imp.import_data?.conta_pagar_cadastro || [];
          if (Array.isArray(regs)) {
            for (const r of regs) {
              const v = Number(r.valor_documento) || 0;
              const desc = r.descricao_categoria || r.codigo_categoria || "sem_cat";
              totalDesp += v;
              despCats[desc] = (despCats[desc] || 0) + v;
            }
          }
        }
      }
    }

    const topRec = Object.entries(recCats).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topDesp = Object.entries(despCats).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // 3. Balance sheet
    const { data: bpData } = await supabase.from("balanco_patrimonial").select("*").in("company_id", compIds);
    let bpSummary = "Balanço não preenchido.";
    if (bpData && bpData.length > 0) {
      const totals: Record<string, number> = {};
      for (const item of bpData) {
        const g = item.grupo || "";
        totals[g] = (totals[g] || 0) + Number(item.valor || 0);
      }
      bpSummary = Object.entries(totals).map(([g, v]) => `${g}: ${fmtR(v)}`).join(" | ");
    }

    // 4. Financiamentos
    const { data: finData } = await supabase.from("financiamentos").select("*").in("company_id", compIds);
    let finSummary = "Sem financiamentos.";
    if (finData && finData.length > 0) {
      const totalDiv = finData.reduce((s, f) => s + Number(f.saldo_devedor || 0), 0);
      finSummary = `${finData.length} financiamentos | Dívida total: ${fmtR(totalDiv)} | ${finData.map(f => `${f.banco}: ${fmtR(Number(f.saldo_devedor))} (${f.taxa_mensal}% a.m.)`).join(" | ")}`;
    }

    // 5. Business lines
    const { data: blData } = await supabase.from("business_line_config").select("*").in("company_id", compIds).eq("ativo", true);
    let blSummary = "Linhas não configuradas.";
    if (blData && blData.length > 0) {
      blSummary = blData.map(bl => `${bl.nome}: ${bl.headcount || 0} pessoas`).join(" | ");
    }

    // 6. System features context
    const systemContext = `
FUNCIONALIDADES DO SISTEMA PS GESTÃO:
- Painel Geral: KPIs consolidados, gráficos de receita vs despesa, alertas
- Negócios: Linhas de receita com drill-down por lançamento (data, cliente, doc, NF, status, valor)
- Resultado: DRE completo com mapa de custos em 13 grupos, orçado vs realizado
- Balanço: Ativo Circulante/Não Circulante, Passivo, PL + Financiamentos detalhados
- Indicadores: 25 indicadores fundamentalistas (PE, ROE, ROA, ROIC, Liquidez, Endividamento, Eficiência)
- Financeiro: Gráficos mensais + Fluxo de Caixa diário (7/15/30/60/90 dias)
- Relatório V19: 18 slides executivos gerados por IA nível Conselho
- Orçamento: Real vs Orçado por categoria com desvio R$ e %
- Rateio: Custos por linha de negócio + custos sede rateados
- Ficha Técnica: Composição de custo por m² (50 fichas, 35 materiais base)
- BPO Automação: Classificação automática de lançamentos por IA
- Alertas: Detecta lançamentos sem categoria, classificação incorreta, inadimplência
- Sugestões: Canal para usuários sugerirem melhorias
- Filtro: Hoje, Semana, Mês, Trimestre, Semestre, Ano, Período customizado
- 7 níveis de acesso: admin, sócio, financeiro, comercial, operacional, consultor, visualizador

FONTE DOS DADOS:
- Dados financeiros vêm do Omie ERP via API (contas a pagar, contas a receber, clientes)
- Dados são importados e armazenados no Supabase
- O sistema processa e classifica automaticamente
- Balanço e Financiamentos são preenchidos manualmente pelo consultor
- Orçamento é preenchido pelo gestor financeiro
`;

    // ══════════════════════════════════════
    // PROMPT DO AGENTE
    // ══════════════════════════════════════

    const messages: any[] = [];

    // Add history
    if (historico && Array.isArray(historico)) {
      for (const h of historico.slice(-6)) {
        messages.push({ role: h.role, content: h.content });
      }
    }

    messages.push({ role: "user", content: pergunta });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: `Você é o PS, o Consultor Digital da PS Gestão e Capital. Você está integrado ao ERP como assistente inteligente.

REGRAS:
- Responda sempre em português brasileiro, de forma clara e direta.
- Use os dados da empresa para responder com precisão.
- Se não tiver o dado exato, diga onde o usuário pode encontrar no sistema.
- Seja proativo: sugira análises e ações baseadas nos dados.
- Formato: use negrito para destaques, listas com • para clareza.
- Seja conciso: máximo 300 palavras por resposta.
- Assine como "PS — Seu Consultor Digital" no final.

${systemContext}

DADOS DA EMPRESA:
${compInfo}

RESUMO FINANCEIRO:
Receita Total: ${fmtR(totalRec)}
Despesa Total: ${fmtR(totalDesp)}
Resultado: ${fmtR(totalRec - totalDesp)} (Margem: ${totalRec > 0 ? ((totalRec - totalDesp) / totalRec * 100).toFixed(1) : 0}%)
Clientes: ${totalCli}

TOP 10 RECEITAS:
${topRec.map(([n, v]) => `${n}: ${fmtR(v)}`).join("\n")}

TOP 10 DESPESAS:
${topDesp.map(([n, v]) => `${n}: ${fmtR(v)}`).join("\n")}

BALANÇO: ${bpSummary}
DÍVIDA: ${finSummary}
LINHAS DE NEGÓCIO: ${blSummary}`,
        messages,
      }),
    });

    const data = await response.json();
    const resposta = data.content?.map((c: any) => c.text || "").join("") || "Desculpe, não consegui processar sua pergunta.";

    return NextResponse.json({ success: true, resposta });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
