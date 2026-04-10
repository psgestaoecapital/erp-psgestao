import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://horsymhsinqcimflrtjo.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo';

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

    // 2. Financial imports — com deduplicação e filtro de cancelados
    const { data: rawImports } = await supabase.from("omie_imports").select("import_type,import_data,record_count,imported_at").eq("company_id", companyId);
    
    // DEDUP: manter apenas o mais recente por import_type
    const impMap = new Map<string, any>();
    if (rawImports) for (const imp of rawImports) {
      const existing = impMap.get(imp.import_type);
      if (!existing || new Date(imp.imported_at || 0) > new Date(existing.imported_at || 0)) impMap.set(imp.import_type, imp);
    }
    const imports = Array.from(impMap.values());

    const STATUS_EXCL = new Set(["CANCELADO","CANCELADA","ESTORNADO","ESTORNADA","DEVOLVIDO","DEVOLVIDA","ANULADO","ANULADA"]);

    let totalRec = 0, totalRecOp = 0, totalDesp = 0, totalVencido = 0, totalEmprestimos = 0;
    const topCustos: { nome: string; valor: number }[] = [];
    const topReceitas: { nome: string; valor: number }[] = [];
    const financPendentes: any[] = [];
    const recVencidos: any[] = [];

    if (imports) {
      // Contas a receber — filtrar cancelados + separar empréstimos
      for (const imp of imports.filter(i => i.import_type === "contas_receber")) {
        const regs = imp.import_data?.conta_receber_cadastro || [];
        if (!Array.isArray(regs)) continue;
        for (const r of regs) {
          const v = Number(r.valor_documento) || 0;
          if (v <= 0) continue;
          const status = (r.status_titulo || "").toUpperCase().trim();
          if (STATUS_EXCL.has(status)) continue;
          const cat = r.codigo_categoria || "";
          const desc = (r.descricao_categoria || "").toLowerCase();
          const isEmp = cat.startsWith("4.") || cat.startsWith("5.") || desc.includes("empréstimo") || desc.includes("financiamento") || desc.includes("aporte") || desc.includes("transferência");
          totalRec += v;
          if (isEmp) totalEmprestimos += v; else totalRecOp += v;
          if (status === "VENCIDO" || status === "ATRASADO") {
            totalVencido += v;
            recVencidos.push({ valor: v, cliente: r.codigo_cliente_fornecedor, venc: r.data_vencimento });
          }
        }
      }
      // Contas a pagar — filtrar cancelados
      const catTotals: Record<string, number> = {};
      for (const imp of imports.filter(i => i.import_type === "contas_pagar")) {
        const regs = imp.import_data?.conta_pagar_cadastro || [];
        if (!Array.isArray(regs)) continue;
        for (const r of regs) {
          const v = Number(r.valor_documento) || 0;
          if (v <= 0) continue;
          const status = (r.status_titulo || "").toUpperCase().trim();
          if (STATUS_EXCL.has(status)) continue;
          totalDesp += v;
          const cat = r.descricao_categoria || r.codigo_categoria || "outros";
          catTotals[cat] = (catTotals[cat] || 0) + v;
          if (status !== "PAGO" && status !== "LIQUIDADO") {
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
    const resultado = totalRecOp - totalDesp;
    const margem = totalRecOp > 0 ? ((resultado / totalRecOp) * 100).toFixed(1) : "0";

    // ═══ PROCESS UPLOADED FILE ═══
    let fileContent = "";
    let fileType = "";
    if (file && file.size > 0) {
      fileType = file.type || "";
      const fileName = (file.name || "").toLowerCase();
      // Detect by extension if type is empty
      if (!fileType) {
        if (fileName.endsWith(".pdf")) fileType = "application/pdf";
        else if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) fileType = "image/jpeg";
        else if (fileName.endsWith(".png")) fileType = "image/png";
        else if (fileName.endsWith(".webp")) fileType = "image/webp";
        else if (fileName.endsWith(".gif")) fileType = "image/gif";
        else fileType = "text/plain";
      }
      const isImage = fileType.includes("image") || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(fileName);
      const isPDF = fileType.includes("pdf") || fileName.endsWith(".pdf");

      if (isPDF) {
        fileContent = `[PDF ENVIADO: ${file.name}, ${(file.size / 1024).toFixed(0)}KB]`;
      } else if (isImage) {
        fileContent = `[IMAGEM ENVIADA: ${file.name}, ${(file.size / 1024).toFixed(0)}KB]`;
        fileType = "image"; // force image path
      } else {
        try {
          fileContent = await file.text();
          if (fileContent.length > 15000) fileContent = fileContent.substring(0, 15000) + "\n...[truncado]";
        } catch {
          fileContent = `[Arquivo: ${file.name}, ${(file.size / 1024).toFixed(0)}KB]`;
        }
      }
    }

    // ═══ BUILD CONTEXT ═══
    const contextBlock = `
═══ DADOS REAIS DA EMPRESA: ${compName} ═══

📊 RESUMO FINANCEIRO:
Receita operacional: ${fmtR(totalRecOp)}${totalEmprestimos > 0 ? ` (+ empréstimos/aportes: ${fmtR(totalEmprestimos)})` : ""}
Despesa total: ${fmtR(totalDesp)}
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
    const fileName = file ? (file.name || "").toLowerCase() : "";
    const isPDF = fileType.includes("pdf") || fileName.endsWith(".pdf");
    const isImage = fileType.includes("image") || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(fileName);

    if (file && file.size > 0 && isPDF) {
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      messages.push({
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: `${contextBlock}\n\n═══ PERGUNTA DO EMPRESÁRIO ═══\n${question}\n\nAnalise o documento anexado à luz de TODOS os dados financeiros reais acima. Dê uma resposta completa, prática e acionável. Se envolver decisão financeira, calcule cenários com números reais.` },
        ],
      });
    }
    else if (file && file.size > 0 && isImage) {
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const imgMediaType: "image/jpeg"|"image/png"|"image/webp"|"image/gif" = fileName.endsWith(".png") ? "image/png" : fileName.endsWith(".webp") ? "image/webp" : fileName.endsWith(".gif") ? "image/gif" : "image/jpeg";
      messages.push({
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: imgMediaType, data: base64 } },
          { type: "text", text: `${contextBlock}\n\n═══ PERGUNTA DO EMPRESÁRIO ═══\n${question}\n\nAnalise a imagem anexada à luz de TODOS os dados financeiros reais acima. Dê uma resposta completa, prática e acionável.` },
        ],
      });
    }
    else if (file && file.size > 0 && fileContent) {
      messages.push({
        role: "user",
        content: `${contextBlock}\n\n📎 CONTEÚDO DO ARQUIVO (${file.name}):\n${fileContent}\n\n═══ PERGUNTA DO EMPRESÁRIO ═══\n${question}\n\nAnalise o conteúdo do arquivo à luz de TODOS os dados financeiros reais acima. Dê uma resposta completa, prática e acionável.`,
      });
    }
    else {
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
        receitas: fmtR(totalRecOp),
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
