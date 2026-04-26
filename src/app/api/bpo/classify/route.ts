import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withAuth } from "@/lib/withAuth";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Fallback: quando Omie tem rateio, codigo_categoria é null e categorias[] tem a divisão
function getCategoriaOmie(r: any): string {
  if (r.codigo_categoria) return r.codigo_categoria;
  if (Array.isArray(r.categorias) && r.categorias.length > 0) {
    const sorted = [...r.categorias].sort((a: any, b: any) => (b.percentual || 0) - (a.percentual || 0));
    if (sorted[0] && sorted[0].codigo_categoria) return sorted[0].codigo_categoria;
  }
  return "";
}

async function handler(req: NextRequest, _user: { userId: string; userEmail?: string }) {
  const startTime = Date.now();
  try {
    const { company_id } = await req.json();
    if (!company_id) return NextResponse.json({ error: "company_id obrigatorio" }, { status: 400 });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada" }, { status: 500 });

    const supabase = supabaseAdmin;

    // 1. Load all Omie transactions
    const { data: imports } = await supabase.from("omie_imports").select("import_type,import_data").eq("company_id", company_id);
    if (!imports || imports.length === 0) return NextResponse.json({ error: "Sem dados importados" }, { status: 404 });

    // 2. Build category map from existing classified transactions
    const catMap: Record<string, { count: number; tipo: string }> = {};
    const unclassified: any[] = [];
    const clienteNomes: Record<string, string> = {};

    // Load client names
    for (const imp of imports) {
      if (imp.import_type === "clientes") {
        const cls = imp.import_data?.clientes_cadastro || [];
        if (Array.isArray(cls)) {
          for (const c of cls) {
            const cod = c.codigo_cliente_omie || c.codigo_cliente || c.codigo;
            clienteNomes[String(cod)] = c.nome_fantasia || c.razao_social || c.nome || "";
          }
        }
      }
    }

    // Process contas a receber
    for (const imp of imports) {
      if (imp.import_type === "contas_receber") {
        const regs = imp.import_data?.conta_receber_cadastro || [];
        if (!Array.isArray(regs)) continue;
        for (const r of regs) {
          const cat = getCategoriaOmie(r);
          const desc = r.descricao_categoria || "";
          if (cat && cat !== "sem_cat" && cat !== "0") {
            catMap[`${cat}|${desc}`] = { count: (catMap[`${cat}|${desc}`]?.count || 0) + 1, tipo: "receita" };
          }
          if (!cat || cat === "sem_cat" || cat === "0" || cat.startsWith("2.") || cat.startsWith("4.") || cat.startsWith("5.")) {
            const codCF = String(r.codigo_cliente_fornecedor || "");
            unclassified.push({
              tipo_conta: "receber",
              documento: r.numero_documento || r.numero_documento_fiscal || "",
              data: r.data_previsao || r.data_vencimento || r.data_emissao || "",
              valor: Number(r.valor_documento) || 0,
              nome_cf: clienteNomes[codCF] || "Cliente " + codCF,
              categoria_atual: cat ? `${cat} — ${desc}` : "SEM CATEGORIA",
              observacao: r.observacao || "",
              status: r.status_titulo || "",
              problema: !cat || cat === "sem_cat" ? "sem_categoria" : "classificacao_incorreta",
            });
          }
        }
      }

      if (imp.import_type === "contas_pagar") {
        const regs = imp.import_data?.conta_pagar_cadastro || [];
        if (!Array.isArray(regs)) continue;
        for (const r of regs) {
          const cat = getCategoriaOmie(r);
          const desc = r.descricao_categoria || "";
          if (cat && cat !== "sem_cat" && cat !== "0") {
            catMap[`${cat}|${desc}`] = { count: (catMap[`${cat}|${desc}`]?.count || 0) + 1, tipo: "despesa" };
          }
          if (!cat || cat === "sem_cat" || cat === "0") {
            const codCF = String(r.codigo_cliente_fornecedor || r.codigo_fornecedor || "");
            unclassified.push({
              tipo_conta: "pagar",
              documento: r.numero_documento || r.numero_documento_fiscal || "",
              data: r.data_previsao || r.data_vencimento || r.data_emissao || "",
              valor: Number(r.valor_documento) || 0,
              nome_cf: clienteNomes[codCF] || r.observacao || "Fornecedor " + codCF,
              categoria_atual: "SEM CATEGORIA",
              observacao: r.observacao || "",
              status: r.status_titulo || "",
              problema: "sem_categoria",
            });
          }
        }
      }
    }

    if (unclassified.length === 0) {
      await supabase.from("bpo_sync_log").insert({ company_id, tipo: "classificacao_ia", status: "sucesso", registros_processados: 0, classificacoes_geradas: 0, duracao_ms: Date.now() - startTime });
      return NextResponse.json({ success: true, message: "Nenhum lançamento pendente de classificação", classificacoes: 0 });
    }

    // 3. Build category list for AI
    const categoriasExistentes = Object.entries(catMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 30)
      .map(([k, v]) => `${k} (${v.count}x, ${v.tipo})`)
      .join("\n");

    // 4. Send batch to AI (max 50 at a time)
    const batch = unclassified.slice(0, 50);
    const lancamentosText = batch.map((l, i) =>
      `${i + 1}. ${l.tipo_conta.toUpperCase()} | Doc: ${l.documento} | ${l.data} | R$ ${l.valor.toFixed(2)} | ${l.nome_cf} | Obs: ${l.observacao} | Cat atual: ${l.categoria_atual}`
    ).join("\n");

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: `Você é um classificador contábil especialista em PMEs brasileiras. 
Analise cada lançamento e sugira a categoria contábil mais adequada.
Responda APENAS em JSON, sem markdown, sem explicação fora do JSON.
Formato: [{"id":1,"categoria":"1.01.01 — Venda de Mercadorias","confianca":95,"justificativa":"Cliente com histórico de compras"}]
Use as categorias existentes da empresa quando possível.`,
        messages: [{
          role: "user",
          content: `CATEGORIAS EXISTENTES DA EMPRESA:
${categoriasExistentes}

LANÇAMENTOS PARA CLASSIFICAR:
${lancamentosText}

Classifique cada um. Responda APENAS com o JSON array.`
        }],
      }),
    });

    const aiData = await aiResponse.json();
    const aiText = aiData.content?.map((c: any) => c.text || "").join("") || "[]";

    // 5. Parse AI suggestions
    let suggestions: any[] = [];
    try {
      const cleaned = aiText.replace(/```json|```/g, "").trim();
      suggestions = JSON.parse(cleaned);
    } catch {
      suggestions = [];
    }

    // 6. Save to bpo_classificacoes
    let saved = 0;
    for (const sug of suggestions) {
      const idx = (sug.id || 1) - 1;
      if (idx < 0 || idx >= batch.length) continue;
      const lanc = batch[idx];

      await supabase.from("bpo_classificacoes").insert({
        company_id,
        tipo_conta: lanc.tipo_conta,
        documento: lanc.documento,
        data_lancamento: lanc.data,
        valor: lanc.valor,
        nome_cliente_fornecedor: lanc.nome_cf,
        categoria_atual: lanc.categoria_atual,
        categoria_sugerida: sug.categoria || "",
        confianca: sug.confianca || 0,
        justificativa: sug.justificativa || "",
        status: "pendente",
      });
      saved++;
    }

    // 7. Log
    await supabase.from("bpo_sync_log").insert({
      company_id,
      tipo: "classificacao_ia",
      status: "sucesso",
      registros_processados: batch.length,
      classificacoes_geradas: saved,
      duracao_ms: Date.now() - startTime,
    });

    // 8. Update routine last execution
    await supabase.from("bpo_rotinas").update({ ultima_execucao: new Date().toISOString() }).eq("company_id", company_id).eq("tipo", "auto_classificacao");

    return NextResponse.json({
      success: true,
      total_analisados: batch.length,
      classificacoes_geradas: saved,
      pendentes_restantes: unclassified.length - batch.length,
      duracao_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[bpo/classify]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const POST = withAuth(handler);
