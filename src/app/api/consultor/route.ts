import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://horsymhsinqcimflrtjo.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function fmtR(v: number) { return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`; }

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada" }, { status: 500 });

    const formData = await req.formData();
    const question = formData.get("question") as string;
    const companyId = formData.get("company_id") as string;
    const file = formData.get("file") as File | null;

    if (!question) return NextResponse.json({ error: "Pergunta obrigatória" }, { status: 400 });
    if (!companyId) return NextResponse.json({ error: "Empresa não selecionada" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ═══ LOAD ALL COMPANY DATA ═══

    // 1. Company info
    const { data: company } = await supabase.from("companies").select("*").eq("id", companyId).single();
    const compName = company?.nome_fantasia || company?.razao_social || "Empresa";

    // 2. Financial imports (contas a pagar/receber)
    const { data: imports } = await supabase.from("omie_imports").select("import_type,import_data,record_count").eq("company_id", companyId);

    let totalRec = 0, totalDesp = 0, totalVencido = 0;
    const topCustos: { nome: string; valor: number }[] = [];
    const topReceitas: { nome: string; valor: number }[] = [];
    const financPendentes: any[] = [];
    const recVencidos: any[] = [];

    if (imports) {
      // Contas a receber
      for (const imp of imports.filter(i => i.import_type === "contas_receber")) {
        const regs = imp.import_data?.conta_receber_cadastro || [];
        if (!Array.isArray(regs)) continue;
        for (const r of regs) {
          const v = Number(r.valor_documento) || 0;
          totalRec += v;
          const status = (r.status_titulo || "").toUpperCase();
          if (status === "VENCIDO" || status === "ATRASADO") {
            totalVencido += v;
            recVencidos.push({ valor: v, cliente: r.codigo_cliente_fornecedor, venc: r.data_vencimento });
          }
        }
      }
      // Contas a pagar
      const catTotals: Record<string, number> = {};
      for (const imp of imports.filter(i => i.import_type === "contas_pagar")) {
        const regs = imp.import_data?.conta_pagar_cadastro || [];
        if (!Array.isArray(regs)) continue;
        for (const r of regs) {
          const v = Number(r.valor_documento) || 0;
          totalDesp += v;
          const cat = r.descricao_categoria || r.codigo_categoria || "outros";
          catTotals[cat] = (catTotals[cat] || 0) + v;
          const status = (r.status_titulo || "").toUpperCase();
          if (status !== "PAGO" && status !== "LIQUIDADO" && status !== "CANCELADO") {
            financPendentes.push({ valor: v, forn: r.observacao || r.codigo_cliente_fornecedor, venc: r.data_vencimento, cat });
          }
        }
      }
      Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([nome, valor]) => topCustos.push({ nome, valor }));
    }

    // 3. Balanço patrimonial
    const { data: bpData } = await supabase.from("balanco_patrimonial").select("*").eq("company_id", companyId);
    let bpText = "Sem dados.";
    if (bpData && bpData.length > 0) {
      bpText = bpData.map(b => `${b.lado} | ${b.grupo} | ${b.nome}: ${fmtR(b.valor || 0)}`).join("\n");
    }

    // 4. Financiamentos existentes
    const { data: finData } = await supabase.from("financiamentos").select("*").eq("company_id", companyId);
    let finText = "Sem financiamentos cadastrados.";
    if (finData && finData.length > 0) {
      finText = finData.map(f => `${f.banco || "Banco"} | ${f.tipo || ""} | Original: ${fmtR(f.valor_original || 0)} | Saldo: ${fmtR(f.saldo_devedor || 0)} | Taxa: ${f.taxa_mensal || 0}% a.m. | Parcela: ${fmtR(f.valor_parcela || 0)} | Restantes: ${f.parcelas_restantes || "?"} | Garantia: ${f.garantia || "nenhuma"}`).join("\n");
    }

    // 5. Linhas de negócio
    const { data: blData } = await supabase.from("business_lines").select("*").eq("company_id", companyId);
    let blText = "Sem linhas de negócio.";
    if (blData && blData.length > 0) {
      blText = blData.map(b => `${b.nome} | ${b.tipo} | ${b.pessoas} pessoas`).join("\n");
    }

    // 6. Orçamento
    const { data: orcData } = await supabase.from("orcamento").select("*").eq("company_id", companyId);
    let orcText = "Sem orçamento.";
    if (orcData && orcData.length > 0) {
      const totalOrc = orcData.reduce((s: number, o: any) => s + (Number(o.valor_orcado) || 0), 0);
      orcText = `Total orçado: ${fmtR(totalOrc)}\n` + orcData.slice(0, 15).map(o => `${o.categoria}: Orçado ${fmtR(o.valor_orcado || 0)} | Real ${fmtR(o.valor_real || 0)}`).join("\n");
    }

    // 7. Contexto humano
    const { data: ctxData } = await supabase.from("ai_reports").select("report_content").eq("company_id", companyId).eq("report_type", "contexto_humano").order("created_at", { ascending: false }).limit(1);
    let ctxText = "";
    if (ctxData && ctxData.length > 0) {
      ctxText = typeof ctxData[0].report_content === "string" ? ctxData[0].report_content : JSON.stringify(ctxData[0].report_content);
    }

    // 8. Fluxo de caixa resumo
    const resultado = totalRec - totalDesp;
    const margem = totalRec > 0 ? ((resultado / totalRec) * 100).toFixed(1) : "0";

    // ═══ PROCESS UPLOADED FILE ═══
    let fileContent = "";
    let fileType = "";
    if (file && file.size > 0) {
      fileType = file.type;
      if (fileType.includes("pdf")) {
        // Convert PDF to base64 for Claude vision
        const buffer = await file.arrayBuffer();
        fileContent = `[PDF ENVIADO: ${file.name}, ${(file.size / 1024).toFixed(0)}KB — conteúdo será analisado via visão]`;
      } else if (fileType.includes("image")) {
        fileContent = `[IMAGEM ENVIADA: ${file.name}, ${(file.size / 1024).toFixed(0)}KB]`;
      } else {
        // Text/CSV/other — read as text
        try {
          fileContent = await file.text();
          if (fileContent.length > 15000) fileContent = fileContent.substring(0, 15000) + "\n...[truncado]";
        } catch {
          fileContent = `[Arquivo: ${file.name}, ${(file.size / 1024).toFixed(0)}KB — não foi possível ler como texto]`;
        }
      }
    }

    // ═══ BUILD CONTEXT ═══
    const contextBlock = `
═══ DADOS REAIS DA EMPRESA: ${compName} ═══

📊 RESUMO FINANCEIRO:
Receita total: ${fmtR(totalRec)}
Despesa total: ${fmtR(totalDesp)}
Resultado: ${fmtR(resultado)} (Margem: ${margem}%)
Inadimplência: ${fmtR(totalVencido)} (${recVencidos.length} títulos vencidos)
Contas a pagar pendentes: ${financPendentes.length} títulos

💰 MAIORES CUSTOS:
${topCustos.map((c, i) => `${i + 1}. ${c.nome}: ${fmtR(c.valor)}`).join("\n")}

🏦 FINANCIAMENTOS EXISTENTES:
${finText}

📋 BALANÇO PATRIMONIAL:
${bpText}

📊 ORÇAMENTO:
${orcText}

🏢 LINHAS DE NEGÓCIO:
${blText}

💬 CONTEXTO DO EMPRESÁRIO:
${ctxText || "Não informado."}

${fileContent ? `\n📎 DOCUMENTO ANEXADO:\n${fileContent}` : ""}
`;

    // ═══ BUILD MESSAGES ═══
    const messages: any[] = [];

    // If PDF or image, use vision
    if (file && file.size > 0 && (fileType.includes("pdf") || fileType.includes("image"))) {
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mediaType = fileType.includes("pdf") ? "application/pdf" : fileType;

      messages.push({
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: `${contextBlock}\n\n═══ PERGUNTA DO EMPRESÁRIO ═══\n${question}\n\nAnalise o documento anexado à luz de TODOS os dados financeiros reais acima. Dê uma resposta completa, prática e acionável. Se envolver decisão financeira (financiamento, investimento, venda), calcule cenários com números reais.`,
          },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: `${contextBlock}\n\n═══ PERGUNTA DO EMPRESÁRIO ═══\n${question}\n\nResponda com base nos dados financeiros reais acima. Seja direto, prático e acionável. Se envolver decisão financeira, calcule cenários com números reais da empresa.`,
      });
    }

    // ═══ CALL CLAUDE ═══
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system: `Você é o Conselheiro Financeiro IA da PS Gestão e Capital. Você tem acesso a TODOS os dados financeiros reais da empresa. Responda como um CFO sênior que conhece profundamente a empresa. Seja direto, use números reais, calcule cenários, e sempre dê uma RECOMENDAÇÃO CLARA no final (FAZER / NÃO FAZER / FAZER COM RESSALVAS). Use emojis para organizar e formatação clara.`,
        messages,
      }),
    });

    const data = await response.json();
    if (data.error) return NextResponse.json({ error: `Claude API: ${data.error?.message || JSON.stringify(data.error)}` }, { status: 500 });

    const answer = data.content?.map((c: any) => c.text || "").join("") || "Erro ao processar.";

    return NextResponse.json({
      success: true,
      answer,
      context_used: {
        empresa: compName,
        receitas: fmtR(totalRec),
        despesas: fmtR(totalDesp),
        resultado: fmtR(resultado),
        financiamentos: finData?.length || 0,
        arquivo: file ? file.name : null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: `Erro: ${error.message}` }, { status: 500 });
  }
}
