import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const supabaseUrl = "https://horsymhsinqcimflrtjo.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo';

const fmtR = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const STATUS_EXCLUIDOS = new Set(["CANCELADO","CANCELADA","ESTORNADO","ESTORNADA","DEVOLVIDO","DEVOLVIDA","ANULADO","ANULADA"]);

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const { company_id, modulos } = await req.json();
    if (!company_id) return NextResponse.json({ error: "company_id obrigatório" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const apiKey = process.env.ANTHROPIC_API_KEY;

    // 1. Load company info
    const { data: company } = await supabase.from("companies").select("*").eq("id", company_id).single();
    if (!company) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });

    // 2. Load contract (or create default)
    let { data: contrato } = await supabase.from("bpo_contratos").select("*").eq("company_id", company_id).single();
    if (!contrato) {
      const { data: newContrato } = await supabase.from("bpo_contratos").insert({
        company_id, classificacao_ia: true, dre_mensal: true, relatorio_ia: true
      }).select().single();
      contrato = newContrato;
    }

    // 3. Load all Omie data
    const { data: imports } = await supabase.from("omie_imports").select("import_type,import_data,record_count").eq("company_id", company_id);

    // 4. Create execution record
    const { data: execucao } = await supabase.from("bpo_execucoes").insert({
      company_id, status: "executando", executado_por: null,
    }).select().single();
    const execId = execucao?.id;

    const alertas: any[] = [];
    let classificacoesGeradas = 0;
    let classificacoesAuto = 0;
    let anomaliasDetectadas = 0;
    let conciliacoes = 0;
    let cobrancas = 0;

    // ═══ MODULE: CLASSIFICAÇÃO IA ═══
    if (contrato?.classificacao_ia && imports && apiKey) {
      const catMap: Record<string, { count: number; tipo: string }> = {};
      const unclassified: any[] = [];
      const clienteNomes: Record<string, string> = {};

      // Build maps
      for (const imp of imports) {
        if (imp.import_type === "clientes") {
          const cls = imp.import_data?.clientes_cadastro || [];
          if (Array.isArray(cls)) for (const c of cls) {
            const cod = c.codigo_cliente_omie || c.codigo_cliente || c.codigo;
            clienteNomes[String(cod)] = c.nome_fantasia || c.razao_social || c.nome || "";
          }
        }
      }

      // Find unclassified
      for (const imp of imports) {
        if (imp.import_type === "contas_receber" || imp.import_type === "contas_pagar") {
          const key = imp.import_type === "contas_receber" ? "conta_receber_cadastro" : "conta_pagar_cadastro";
          const regs = imp.import_data?.[key] || [];
          if (!Array.isArray(regs)) continue;
          for (const r of regs) {
            const status = (r.status_titulo || "").toUpperCase();
            if (STATUS_EXCLUIDOS.has(status)) continue;
            const cat = r.codigo_categoria || "";
            if (!cat || cat === "sem_cat" || cat === "0") {
              const codCF = String(r.codigo_cliente_fornecedor || "");
              unclassified.push({
                tipo: imp.import_type === "contas_receber" ? "receber" : "pagar",
                doc: r.numero_documento || "",
                data: r.data_emissao || r.data_vencimento || "",
                valor: Number(r.valor_documento) || 0,
                nome: clienteNomes[codCF] || r.observacao || `CF ${codCF}`,
                obs: r.observacao || "",
              });
            } else {
              const desc = r.descricao_categoria || "";
              catMap[`${cat}|${desc}`] = { count: (catMap[`${cat}|${desc}`]?.count || 0) + 1, tipo: imp.import_type === "contas_receber" ? "receita" : "despesa" };
            }
          }
        }
      }

      // Classify with AI in batch (max 20 at a time)
      if (unclassified.length > 0) {
        const batch = unclassified.slice(0, 20);
        const categoriasExistentes = Object.entries(catMap).map(([k, v]) => `${k} (${v.count}x, ${v.tipo})`).join("\n");

        try {
          const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4000,
              system: "Você classifica lançamentos financeiros. Responda APENAS com JSON array. Cada item: {index, categoria_sugerida, confianca (0-100), justificativa}. Use as categorias existentes quando possível.",
              messages: [{ role: "user", content: `CATEGORIAS EXISTENTES:\n${categoriasExistentes}\n\nLANÇAMENTOS PARA CLASSIFICAR:\n${batch.map((u, i) => `[${i}] ${u.tipo} | ${u.nome} | ${fmtR(u.valor)} | ${u.data} | ${u.obs}`).join("\n")}\n\nClassifique cada um. JSON array:` }],
            }),
          });
          const aiData = await aiRes.json();
          const text = aiData.content?.[0]?.text || "";
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const classifications = JSON.parse(jsonMatch[0]);
            for (const cl of classifications) {
              const item = batch[cl.index];
              if (!item) continue;
              const autoApprove = cl.confianca >= 85;
              await supabase.from("bpo_classificacoes").insert({
                company_id,
                tipo_conta: item.tipo,
                documento: item.doc,
                data_lancamento: item.data,
                valor: item.valor,
                nome_cliente_fornecedor: item.nome,
                categoria_sugerida: cl.categoria_sugerida,
                confianca: cl.confianca,
                justificativa: cl.justificativa,
                status: autoApprove ? "aprovado" : "pendente",
                categoria_final: autoApprove ? cl.categoria_sugerida : "",
                operador_acao: autoApprove ? "auto_ia" : "",
              });
              classificacoesGeradas++;
              if (autoApprove) classificacoesAuto++;
            }
          }
        } catch (e) {
          alertas.push({ tipo: "erro", severidade: "alta", titulo: "Erro na classificação IA", descricao: String(e), acao_sugerida: "Verificar ANTHROPIC_API_KEY" });
        }

        if (unclassified.length > 20) {
          alertas.push({ tipo: "info", severidade: "media", titulo: `${unclassified.length - 20} lançamentos aguardam classificação`, descricao: `Total sem categoria: ${unclassified.length}. Classificados nesta execução: ${Math.min(20, unclassified.length)}.`, acao_sugerida: "Rodar novamente para classificar o restante" });
        }
      }
    }

    // ═══ MODULE: DETECÇÃO DE ANOMALIAS ═══
    if (imports) {
      for (const imp of imports) {
        if (imp.import_type !== "contas_pagar" && imp.import_type !== "contas_receber") continue;
        const key = imp.import_type === "contas_receber" ? "conta_receber_cadastro" : "conta_pagar_cadastro";
        const regs = imp.import_data?.[key] || [];
        if (!Array.isArray(regs)) continue;

        // Detect duplicates (same value + same date + same client)
        const seen = new Map<string, any>();
        for (const r of regs) {
          const status = (r.status_titulo || "").toUpperCase();
          if (STATUS_EXCLUIDOS.has(status)) continue;
          const v = Number(r.valor_documento) || 0;
          const dt = r.data_emissao || r.data_vencimento || "";
          const cf = String(r.codigo_cliente_fornecedor || "");
          const fingerprint = `${v}|${dt}|${cf}`;
          if (seen.has(fingerprint)) {
            anomaliasDetectadas++;
            const prev = seen.get(fingerprint);
            alertas.push({
              tipo: "anomalia", severidade: "alta",
              titulo: `Possível duplicidade: ${fmtR(v)}`,
              descricao: `${imp.import_type}: Dois lançamentos com mesmo valor (${fmtR(v)}), data (${dt}) e fornecedor/cliente (${cf}). Docs: ${r.numero_documento || "?"} e ${prev.numero_documento || "?"}`,
              acao_sugerida: "Verificar no Omie se é duplicidade real",
            });
          }
          seen.set(fingerprint, r);
        }

        // Detect overdue
        if (imp.import_type === "contas_receber") {
          let totalVencido = 0;
          let qtdVencidos = 0;
          for (const r of regs) {
            const status = (r.status_titulo || "").toUpperCase();
            if (status === "VENCIDO" || status === "ATRASADO") {
              totalVencido += Number(r.valor_documento) || 0;
              qtdVencidos++;
            }
          }
          if (qtdVencidos > 0) {
            alertas.push({
              tipo: "cobranca", severidade: totalVencido > 50000 ? "critica" : "alta",
              titulo: `${qtdVencidos} título(s) vencido(s): ${fmtR(totalVencido)}`,
              descricao: `A empresa tem ${fmtR(totalVencido)} em títulos vencidos que precisam de cobrança.`,
              acao_sugerida: contrato?.cobranca ? "Gerar cobranças automáticas" : "Ativar módulo de cobrança no contrato",
            });
            cobrancas = qtdVencidos;
          }
        }

        // Detect large unusual transactions
        if (regs.length > 10) {
          const values = regs.filter((r: any) => !STATUS_EXCLUIDOS.has((r.status_titulo || "").toUpperCase())).map((r: any) => Number(r.valor_documento) || 0).filter((v: number) => v > 0);
          const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
          const threshold = avg * 5;
          for (const r of regs) {
            const v = Number(r.valor_documento) || 0;
            if (v > threshold && v > 10000) {
              anomaliasDetectadas++;
              alertas.push({
                tipo: "anomalia", severidade: "media",
                titulo: `Valor atípico: ${fmtR(v)} (média: ${fmtR(avg)})`,
                descricao: `${imp.import_type}: Doc ${r.numero_documento || "?"} com valor ${(v / avg).toFixed(1)}x acima da média.`,
                acao_sugerida: "Verificar se é lançamento legítimo",
              });
            }
          }
        }
      }
    }

    // ═══ MODULE: RESUMO IA DO DIA ═══
    let resumoIA = "";
    if (contrato?.dre_mensal && apiKey && alertas.length > 0) {
      try {
        const alertasTxt = alertas.slice(0, 10).map(a => `[${a.severidade}] ${a.titulo}: ${a.descricao}`).join("\n");
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            system: "Você é o assistente BPO da PS Gestão. Resuma os alertas do dia em 3-5 linhas, priorizando o que o operador precisa resolver primeiro. Seja direto e prático.",
            messages: [{ role: "user", content: `Empresa: ${company.nome_fantasia || company.razao_social}\nAlertas do dia:\n${alertasTxt}\n\nResumo para o operador:` }],
          }),
        });
        const aiData = await aiRes.json();
        resumoIA = aiData.content?.[0]?.text || "";
      } catch { }
    }

    // ═══ SAVE ALERTS ═══
    if (alertas.length > 0 && execId) {
      for (const a of alertas) {
        await supabase.from("bpo_alertas").insert({ company_id, execucao_id: execId, ...a });
      }
    }

    // ═══ UPDATE EXECUTION ═══
    const duracao = Date.now() - startTime;
    if (execId) {
      await supabase.from("bpo_execucoes").update({
        status: "concluido",
        classificacoes_geradas: classificacoesGeradas,
        classificacoes_auto: classificacoesAuto,
        anomalias_detectadas: anomaliasDetectadas,
        conciliacoes_feitas: conciliacoes,
        cobrancas_enviadas: cobrancas,
        alertas_gerados: alertas.length,
        resumo_ia: resumoIA,
        duracao_ms: duracao,
      }).eq("id", execId);
    }

    // Update contract last execution
    await supabase.from("bpo_contratos").update({ updated_at: new Date().toISOString() }).eq("company_id", company_id);

    return NextResponse.json({
      success: true,
      empresa: company.nome_fantasia || company.razao_social,
      execucao_id: execId,
      duracao_ms: duracao,
      resultados: {
        classificacoes_geradas: classificacoesGeradas,
        classificacoes_auto: classificacoesAuto,
        classificacoes_pendentes: classificacoesGeradas - classificacoesAuto,
        anomalias_detectadas: anomaliasDetectadas,
        conciliacoes: conciliacoes,
        cobrancas: cobrancas,
        alertas: alertas.length,
      },
      alertas: alertas.slice(0, 20),
      resumo_ia: resumoIA,
      contrato: {
        classificacao_ia: contrato?.classificacao_ia,
        contas_pagar: contrato?.contas_pagar,
        contas_receber: contrato?.contas_receber,
        conciliacao_bancaria: contrato?.conciliacao_bancaria,
        cobranca: contrato?.cobranca,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
