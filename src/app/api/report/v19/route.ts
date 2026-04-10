import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo';
const fmtR = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const pct = (v: number, t: number) => t > 0 ? (v / t * 100).toFixed(1) + "%" : "0%";

export async function POST(req: NextRequest) {
  try {
    const { company_ids, periodo_inicio, periodo_fim, empresa_nome, contexto_humano } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada" }, { status: 500 });
    const supabase = createClient(supabaseUrl, supabaseKey);
    const compIds = company_ids || [];
    if (compIds.length === 0) return NextResponse.json({ error: "Nenhuma empresa selecionada" }, { status: 400 });

    // ══════════════════════════════════════════
    // COLETA DE TODAS AS 17 FONTES DE DADOS
    // ══════════════════════════════════════════

    // 1. EMPRESAS
    const { data: companies } = await supabase.from("companies").select("*").in("id", compIds);
    const compInfo = (companies || []).map(c => `${c.nome_fantasia || c.razao_social} | CNPJ: ${c.cnpj || "N/I"} | ${c.cidade_estado || ""} | Setor: ${c.setor || "N/I"} | ${c.num_colaboradores || "N/I"} colaboradores | Regime: ${c.regime_tributario || "N/I"} | Faturamento: ${c.faturamento_anual ? fmtR(Number(c.faturamento_anual)) : "N/I"}`).join("\n");

    // 2. DADOS IMPORTADOS (Omie, ContaAzul, Bling ou qualquer ERP integrado)
    const { data: imports } = await supabase.from("omie_imports").select("*").in("company_id", compIds);
    let totalRec = 0, totalDesp = 0, totalEmp = 0, totalClientes = 0, totalProdutos = 0;
    const recCats: Record<string, number> = {};
    const despCats: Record<string, number> = {};
    const clienteNomes: Record<string, string> = {};
    const contasReceber: any[] = [];
    const contasPagar: any[] = [];
    let estoqueText = "Não importado.", vendasText = "Não importado.";

    if (imports) {
      for (const imp of imports) {
        if (imp.import_type === "clientes") {
          const cls = imp.import_data?.clientes_cadastro || [];
          if (Array.isArray(cls)) { totalClientes += cls.length; for (const c of cls) { const cod = c.codigo_cliente_omie || c.codigo_cliente || c.codigo; clienteNomes[String(cod)] = c.nome_fantasia || c.razao_social || c.nome || ""; } }
        }
        if (imp.import_type === "produtos") {
          const prods = imp.import_data?.produto_servico_cadastro || imp.import_data?.produtos || [];
          if (Array.isArray(prods)) totalProdutos += prods.length;
        }
        if (imp.import_type === "contas_receber") {
          const regs = imp.import_data?.conta_receber_cadastro || [];
          if (Array.isArray(regs)) { for (const r of regs) { const v = Number(r.valor_documento) || 0; const cat = r.codigo_categoria || "sem_cat"; const desc = r.descricao_categoria || cat; const status = r.status_titulo || ""; if (cat.startsWith("2.") || cat.startsWith("4.") || cat.startsWith("5.")) { totalEmp += v; } else { totalRec += v; recCats[desc] = (recCats[desc] || 0) + v; } contasReceber.push({ valor: v, vencimento: r.data_vencimento, status, cliente: clienteNomes[String(r.codigo_cliente_fornecedor)] || "N/I", categoria: desc }); } }
        }
        if (imp.import_type === "contas_pagar") {
          const regs = imp.import_data?.conta_pagar_cadastro || [];
          if (Array.isArray(regs)) { for (const r of regs) { const v = Number(r.valor_documento) || 0; const desc = r.descricao_categoria || r.codigo_categoria || "sem_cat"; totalDesp += v; despCats[desc] = (despCats[desc] || 0) + v; contasPagar.push({ valor: v, vencimento: r.data_vencimento, status: r.status_titulo || "", fornecedor: r.observacao || clienteNomes[String(r.codigo_cliente_fornecedor)] || "N/I", categoria: desc }); } }
        }
        if (imp.import_type === "estoque") {
          const est = imp.import_data?.produtos || imp.import_data || [];
          if (Array.isArray(est) && est.length > 0) { const tv = est.reduce((s: number, e: any) => s + (Number(e.saldo) || 0) * (Number(e.preco_unitario) || 0), 0); estoqueText = `${est.length} itens | Valor: ${fmtR(tv)}`; }
        }
        if (imp.import_type === "vendas") {
          const vds = imp.import_data?.pedido_venda_produto || imp.import_data?.vendas || [];
          if (Array.isArray(vds) && vds.length > 0) { const tv = vds.reduce((s: number, v: any) => s + (Number(v.total_pedido) || Number(v.valor_total) || 0), 0); vendasText = `${vds.length} pedidos | Total: ${fmtR(tv)}`; }
        }
      }
    }

    // Parciais do ERP integrado — serão consolidados com dados manuais abaixo

    // ── DADOS MANUAIS (m2_dre_divisional) — complementa ou substitui Omie ──
    const { data: dreDivData } = await supabase.from("m2_dre_divisional").select("*").in("company_id", compIds);
    let recManual = 0, despManual = 0;
    let dreDivText = "Não preenchido.";
    if (dreDivData && dreDivData.length > 0) {
      const porL: Record<string, any[]> = {};
      dreDivData.forEach(d => { const k = d.linha_negocio || d.nome_linha || "geral"; if (!porL[k]) porL[k] = []; porL[k].push(d); });
      dreDivText = Object.entries(porL).map(([l, ds]) => {
        const rec = ds.filter(d => d.tipo === "receita").reduce((s, d) => s + Number(d.valor || 0), 0);
        const cust = ds.filter(d => d.tipo === "custo" || d.tipo === "despesa").reduce((s, d) => s + Number(d.valor || 0), 0);
        recManual += rec;
        despManual += cust;
        return `${l} | Receita: ${fmtR(rec)} | Custos: ${fmtR(cust)} | Margem: ${fmtR(rec - cust)} (${pct(rec - cust, rec)})`;
      }).join("\n");
    }

    // ── CUSTOS SEDE (m3_dre_sede) ──
    const { data: sedeData } = await supabase.from("m3_dre_sede").select("*").in("company_id", compIds);
    let sedeText = "Não cadastrados.", totalSede = 0;
    if (sedeData && sedeData.length > 0) {
      totalSede = sedeData.reduce((s, c) => s + Number(c.valor || 0), 0);
      despManual += totalSede;
      sedeText = sedeData.sort((a: any, b: any) => Number(b.valor || 0) - Number(a.valor || 0)).map(c => `${c.nome || c.descricao || c.categoria}: ${fmtR(Number(c.valor))}/mês`).join("\n") + `\nTOTAL: ${fmtR(totalSede)}/mês`;
    }

    // ── CONSOLIDAÇÃO: USAR A MELHOR FONTE DISPONÍVEL ──
    // Se tem dados importados (Omie/ContaAzul/Bling) → usar importados como base
    // Se NÃO tem importados MAS tem manuais → usar manuais
    // Se tem ambos → somar (importados já incluem o período do ERP, manuais complementam)
    const fonteReceita = totalRec > 0 ? "ERP integrado" : recManual > 0 ? "entrada manual" : "sem dados";
    const fonteDespesa = totalDesp > 0 ? "ERP integrado" : despManual > 0 ? "entrada manual" : "sem dados";

    if (totalRec === 0 && recManual > 0) totalRec = recManual;
    if (totalDesp === 0 && despManual > 0) totalDesp = despManual;

    const resultado = totalRec - totalDesp;
    const margem = totalRec > 0 ? (resultado / totalRec * 100).toFixed(1) : "0";
    const topRec = Object.entries(recCats).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const topDesp = Object.entries(despCats).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const vencidas = contasReceber.filter(c => c.status !== "RECEBIDO" && c.status !== "PAGO" && c.vencimento && new Date(c.vencimento.split("/").reverse().join("-")) < new Date());
    const totalVencido = vencidas.reduce((s: number, c: any) => s + c.valor, 0);
    const clienteFat: Record<string, number> = {};
    contasReceber.forEach(c => { if (c.cliente !== "N/I") clienteFat[c.cliente] = (clienteFat[c.cliente] || 0) + c.valor; });
    const topClientes = Object.entries(clienteFat).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // 3. BALANCO PATRIMONIAL
    const { data: bpData } = await supabase.from("balanco_patrimonial").select("*").in("company_id", compIds);
    let bpText = "Não preenchido.";
    let ativoC = 0, ativoNC = 0, passC = 0, passNC = 0, pl = 0;
    if (bpData && bpData.length > 0) {
      const grupos: Record<string, { nome: string; valor: number }[]> = {};
      for (const item of bpData) {
        const g = `${item.lado?.toUpperCase()} — ${item.grupo}`; if (!grupos[g]) grupos[g] = []; const val = Number(item.valor) || 0; grupos[g].push({ nome: item.nome, valor: val });
        const gl = (item.grupo || "").toLowerCase(); const lado = (item.lado || "").toLowerCase();
        if (lado === "ativo" && gl.includes("circulante") && !gl.includes("não") && !gl.includes("nao")) ativoC += val;
        if (lado === "ativo" && (gl.includes("não circulante") || gl.includes("nao circulante"))) ativoNC += val;
        if (lado === "passivo" && gl.includes("circulante") && !gl.includes("não") && !gl.includes("nao") && !gl.includes("patrimônio") && !gl.includes("patrimonio")) passC += val;
        if (lado === "passivo" && (gl.includes("não circulante") || gl.includes("nao circulante"))) passNC += val;
        if (lado === "passivo" && (gl.includes("patrimônio") || gl.includes("patrimonio"))) pl += val;
      }
      bpText = Object.entries(grupos).map(([g, itens]) => { const total = itens.reduce((s, i) => s + i.valor, 0); return `${g} (${fmtR(total)}):\n${itens.filter(i => i.valor !== 0).map(i => `  ${i.nome}: ${fmtR(i.valor)}`).join("\n")}`; }).join("\n\n");
    }

    // 4. INDICADORES CALCULADOS
    const ativoT = ativoC + ativoNC; const passT = passC + passNC;
    const cg = ativoC - passC; const liqCorr = passC > 0 ? ativoC / passC : 0;
    const ebitda = resultado + (totalDesp * 0.03);
    const margEbitda = totalRec > 0 ? (ebitda / totalRec * 100) : 0;
    const roe = pl > 0 ? (resultado / pl * 100) : 0;
    const roa = ativoT > 0 ? (resultado / ativoT * 100) : 0;
    const divLiq = (passC + passNC) - ativoC;
    const divEbitda = ebitda > 0 ? divLiq / (ebitda * 12) : 0;

    const indicText = `Liquidez Corrente: ${liqCorr.toFixed(2)} ${liqCorr >= 1 ? "🟢" : liqCorr >= 0.8 ? "🟡" : "🔴"}\nCapital de Giro: ${fmtR(cg)} ${cg >= 0 ? "🟢" : "🔴"}\nAtivo Total: ${fmtR(ativoT)} | Passivo Total: ${fmtR(passT)} | PL: ${fmtR(pl)}\nEBITDA (período): ${fmtR(ebitda)} | Margem EBITDA: ${margEbitda.toFixed(1)}% ${margEbitda >= 15 ? "🟢" : margEbitda >= 8 ? "🟡" : "🔴"}\nROE: ${roe.toFixed(1)}% ${roe >= 15 ? "🟢" : roe >= 5 ? "🟡" : "🔴"} | ROA: ${roa.toFixed(1)}%\nDívida Líq/EBITDA: ${divEbitda.toFixed(2)}x ${divEbitda <= 2 ? "🟢" : divEbitda <= 3.5 ? "🟡" : "🔴"}\nInadimplência: ${fmtR(totalVencido)} (${pct(totalVencido, totalRec)})`;

    // 5. FINANCIAMENTOS
    const { data: finData } = await supabase.from("financiamentos").select("*").in("company_id", compIds);
    let finText = "Nenhum financiamento.", dividaBruta = 0;
    if (finData && finData.length > 0) { dividaBruta = finData.reduce((s, f) => s + Number(f.saldo_devedor || 0), 0); finText = finData.map(f => `${f.banco} | ${f.tipo} | Saldo: ${fmtR(Number(f.saldo_devedor))} | Taxa: ${f.taxa_mensal}% a.m. | Parc: ${f.parcelas_restantes}/${f.parcelas}`).join("\n") + `\nDívida Bruta: ${fmtR(dividaBruta)}`; }

    // 6. LINHAS DE NEGOCIO
    const { data: blData } = await supabase.from("business_lines").select("*").in("company_id", compIds);
    let blText = "Não configuradas.";
    if (blData && blData.length > 0) blText = blData.map(bl => `${bl.nome} | Tipo: ${bl.tipo || "N/I"} | Pessoas: ${bl.pessoas || 0}`).join("\n");

    // 7-8. DRE Divisional e Custos Sede já carregados acima na consolidação

    // 9. ORCAMENTO — CRUZAMENTO REAL vs ORÇADO
    const { data: orcData } = await supabase.from("orcamento").select("*").in("company_id", compIds);
    let orcText = "Não preenchido.";
    // Build orçado lookup by category
    const orcLookup: Record<string, number> = {};
    if (orcData && orcData.length > 0) {
      orcData.forEach(o => { if (o.categoria && o.valor_orcado) orcLookup[o.categoria] = Number(o.valor_orcado) || 0; });
    }

    // Cross-reference: for each DRE category (real), find the orçado value
    const allCats = new Set([...Object.keys(recCats), ...Object.keys(despCats), ...Object.keys(orcLookup)]);
    const orcComparativo: string[] = [];
    let totalOrcReceita = 0, totalOrcDespesa = 0, totalRealReceita = totalRec, totalRealDespesa = totalDesp;
    
    for (const cat of Array.from(allCats).sort()) {
      const real = (recCats[cat] || 0) + (despCats[cat] || 0);
      const orc = orcLookup[cat] || 0;
      if (real === 0 && orc === 0) continue;
      const varPct = orc > 0 ? ((real / orc - 1) * 100).toFixed(1) : "N/A";
      const status = orc > 0 ? (real <= orc ? "🟢" : real <= orc * 1.1 ? "🟡" : "🔴") : "";
      orcComparativo.push(`${cat}: Real ${fmtR(real)} | Orçado ${fmtR(orc)} | Var ${varPct}% ${status}`);
      if (recCats[cat]) totalOrcReceita += orc;
      if (despCats[cat]) totalOrcDespesa += orc;
    }

    if (orcComparativo.length > 0) {
      orcText = `RESUMO ORÇAMENTÁRIO:\nReceita Real: ${fmtR(totalRealReceita)} | Orçada: ${fmtR(totalOrcReceita)} ${totalOrcReceita > 0 ? `| Var: ${((totalRealReceita / totalOrcReceita - 1) * 100).toFixed(1)}%` : ""}\nDespesa Real: ${fmtR(totalRealDespesa)} | Orçada: ${fmtR(totalOrcDespesa)} ${totalOrcDespesa > 0 ? `| Var: ${((totalRealDespesa / totalOrcDespesa - 1) * 100).toFixed(1)}%` : ""}\n\nDETALHAMENTO POR CATEGORIA:\n${orcComparativo.join("\n")}`;
    }

    // 10. PLANO DE ACAO
    const { data: planosData } = await supabase.from("plano_acao").select("*").in("company_id", compIds).order("created_at", { ascending: false });
    let planosText = "Nenhum.";
    if (planosData && planosData.length > 0) { const pend = planosData.filter(p => p.status !== "concluido" && p.status !== "cancelado"); const conc = planosData.filter(p => p.status === "concluido"); planosText = `${planosData.length} ações | ${conc.length} concluídas | ${pend.length} pendentes\n` + pend.slice(0, 15).map(p => `${p.status === "atrasado" ? "🔴" : "🟡"} ${p.titulo || p.descricao} | Prazo: ${p.prazo || "N/I"} | Resp: ${p.responsavel || "N/I"}`).join("\n"); }

    // 11. FICHAS TECNICAS
    const { data: fichasData } = await supabase.from("fichas_tecnicas").select("*").in("company_id", compIds);
    let fichasText = "Não cadastradas.";
    if (fichasData && fichasData.length > 0) { const { data: fItens } = await supabase.from("ficha_itens").select("*").in("ficha_id", fichasData.map(f => f.id)); fichasText = fichasData.slice(0, 10).map(f => { const it = (fItens || []).filter(i => i.ficha_id === f.id); const ct = it.reduce((s, i) => s + (Number(i.quantidade || 0) * Number(i.preco_unitario || 0)), 0); return `${f.nome} | ${it.length} materiais | Custo: ${fmtR(ct)}`; }).join("\n") + `\nTotal fichas: ${fichasData.length}`; }

    // 12. BPO
    const { data: bpoData } = await supabase.from("bpo_classificacoes").select("*").in("company_id", compIds).limit(50);
    let bpoText = "Sem dados.";
    if (bpoData && bpoData.length > 0) { const auto = bpoData.filter(b => b.fonte === "ia" || b.automatico); bpoText = `${bpoData.length} lançamentos | ${auto.length} auto (IA) | ${bpoData.length - auto.length} manuais`; }

    // 13. CONCILIACAO
    const { data: concData } = await supabase.from("conciliacao_cartao").select("*").in("company_id", compIds);
    let concText = "Sem dados.";
    if (concData && concData.length > 0) concText = concData.map(c => `${c.operadora || "Cartão"} | ${c.periodo} | ${c.status}`).join("\n");

    // 14. CONTEXTO HUMANO
    const { data: ctxData } = await supabase.from("ai_reports").select("report_content").eq("report_type", "contexto_humano").order("created_at", { ascending: false }).limit(1);
    let ctxText = contexto_humano || "";
    if (ctxData && ctxData.length > 0 && ctxData[0].report_content) { const ct = ctxData[0].report_content; ctxText = typeof ct === "string" ? ct : JSON.stringify(ct); }

    // 15. FLUXO DE CAIXA
    const recFut = contasReceber.filter(c => c.status !== "RECEBIDO" && c.status !== "PAGO" && c.status !== "CANCELADO");
    const pagFut = contasPagar.filter(c => c.status !== "PAGO" && c.status !== "LIQUIDADO" && c.status !== "CANCELADO");
    const fluxoText = `A Receber pendente: ${recFut.length} títulos | ${fmtR(recFut.reduce((s: number, c: any) => s + c.valor, 0))}\nA Pagar pendente: ${pagFut.length} títulos | ${fmtR(pagFut.reduce((s: number, c: any) => s + c.valor, 0))}\nBurn rate: ${fmtR(totalDesp / 30)}/dia\nInadimplência: ${vencidas.length} títulos | ${fmtR(totalVencido)}`;

    // 16. TOP CLIENTES
    let topCliText = "Sem dados.";
    if (topClientes.length > 0) { const conc = totalRec > 0 ? (topClientes[0][1] as number / totalRec * 100).toFixed(1) : "0"; topCliText = topClientes.map(([n, v], i) => `${i + 1}. ${n}: ${fmtR(v as number)} (${pct(v as number, totalRec)})`).join("\n") + `\nConcentração maior cliente: ${conc}% ${Number(conc) > 30 ? "🔴" : Number(conc) > 20 ? "🟡" : "🟢"}\nTotal clientes: ${totalClientes}`; }

    // ══════════════════════════════════
    // MONTAGEM DOS BLOCOS
    // ══════════════════════════════════

    const blocos = `
═══ DADOS COMPLETOS DO ERP PS GESTÃO ═══
Período: ${periodo_inicio || "N/I"} a ${periodo_fim || "N/I"} | Gerado: ${new Date().toLocaleDateString("pt-BR")}

[BLOCO 0] EMPRESA
${compInfo} | Grupo: ${compIds.length} empresa(s) | ${totalClientes} clientes | ${totalProdutos} produtos

[BLOCO 1] CONTEXTO DO EMPRESÁRIO
${ctxText || "Não preenchido."}

[BLOCO 2] DRE CONSOLIDADO (fonte: ${fonteReceita} para receitas, ${fonteDespesa} para despesas)
Receita Operacional: ${fmtR(totalRec)}${totalOrcReceita > 0 ? ` | Orçada: ${fmtR(totalOrcReceita)} | Var: ${((totalRec / totalOrcReceita - 1) * 100).toFixed(1)}%` : ""} 
Empréstimos: ${fmtR(totalEmp)}
Despesas: ${fmtR(totalDesp)}${totalOrcDespesa > 0 ? ` | Orçadas: ${fmtR(totalOrcDespesa)} | Var: ${((totalDesp / totalOrcDespesa - 1) * 100).toFixed(1)}%` : ""}
${recManual > 0 && totalRec !== recManual ? `Receitas manuais (linhas de negócio): ${fmtR(recManual)}` : ""}
${despManual > 0 && totalDesp !== despManual ? `Despesas manuais (linhas + sede): ${fmtR(despManual)}` : ""}
RESULTADO: ${fmtR(resultado)} ${resultado >= 0 ? "🟢" : "🔴"} | Margem: ${margem}%
${totalOrcReceita > 0 && totalOrcDespesa > 0 ? `Resultado Orçado: ${fmtR(totalOrcReceita - totalOrcDespesa)} | Desvio do resultado: ${fmtR(resultado - (totalOrcReceita - totalOrcDespesa))}` : ""}

TOP 20 RECEITAS (Real | Orçado | Variação):
${topRec.map(([n, v], i) => { const orc = orcLookup[n] || 0; const varP = orc > 0 ? `Var ${((v as number / orc - 1) * 100).toFixed(1)}% ${v as number <= orc ? "🟢" : v as number <= orc * 1.1 ? "🟡" : "🔴"}` : "Sem orçamento"; return `${i + 1}. ${n}: Real ${fmtR(v as number)} (${pct(v as number, totalRec)}) | Orçado ${orc > 0 ? fmtR(orc) : "—"} | ${varP}`; }).join("\n") || "Sem dados"}

TOP 20 DESPESAS (Real | Orçado | Variação):
${topDesp.map(([n, v], i) => { const orc = orcLookup[n] || 0; const varP = orc > 0 ? `Var ${((v as number / orc - 1) * 100).toFixed(1)}% ${v as number <= orc ? "🟢" : v as number <= orc * 1.1 ? "🟡" : "🔴"}` : "Sem orçamento"; return `${i + 1}. ${n}: Real ${fmtR(v as number)} (${pct(v as number, totalDesp)}) | Orçado ${orc > 0 ? fmtR(orc) : "—"} | ${varP}`; }).join("\n") || "Sem dados"}

[BLOCO 3] LINHAS DE NEGÓCIO
${blText}
DRE Divisional:
${dreDivText}

[BLOCO 4] CUSTOS ESTRUTURA/SEDE
${sedeText}

[BLOCO 5] BALANÇO PATRIMONIAL
${bpText}
Resumo: AC ${fmtR(ativoC)} | ANC ${fmtR(ativoNC)} | PC ${fmtR(passC)} | PNC ${fmtR(passNC)} | PL ${fmtR(pl)}

[BLOCO 6] INDICADORES FUNDAMENTALISTAS
${indicText}

[BLOCO 7] DÍVIDA E FINANCIAMENTOS
${finText}

[BLOCO 8] FLUXO DE CAIXA
${fluxoText}

[BLOCO 9] TOP CLIENTES
${topCliText}

[BLOCO 10] ORÇAMENTO REAL vs PLANEJADO
${orcText}

[BLOCO 11] PLANO DE AÇÃO VIGENTE
${planosText}

[BLOCO 12] FICHAS TÉCNICAS
${fichasText}

[BLOCO 13] ESTOQUE: ${estoqueText} | VENDAS: ${vendasText}

[BLOCO 14] BPO: ${bpoText} | CONCILIAÇÃO: ${concText}

[BLOCO 15] VALUATION
EBITDA período: ${fmtR(ebitda)} | Anualizado: ${fmtR(ebitda * 12)} | PL: ${fmtR(pl)} | Receita anual: ${fmtR(totalRec * 12)} | Dívida: ${fmtR(dividaBruta)} | Setor: ${(companies || [])[0]?.setor || "N/I"}
Múltiplos: Serviços 5-8x, Comércio 4-6x, Indústria 6-10x, Tech 10-15x EBITDA
`;

    // ══════════════════════════════════
    // PROMPT V19 → CLAUDE API
    // ══════════════════════════════════

    const systemPrompt = `PROMPT MESTRE V19 — CEO EDITION — PS GESTÃO E CAPITAL
RELATÓRIO DE INTELIGÊNCIA EMPRESARIAL — 18 SLIDES EXECUTIVOS

Você é o Conselheiro de Administração e CFO Sênior. 25 anos de experiência em PMEs brasileiras.
Tom: formal, técnico, direto, corajoso. Se é ruim, diga que é ruim. Se é crítico, chame de crítico.
PROIBIDO: termos em inglês sem tradução, dados inventados, frases vagas, eufemismos.
USE EXCLUSIVAMENTE os dados dos BLOCOS fornecidos. Se ausente: [DADO NÃO DISPONÍVEL].

Cada slide: --- [SLIDE X — TÍTULO] ---
Emojis: 🟢 bom 🟡 atenção 🔴 crítico. Tabelas em Markdown. VEREDICTO ao final de cada slide.

18 SLIDES (máx 600 palavras cada):
1. PAINEL CEO — KPIs (receita, despesa, resultado, margem, EBITDA, clientes). Semáforo geral.
2. DRE ANALÍTICO — Receita, custos, margem bruta, despesas, EBITDA, resultado. Tabela + análise.
3. LINHAS DE NEGÓCIO — Faturamento, custo, margem por linha. Ranking rentabilidade. Usar BLOCOS 3.
4. MAPA DE CUSTOS — Top 20 despesas, % sobre receita, ABC. COMPARAR CADA DESPESA COM O ORÇADO (dados no BLOCO 2 e BLOCO 10). Semáforo: 🟢 dentro do orçado, 🟡 até 10% acima, 🔴 mais de 10% acima. Oportunidades de redução com R$.
5. CAPITAL DE GIRO — AC vs PC, liquidez corrente/seca, NCG, ciclo financeiro. Usar BLOCO 5 e 6.
6. FLUXO DE CAIXA — Receber vs pagar, projeção 30/60/90d, inadimplência, burn rate. BLOCO 8.
7. INDICADORES — PE, EBITDA, ROE, ROA, Dív/EBITDA, Liquidez. Semáforo cada. BLOCO 6.
8. ENDIVIDAMENTO — Perfil dívida, custo, capacidade pagamento, dívida/PL. BLOCO 7.
9. CLIENTES — Top 10, concentração, inadimplência, ticket médio, risco dependência. BLOCO 9.
10. PREÇOS — Markup, margem por produto (fichas técnicas), PE por linha. BLOCOS 3 e 12.
11. PARETO RECEITAS — 20% que gera 80%. Mix ideal. Oportunidades upsell.
12. MATRIZ DE RISCOS — 10 riscos dos dados. Probabilidade, impacto, mitigação.
13. ESG — Governança, social, ambiental inferidos. Oportunidades e riscos.
14. VALUATION — 3 métodos: múltiplo EBITDA, receita, FCD simples. Faixa de valor. BLOCO 15.
15. ORÇAMENTO vs REAL — Tabela: cada categoria com Real, Orçado, Variação R$ e %. Semáforo por linha. Top 5 maiores desvios. Aderência geral. Usar BLOCOS 2 e 10.
16. PLANO DE AÇÃO — Revisar existente (BLOCO 11) + 10 novas ações com prazo, responsável, R$.
17. METAS 90 DIAS — 10 metas SMART com indicador e checkpoint mensal.
18. CARTA AO ACIONISTA — 1 página formal. Diagnóstico honesto. Integrar contexto do empresário (BLOCO 1). Preocupações + avanços + recomendações. Assinar "PS — Conselheiro Digital".`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: "user", content: `DADOS COMPLETOS — GERE 18 SLIDES EXECUTIVOS:\n\n${blocos}` }],
      }),
    });

    const data = await response.json();
    if (data.error) return NextResponse.json({ error: `Claude API: ${data.error?.message || JSON.stringify(data.error)}` }, { status: 500 });
    const reportText = data.content?.map((c: any) => c.text || "").join("") || "Erro ao gerar.";

    // Auto-save to ai_reports for premium view
    try {
      await supabase.from("ai_reports").insert({
        company_id: compIds[0],
        report_type: "v19_ceo",
        report_content: reportText,
        metadata: { empresa: empresa_nome, periodo: `${periodo_inicio} a ${periodo_fim}`, slides: 18, fontes: 17, generated_at: new Date().toISOString() },
      });
    } catch {}

    return NextResponse.json({
      success: true, report: reportText, blocos_usados: blocos.length,
      fontes: { empresas: (companies || []).length, erp_imports: (imports || []).length, dados_manuais_dre: (dreDivData || []).length, custos_sede: (sedeData || []).length, balanco: (bpData || []).length, financ: (finData || []).length, linhas: (blData || []).length, orcamento: (orcData || []).length, planos: (planosData || []).length, fichas: (fichasData || []).length, bpo: (bpoData || []).length, conc: (concData || []).length, clientes: totalClientes, produtos: totalProdutos, contexto: ctxText ? "sim" : "nao", fonte_receita: fonteReceita, fonte_despesa: fonteDespesa },
    });
  } catch (error: any) {
    return NextResponse.json({ error: `Erro: ${error.message}` }, { status: 500 });
  }
}
