import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const STATUS_EXCL = new Set(["CANCELADO","CANCELADA","ESTORNADO","ESTORNADA","DEVOLVIDO","DEVOLVIDA","ANULADO","ANULADA"]);
const fmtR = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function toISO(d: string): string {
  if (!d) return "";
  if (d.includes("T")) return d.split("T")[0]; // ISO: 2025-10-08T00:00:00Z → 2025-10-08
  if (d.includes("/")) { const p = d.split("/"); if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`; }
  return d;
}

function extractAll(imports: any[]) {
  const pagar: any[] = [], receber: any[] = [], nomes: Record<string, string> = {};
  for (const imp of imports) {
    if (imp.import_type === "clientes") {
      const cls = imp.import_data?.clientes_cadastro || [];
      if (Array.isArray(cls)) for (const c of cls) nomes[String(c.codigo_cliente_omie || c.codigo_cliente || c.codigo || "")] = c.nome_fantasia || c.razao_social || "";
    }
  }
  for (const imp of imports) {
    const tipo = imp.import_type;
    if (tipo !== "contas_pagar" && tipo !== "contas_receber") continue;
    const key = tipo === "contas_receber" ? "conta_receber_cadastro" : "conta_pagar_cadastro";
    const regs = imp.import_data?.[key] || [];
    if (!Array.isArray(regs)) continue;
    for (const r of regs) {
      const st = (r.status_titulo || "").toUpperCase().trim();
      if (STATUS_EXCL.has(st)) continue;
      const v = Number(r.valor_documento) || 0; if (v <= 0) continue;
      const codCF = String(r.codigo_cliente_fornecedor || r.codigo_fornecedor || "");
      const item = { valor: v, data: toISO(r.data_emissao || r.data_vencimento || ""), vencimento: toISO(r.data_vencimento || ""), status: st, nome: nomes[codCF] || r.nome_fornecedor || r.nome_cliente || r.observacao || codCF, cat: r.descricao_categoria || r.codigo_categoria || "", doc: r.numero_documento || "", obs: r.observacao || "" };
      if (tipo === "contas_pagar") pagar.push(item); else receber.push(item);
    }
  }
  return { pagar, receber, nomes };
}

export async function POST(req: Request) {
  const startTime = Date.now();
  try {
    const { company_id, modulos } = await req.json();
    if (!company_id) return NextResponse.json({ error: "company_id obrigatorio" }, { status: 400 });
    const supabase = createClient(supabaseUrl, supabaseKey);
    const apiKey = process.env.ANTHROPIC_API_KEY;

    const { data: company } = await supabase.from("companies").select("*").eq("id", company_id).single();
    if (!company) return NextResponse.json({ error: "Empresa nao encontrada" }, { status: 404 });

    let { data: contrato } = await supabase.from("bpo_contratos").select("*").eq("company_id", company_id).single();
    if (!contrato) { const { data: nc } = await supabase.from("bpo_contratos").insert({ company_id, classificacao_ia: true, dre_mensal: true, relatorio_ia: true }).select().single(); contrato = nc; }

    const { data: imports } = await supabase.from("omie_imports").select("import_type,import_data,record_count").eq("company_id", company_id);
    const { pagar, receber } = extractAll(imports || []);

    const { data: execucao } = await supabase.from("bpo_execucoes").insert({ company_id, status: "executando" }).select().single();
    const execId = execucao?.id;

    const alertas: any[] = [];
    const resultados: Record<string, any> = {};
    const hoje = new Date().toISOString().split("T")[0];

    // ═══════════════════════════════════════════════════════
    // 1. ANOMALIAS — Duplicatas + outliers
    // ═══════════════════════════════════════════════════════
    {
      let anom = 0;
      const seen = new Map<string, any>();
      for (const r of [...pagar, ...receber]) {
        const fp = `${r.valor}|${r.data}|${r.nome}`;
        if (seen.has(fp)) { anom++; alertas.push({ tipo: "anomalia", severidade: "alta", titulo: `Duplicidade: ${fmtR(r.valor)} - ${r.nome}`, descricao: `Mesmo valor, data e fornecedor. Docs: ${r.doc} e ${seen.get(fp).doc}`, acao_sugerida: "Verificar no Omie" }); }
        seen.set(fp, r);
      }
      const vals = pagar.map(r => r.valor).filter(v => v > 0);
      const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      for (const r of pagar) { if (r.valor > avg * 5 && r.valor > 10000) { anom++; alertas.push({ tipo: "anomalia", severidade: "media", titulo: `Valor atipico: ${fmtR(r.valor)}`, descricao: `${r.nome}: ${(r.valor / avg).toFixed(1)}x acima da media`, acao_sugerida: "Verificar legitimidade" }); } }
      resultados.anomalias = { detectadas: anom };
    }

    // ═══════════════════════════════════════════════════════
    // 2. COBRANCA — Vencidos + inadimplencia
    // ═══════════════════════════════════════════════════════
    {
      const vencidos = receber.filter(r => r.status === "VENCIDO" || r.status === "ATRASADO" || (r.vencimento && r.vencimento < hoje && r.status !== "LIQUIDADO" && r.status !== "PAGO"));
      const totalVencido = vencidos.reduce((s, r) => s + r.valor, 0);
      if (vencidos.length > 0) {
        alertas.push({ tipo: "cobranca", severidade: totalVencido > 50000 ? "critica" : "alta", titulo: `${vencidos.length} titulo(s) vencido(s): ${fmtR(totalVencido)}`, descricao: `Top devedores: ${vencidos.sort((a, b) => b.valor - a.valor).slice(0, 3).map(v => v.nome + " " + fmtR(v.valor)).join(", ")}`, acao_sugerida: "Acionar cobranca" });
      }
      resultados.cobranca = { vencidos: vencidos.length, valor_vencido: totalVencido, top_devedores: vencidos.sort((a, b) => b.valor - a.valor).slice(0, 10).map(v => ({ nome: v.nome, valor: v.valor, vencimento: v.vencimento })) };
    }

    // ═══════════════════════════════════════════════════════
    // 3. CONTAS A PAGAR — Proximos 7 dias
    // ═══════════════════════════════════════════════════════
    {
      const em7d = new Date(); em7d.setDate(em7d.getDate() + 7);
      const sem7 = em7d.toISOString().split("T")[0];
      const proximos = pagar.filter(r => r.vencimento >= hoje && r.vencimento <= sem7 && r.status !== "LIQUIDADO" && r.status !== "PAGO");
      const totalProx = proximos.reduce((s, r) => s + r.valor, 0);
      if (proximos.length > 0) {
        alertas.push({ tipo: "contas_pagar", severidade: totalProx > 100000 ? "alta" : "media", titulo: `${proximos.length} pagamentos esta semana: ${fmtR(totalProx)}`, descricao: `Vencimentos de ${hoje} a ${sem7}`, acao_sugerida: "Programar pagamentos no banco" });
      }
      const atrasados = pagar.filter(r => r.vencimento && r.vencimento < hoje && r.status !== "LIQUIDADO" && r.status !== "PAGO");
      if (atrasados.length > 0) {
        const totalAtr = atrasados.reduce((s, r) => s + r.valor, 0);
        alertas.push({ tipo: "contas_pagar", severidade: "critica", titulo: `${atrasados.length} pagamento(s) ATRASADO(S): ${fmtR(totalAtr)}`, descricao: `Fornecedores: ${atrasados.slice(0, 3).map(a => a.nome).join(", ")}`, acao_sugerida: "Pagar imediatamente para evitar juros" });
      }
      resultados.contas_pagar = { proximos_7d: proximos.length, valor_7d: totalProx, atrasados: atrasados.length, valor_atrasado: atrasados.reduce((s, r) => s + r.valor, 0) };
    }

    // ═══════════════════════════════════════════════════════
    // 4. FLUXO DE CAIXA — Projecao 30/60/90 dias
    // ═══════════════════════════════════════════════════════
    {
      const proj = [30, 60, 90].map(dias => {
        const limite = new Date(); limite.setDate(limite.getDate() + dias);
        const lim = limite.toISOString().split("T")[0];
        const entradas = receber.filter(r => r.vencimento >= hoje && r.vencimento <= lim).reduce((s, r) => s + r.valor, 0);
        const saidas = pagar.filter(r => r.vencimento >= hoje && r.vencimento <= lim).reduce((s, r) => s + r.valor, 0);
        return { dias, entradas, saidas, saldo: entradas - saidas };
      });
      const negativo = proj.find(p => p.saldo < 0);
      if (negativo) {
        alertas.push({ tipo: "fluxo_caixa", severidade: "alta", titulo: `Fluxo negativo em ${negativo.dias} dias: ${fmtR(negativo.saldo)}`, descricao: `Entradas: ${fmtR(negativo.entradas)} | Saidas: ${fmtR(negativo.saidas)}`, acao_sugerida: "Acelerar recebimentos ou renegociar prazos" });
      }
      resultados.fluxo_caixa = proj;
    }

    // ═══════════════════════════════════════════════════════
    // 5. DRE MENSAL — Receita x Despesa por mes
    // ═══════════════════════════════════════════════════════
    {
      const meses: Record<string, { rec: number; desp: number }> = {};
      for (const r of receber) { const ym = r.data?.substring(0, 7); if (ym) { if (!meses[ym]) meses[ym] = { rec: 0, desp: 0 }; meses[ym].rec += r.valor; } }
      for (const r of pagar) { const ym = r.data?.substring(0, 7); if (ym) { if (!meses[ym]) meses[ym] = { rec: 0, desp: 0 }; meses[ym].desp += r.valor; } }
      const dreArr = Object.entries(meses).map(([mes, v]) => ({ mes, receita: v.rec, despesa: v.desp, resultado: v.rec - v.desp, margem: v.rec > 0 ? ((v.rec - v.desp) / v.rec * 100) : 0 })).sort((a, b) => b.mes.localeCompare(a.mes)).slice(0, 6);
      if (dreArr.length > 0 && dreArr[0].resultado < 0) {
        alertas.push({ tipo: "dre", severidade: "alta", titulo: `Ultimo mes com resultado negativo: ${fmtR(dreArr[0].resultado)}`, descricao: `${dreArr[0].mes}: Receita ${fmtR(dreArr[0].receita)} - Despesa ${fmtR(dreArr[0].despesa)}`, acao_sugerida: "Revisar custos e acelerar faturamento" });
      }
      resultados.dre_mensal = dreArr;
    }

    // ═══════════════════════════════════════════════════════
    // 6. FECHAMENTO — Pendencias do periodo
    // ═══════════════════════════════════════════════════════
    {
      const semCat = [...pagar, ...receber].filter(r => !r.cat || r.cat === "sem_cat" || r.cat === "0" || r.cat === "SEM CATEGORIA");
      const pendClass = semCat.length;
      const { data: classifPend } = await supabase.from("bpo_classificacoes").select("id").eq("company_id", company_id).eq("status", "pendente");
      const pendAprov = classifPend?.length || 0;
      if (pendClass > 0 || pendAprov > 0) {
        alertas.push({ tipo: "fechamento", severidade: "media", titulo: `Pendencias: ${pendClass} sem categoria, ${pendAprov} aguardando aprovacao`, descricao: "Itens pendentes impedem fechamento preciso do periodo", acao_sugerida: "Classificar e aprovar antes do fechamento" });
      }
      resultados.fechamento = { sem_categoria: pendClass, aguardando_aprovacao: pendAprov, total_lancamentos: pagar.length + receber.length };
    }

    // ═══════════════════════════════════════════════════════
    // 7. OBRIGACOES FISCAIS — Calendario
    // ═══════════════════════════════════════════════════════
    {
      const mesAtual = new Date().getMonth() + 1;
      const anoAtual = new Date().getFullYear();
      const obrigacoes = [
        { nome: "DAS (Simples Nacional)", dia: 20, regimes: ["simples"] },
        { nome: "DARF PIS", dia: 25, regimes: ["lucro_presumido", "lucro_real"] },
        { nome: "DARF COFINS", dia: 25, regimes: ["lucro_presumido", "lucro_real"] },
        { nome: "DARF IRPJ", dia: 30, regimes: ["lucro_presumido", "lucro_real"] },
        { nome: "DARF CSLL", dia: 30, regimes: ["lucro_presumido", "lucro_real"] },
        { nome: "GFIP/SEFIP", dia: 7, regimes: ["todos"] },
        { nome: "FGTS", dia: 7, regimes: ["todos"] },
        { nome: "INSS", dia: 20, regimes: ["todos"] },
      ];
      const proximas = obrigacoes.map(o => {
        const venc = new Date(anoAtual, mesAtual - 1, o.dia);
        if (venc < new Date()) venc.setMonth(venc.getMonth() + 1);
        const dias = Math.ceil((venc.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return { ...o, vencimento: venc.toISOString().split("T")[0], dias_restantes: dias };
      }).sort((a, b) => a.dias_restantes - b.dias_restantes);
      const urgentes = proximas.filter(o => o.dias_restantes <= 5);
      if (urgentes.length > 0) {
        alertas.push({ tipo: "obrigacoes", severidade: "critica", titulo: `${urgentes.length} obrigacao(oes) vence(m) em ate 5 dias`, descricao: urgentes.map(o => `${o.nome} (${o.dias_restantes}d)`).join(", "), acao_sugerida: "Gerar guias imediatamente" });
      }
      resultados.obrigacoes = proximas;
    }

    // ═══════════════════════════════════════════════════════
    // 8. BALANCO / INDICADORES
    // ═══════════════════════════════════════════════════════
    {
      const totalRec = receber.reduce((s, r) => s + r.valor, 0);
      const totalPag = pagar.reduce((s, r) => s + r.valor, 0);
      const resultado = totalRec - totalPag;
      const margem = totalRec > 0 ? (resultado / totalRec * 100) : 0;
      const ticketMedio = receber.length > 0 ? totalRec / receber.length : 0;
      const inadimplencia = receber.filter(r => r.status === "VENCIDO" || r.status === "ATRASADO").reduce((s, r) => s + r.valor, 0);
      const pctInad = totalRec > 0 ? (inadimplencia / totalRec * 100) : 0;
      resultados.indicadores = { receita_total: totalRec, despesa_total: totalPag, resultado, margem: margem.toFixed(1) + "%", ticket_medio: ticketMedio, inadimplencia, pct_inadimplencia: pctInad.toFixed(1) + "%", total_clientes: new Set(receber.map(r => r.nome)).size, total_fornecedores: new Set(pagar.map(r => r.nome)).size };
    }

    // ═══════════════════════════════════════════════════════
    // 9. RESUMO IA DO DIA
    // ═══════════════════════════════════════════════════════
    let resumoIA = "";
    if (apiKey && alertas.length > 0) {
      try {
        const alertasTxt = alertas.slice(0, 10).map(a => `[${a.severidade}] ${a.titulo}: ${a.descricao}`).join("\n");
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: "Voce e o assistente BPO da PS Gestao. Resuma os alertas do dia em 3-5 linhas, priorizando o que o operador precisa resolver primeiro. Seja direto e pratico.", messages: [{ role: "user", content: `Empresa: ${company.nome_fantasia || company.razao_social}\nAlertas:\n${alertasTxt}\n\nResumo:` }] }) });
        const aiData = await aiRes.json();
        resumoIA = aiData.content?.[0]?.text || "";
      } catch { }
    }

    // ═══════════════════════════════════════════════════════
    // SAVE & RETURN
    // ═══════════════════════════════════════════════════════
    // Persiste todos os alertas em bpo_alertas (batch). O trigger
    // fn_alerta_to_inbox cria o item correspondente em bpo_inbox_items
    // automaticamente a cada INSERT.
    let alertasInseridos = 0;
    const errosInsert: string[] = [];
    const debugLog: any = {
      company_id,
      execId,
      alertas_total: alertas.length,
      supa_url: supabaseUrl,
      service_key_len: (process.env.SUPABASE_SERVICE_ROLE_KEY || "").length,
      anon_key_len: (process.env.SUPABASE_ANON_KEY || "").length,
    };
    console.error("[BPO_ALERTAS] pre-insert", JSON.stringify(debugLog));

    if (alertas.length > 0 && execId) {
      const rows = alertas.map((a) => ({
        company_id,
        execucao_id: execId,
        tipo: a.tipo,
        severidade: a.severidade,
        titulo: a.titulo,
        descricao: a.descricao,
        acao_sugerida: a.acao_sugerida,
        status: "pendente",
      }));

      console.error(
        "[BPO_ALERTAS] rows a inserir:",
        JSON.stringify({ count: rows.length, first: rows[0], last: rows[rows.length - 1] })
      );

      for (let i = 0; i < rows.length; i += 100) {
        const lote = rows.slice(i, i + 100);
        const res = await supabase
          .from("bpo_alertas")
          .insert(lote)
          .select("id"); // retorna os IDs realmente persistidos
        console.error(
          "[BPO_ALERTAS] batch",
          i,
          JSON.stringify({
            enviados: lote.length,
            error: res.error ? { message: res.error.message, code: (res.error as any).code, details: (res.error as any).details, hint: (res.error as any).hint } : null,
            data_len: res.data?.length ?? null,
          })
        );

        if (res.error) {
          errosInsert.push(res.error.message);
          // Fallback registro-a-registro pra não perder o lote inteiro.
          for (const r of lote) {
            const single = await supabase.from("bpo_alertas").insert(r).select("id");
            if (single.error) {
              errosInsert.push(`${r.tipo}/${r.titulo}: ${single.error.message}`);
              console.error("[BPO_ALERTAS] single-fail", JSON.stringify({ row: r, error: single.error.message }));
            } else {
              alertasInseridos += single.data?.length ?? 0;
            }
          }
        } else {
          alertasInseridos += res.data?.length ?? 0;
        }
      }

      // Verificação final: conta real da tabela vs o que o código contou.
      const { count: countReal, error: countErr } = await supabase
        .from("bpo_alertas")
        .select("id", { count: "exact", head: true })
        .eq("execucao_id", execId);
      console.error(
        "[BPO_ALERTAS] pos-insert verificacao",
        JSON.stringify({
          contador_codigo: alertasInseridos,
          count_real_db: countReal,
          count_err: countErr?.message ?? null,
          divergencia: alertasInseridos !== countReal,
        })
      );
    } else {
      console.error("[BPO_ALERTAS] skip (alertas=0 ou execId ausente)", JSON.stringify({ alertas: alertas.length, execId }));
    }

    const duracao = Date.now() - startTime;
    if (execId) {
      await supabase.from("bpo_execucoes").update({ status: "concluido", anomalias_detectadas: resultados.anomalias?.detectadas || 0, cobrancas_enviadas: resultados.cobranca?.vencidos || 0, alertas_gerados: alertas.length, resumo_ia: resumoIA, duracao_ms: duracao, resultados: JSON.stringify(resultados) }).eq("id", execId);
    }
    await supabase.from("bpo_contratos").update({ updated_at: new Date().toISOString() }).eq("company_id", company_id);

    return NextResponse.json({
      success: true,
      duracao_ms: duracao,
      alertas_gerados: alertas.length,
      alertas_inseridos: alertasInseridos,
      erros_insert: errosInsert.slice(0, 5),
      alertas: alertas.slice(0, 20),
      resumo_ia: resumoIA,
      resultados,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
