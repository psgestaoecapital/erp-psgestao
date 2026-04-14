import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
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

    // 2. DADOS IMPORTADOS — com deduplicação e filtro de cancelados
    const { data: rawImports } = await supabase.from("omie_imports").select("*").in("company_id", compIds);
    // DEDUP: manter apenas o mais recente por (company_id, import_type)
    const impMap = new Map<string, any>();
    if (rawImports) for (const imp of rawImports) {
      const key = `${imp.company_id}|${imp.import_type}`;
      const existing = impMap.get(key);
      if (!existing || new Date(imp.imported_at || 0) > new Date(existing.imported_at || 0)) impMap.set(key, imp);
    }
    const imports = Array.from(impMap.values());

    const STATUS_EXCL = new Set(["CANCELADO","CANCELADA","ESTORNADO","ESTORNADA","DEVOLVIDO","DEVOLVIDA","ANULADO","ANULADA"]);

    let totalRec = 0, totalDesp = 0, totalEmp = 0, totalClientes = 0, totalProdutos = 0;
    const recCats: Record<string, number> = {};
    const despCats: Record<string, number> = {};
    const clienteNomes: Record<string, string> = {};
    const catRefMap: Record<string, string> = {};
    const contasReceber: any[] = [];
    const contasPagar: any[] = [];
    let estoqueText = "Não importado.", vendasText = "Não importado.";

    if (imports) {
      // Build catRefMap from categorias (for Nibo referenceCode)
      for (const imp of imports) {
        if (imp.import_type === "categorias") {
          const cats = imp.import_data?.categoria_cadastro || [];
          if (Array.isArray(cats)) for (const c of cats) {
            const cod = c.codigo || c.cCodigo || "";
            if (cod && c.grupo_ref) catRefMap[cod] = c.grupo_ref;
          }
        }
      }
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
          if (Array.isArray(regs)) { for (const r of regs) { const v = Number(r.valor_documento) || 0; if (v <= 0) continue; const st = (r.status_titulo || "").toUpperCase().trim(); if (STATUS_EXCL.has(st)) continue; const cat = r.codigo_categoria || "sem_cat"; const desc = r.descricao_categoria || cat; const status = r.status_titulo || ""; const descL = desc.toLowerCase(); const ref = catRefMap[cat] || ""; const isFinanceiro = cat.startsWith("4.") || cat.startsWith("5.") || ref === "4" || ref === "5" || descL.includes("empréstimo") || descL.includes("financiamento") || descL.includes("aporte") || descL.includes("transferência") || descL.includes("contratação de emprestimo"); if (isFinanceiro) { totalEmp += v; } else { totalRec += v; recCats[desc] = (recCats[desc] || 0) + v; } contasReceber.push({ valor: v, vencimento: r.data_vencimento, status, cliente: clienteNomes[String(r.codigo_cliente_fornecedor)] || r.nome_cliente || "N/I", categoria: desc }); } }
        }
        if (imp.import_type === "contas_pagar") {
          const regs = imp.import_data?.conta_pagar_cadastro || [];
          if (Array.isArray(regs)) { for (const r of regs) { const v = Number(r.valor_documento) || 0; if (v <= 0) continue; const st = (r.status_titulo || "").toUpperCase().trim(); if (STATUS_EXCL.has(st)) continue; const desc = r.descricao_categoria || r.codigo_categoria || "sem_cat"; totalDesp += v; despCats[desc] = (despCats[desc] || 0) + v; contasPagar.push({ valor: v, vencimento: r.data_vencimento, status: r.status_titulo || "", fornecedor: r.nome_fornecedor || clienteNomes[String(r.codigo_cliente_fornecedor)] || r.observacao || "N/I", categoria: desc }); } }
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
    const vencidas = contasReceber.filter(c => {
      if (c.status === "RECEBIDO" || c.status === "PAGO") return false;
      if (!c.vencimento) return false;
      let dt: Date;
      const v = String(c.vencimento);
      if (v.includes("T")) dt = new Date(v.split("T")[0]);
      else if (v.includes("/")) dt = new Date(v.split("/").reverse().join("-"));
      else dt = new Date(v);
      return !isNaN(dt.getTime()) && dt < new Date();
    });
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

    // 4. DRE CLASSIFICADO (deve vir ANTES dos indicadores)
    const dreClassificado: Record<string, { nome: string; valor: number; grupo: string }[]> = { custo_direto: [], despesa_adm: [], financeiro: [], investimento: [], outros: [] };
    for (const [desc, valor] of Object.entries(despCats)) {
      const cat = Object.keys(catRefMap).find(k => {
        const catDesc = imports?.find(i => i.import_type === "categorias")?.import_data?.categoria_cadastro?.find((c: any) => (c.codigo || c.cCodigo) === k)?.descricao;
        return catDesc === desc;
      });
      const ref = cat ? catRefMap[cat] : "";
      let grupo = "outros";
      if (ref === "2") grupo = "custo_direto";
      else if (ref === "3") grupo = "despesa_adm";
      else if (ref === "4") grupo = "investimento";
      else if (ref === "5") grupo = "financeiro";
      else {
        const d = desc.toLowerCase();
        if (d.includes("compra") || d.includes("mercadoria") || d.includes("insumo") || d.includes("materia") || d.includes("frete") || d.includes("montagem") || d.includes("icms") || d.includes("pis") || d.includes("cofins") || d.includes("iss")) grupo = "custo_direto";
        else if (d.includes("emprestimo") || d.includes("empréstimo") || d.includes("financiamento") || d.includes("consórcio") || d.includes("consorcio") || d.includes("parcelado") || d.includes("juros")) grupo = "financeiro";
        else if (d.includes("imobilizado") || d.includes("veiculo") || d.includes("veículo") || d.includes("computador") || d.includes("melhoria")) grupo = "investimento";
        else grupo = "despesa_adm";
      }
      dreClassificado[grupo].push({ nome: desc, valor: valor as number, grupo });
    }
    const totalCD = dreClassificado.custo_direto.reduce((s, d) => s + d.valor, 0);
    const totalDA = dreClassificado.despesa_adm.reduce((s, d) => s + d.valor, 0);
    const totalFin = dreClassificado.financeiro.reduce((s, d) => s + d.valor, 0);
    const totalInv = dreClassificado.investimento.reduce((s, d) => s + d.valor, 0);
    const margemBruta = totalRec - totalCD;
    const lucroOp = margemBruta - totalDA;
    const lucroFinal = lucroOp - totalFin - totalInv;

    // 5. INDICADORES CALCULADOS
    const ativoT = ativoC + ativoNC; const passT = passC + passNC;
    const cg = ativoC - passC; const liqCorr = passC > 0 ? ativoC / passC : 0;
    const ebitda = resultado + (totalDesp * 0.03);
    const margEbitda = totalRec > 0 ? (ebitda / totalRec * 100) : 0;
    const roe = pl > 0 ? (resultado / pl * 100) : 0;
    const roa = ativoT > 0 ? (resultado / ativoT * 100) : 0;
    const divLiq = (passC + passNC) - ativoC;
    const divEbitda = ebitda > 0 ? divLiq / (ebitda * 12) : 0;

    const indicText = `Liquidez Corrente: ${liqCorr.toFixed(2)} ${liqCorr >= 1 ? "🟢" : liqCorr >= 0.8 ? "🟡" : "🔴"}\nCapital de Giro: ${fmtR(cg)} ${cg >= 0 ? "🟢" : "🔴"}\nAtivo Total: ${fmtR(ativoT)} | Passivo Total: ${fmtR(passT)} | PL: ${fmtR(pl)}\nMargem Bruta: ${pct(margemBruta, totalRec)} ${margemBruta / totalRec >= 0.3 ? "🟢" : margemBruta / totalRec >= 0.15 ? "🟡" : "🔴"}\nEBITDA (período): ${fmtR(lucroOp)} | Margem EBITDA: ${totalRec > 0 ? (lucroOp / totalRec * 100).toFixed(1) : "0"}% ${lucroOp / totalRec >= 0.15 ? "🟢" : lucroOp / totalRec >= 0.08 ? "🟡" : "🔴"}\nROE: ${roe.toFixed(1)}% ${roe >= 15 ? "🟢" : roe >= 5 ? "🟡" : "🔴"} | ROA: ${roa.toFixed(1)}%\nDívida Líq/EBITDA: ${divEbitda.toFixed(2)}x ${divEbitda <= 2 ? "🟢" : divEbitda <= 3.5 ? "🟡" : "🔴"}\nInadimplência: ${fmtR(totalVencido)} (${pct(totalVencido, totalRec)})\nLucro Final: ${fmtR(lucroFinal)} (${pct(lucroFinal, totalRec)}) ${lucroFinal >= 0 ? "🟢" : "🔴"}\nBurn Rate Diário: ${fmtR(totalDesp / 30)}`;

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

    // ── DRE CLASSIFICADO TEXT (uses variables computed above) ──
    const dreClassText = `RECEITA BRUTA: ${fmtR(totalRec)}
(-) CUSTOS DIRETOS: ${fmtR(totalCD)} (${pct(totalCD, totalRec)})
= MARGEM BRUTA: ${fmtR(margemBruta)} (${pct(margemBruta, totalRec)}) ${margemBruta >= 0 ? "🟢" : "🔴"}
(-) DESPESAS ADMINISTRATIVAS: ${fmtR(totalDA)} (${pct(totalDA, totalRec)})
= LUCRO OPERACIONAL: ${fmtR(lucroOp)} (${pct(lucroOp, totalRec)}) ${lucroOp >= 0 ? "🟢" : "🔴"}
(-) RESULTADO FINANCEIRO: ${fmtR(totalFin)} (${pct(totalFin, totalRec)})
(-) INVESTIMENTOS: ${fmtR(totalInv)} (${pct(totalInv, totalRec)})
= LUCRO FINAL: ${fmtR(lucroFinal)} (${pct(lucroFinal, totalRec)}) ${lucroFinal >= 0 ? "🟢" : "🔴"}

CUSTOS DIRETOS (detalhamento):
${dreClassificado.custo_direto.sort((a, b) => b.valor - a.valor).map((d, i) => `${i + 1}. ${d.nome}: ${fmtR(d.valor)} (${pct(d.valor, totalRec)})`).join("\n") || "Sem dados"}

DESPESAS ADMINISTRATIVAS (detalhamento):
${dreClassificado.despesa_adm.sort((a, b) => b.valor - a.valor).map((d, i) => `${i + 1}. ${d.nome}: ${fmtR(d.valor)} (${pct(d.valor, totalRec)})`).join("\n") || "Sem dados"}

RESULTADO FINANCEIRO (detalhamento):
${dreClassificado.financeiro.sort((a, b) => b.valor - a.valor).map((d, i) => `${i + 1}. ${d.nome}: ${fmtR(d.valor)} (${pct(d.valor, totalRec)})`).join("\n") || "Sem dados"}

INVESTIMENTOS (detalhamento):
${dreClassificado.investimento.sort((a, b) => b.valor - a.valor).map((d, i) => `${i + 1}. ${d.nome}: ${fmtR(d.valor)} (${pct(d.valor, totalRec)})`).join("\n") || "Sem dados"}

Empréstimos/Financiamentos excluídos da receita: ${fmtR(totalEmp)}`;

    const blocos = `
═══ DADOS COMPLETOS DO ERP PS GESTÃO ═══
Período: ${periodo_inicio || "N/I"} a ${periodo_fim || "N/I"} | Gerado: ${new Date().toLocaleDateString("pt-BR")}

[BLOCO 0] EMPRESA
${compInfo} | Grupo: ${compIds.length} empresa(s) | ${totalClientes} clientes | ${totalProdutos} produtos

[BLOCO 1] CONTEXTO DO EMPRESÁRIO
${ctxText || "Não preenchido."}

[BLOCO 2] DRE ANALÍTICO CLASSIFICADO (fonte: ${fonteReceita} para receitas, ${fonteDespesa} para despesas)
${dreClassText}

RECEITAS POR CATEGORIA (Top 20):
${topRec.map(([n, v], i) => { const orc = orcLookup[n] || 0; const varP = orc > 0 ? `Var ${((v as number / orc - 1) * 100).toFixed(1)}% ${v as number <= orc ? "🟢" : v as number <= orc * 1.1 ? "🟡" : "🔴"}` : "Sem orçamento"; return `${i + 1}. ${n}: Real ${fmtR(v as number)} (${pct(v as number, totalRec)}) | Orçado ${orc > 0 ? fmtR(orc) : "—"} | ${varP}`; }).join("\n") || "Sem dados"}

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
    // PROMPT V20 — CEO EDITION → CLAUDE API
    // ══════════════════════════════════

    const systemPrompt = `PROMPT MESTRE V20 — COMÉRCIO E SERVIÇO EDITION — PS GESTÃO E CAPITAL
PAINEL DE INTELIGÊNCIA EMPRESARIAL COMPLETA — 20 SLIDES EXECUTIVOS
15 Módulos | 12 Linhas de Negócio | Rateio Proporcional por Receita

[PROTOCOLO 0 — ISOLAMENTO E IDENTIDADE]
Desconsidere qualquer dado de conversas anteriores. Dados válidos: EXCLUSIVAMENTE os BLOCOS fornecidos.
Você é o Conselheiro de Administração e CFO Sênior da empresa analisada. 25 anos de experiência em reestruturação, M&A e governança de empresas de comércio e serviço no Brasil.
Você conhece profundamente: gestão de múltiplas linhas de negócio, rateio de custos compartilhados, precificação por markup e ficha técnica, gestão de estoque e curva ABC, ciclo financeiro do varejo e serviço, canais de venda (loja física, e-commerce, marketplace, representantes), sazonalidade comercial, capital de giro intensivo em comércio, e análise de rentabilidade real por unidade de negócio.
Você não apenas analisa — você DECIDE, COBRA e RESPONSABILIZA.
DIFERENCIAL V20: Método de RATEIO PROPORCIONAL POR RECEITA da PS Gestão e Capital. Custo total sede distribuído a cada LN proporcionalmente à sua participação na receita total. Revela o LUCRO OPERACIONAL REAL de cada LN.

[PROTOCOLO 1 — TOM EXECUTIVO INQUEBRÁVEL]
Tom: formal, técnico, direto, corajoso. Sem eufemismos. PROIBIDO: termos em inglês sem tradução, gírias, frases vagas. Se é ruim, diga que é ruim. Se é crítico, chame de crítico. O cliente paga por verdade, não por conforto.

[PROTOCOLO 2 — PRECISÃO MATEMÁTICA]
REGRA 1: Receita Bruta = APENAS faturamento operacional. REGRA 2: Antecipação de recebíveis NÃO é receita. REGRA 3: Serviço da Dívida = Principal + Juros + Consórcio. REGRA 4: EBITDA = Lucro antes de Juros, IR, Depreciação e Amortização. REGRA 5: CGL = AC - PC. REGRA 6: NCG(dias) = PMR + PME - PMP. REGRA 7: Dívida Líquida = Dívida Bruta - Caixa. REGRA 8: VL Acionista = Valor Empresa - Dívida Líquida. REGRA 9: ROIC = EBIT(1-t)/(PL+DL). REGRA 10: Burn Rate = Custos Mensais/30. REGRA 11: Nunca interpolar dados ausentes sem sinalizar. REGRA 12: Campo ausente = sinalizar lacuna + quantificar impacto.
REGRA 13: Rateio LN = Custo Sede × (Receita LN / Receita Total). REGRA 14: Lucro Operacional LN = MC LN - Rateio Sede LN. REGRA 15: CMV% ideal: Comércio 40-60%, Serviço <20%. REGRA 16: Markup Real = (Preço - Custo Total c/ rateio) / Custo Total × 100. REGRA 17: Receita/m² benchmark: R$800-2.500/m²/mês. REGRA 18: Taxa Conversão: Varejo >25%, Serviço >35%. REGRA 19: Ciclo Financeiro = PMR + PME - PMP + Prazo Cartão. REGRA 20: LTV = Ticket × Frequência × Permanência.

[PROTOCOLO 3 — 8 CRUZAMENTOS OBRIGATÓRIOS]
1. DRE vs Orçado: desvio R$ e %. 2. DRE vs Balanço: lucro DRE = variação PL. 3. DRE vs DFC: EBITDA > FCO = caixa se dissipa onde? 4. Qualitativo vs Quantitativo. 5. Atual vs Período Anterior. 6. Empresa vs Benchmarks Setoriais. 7. MC vs Lucro Real por LN (após rateio). 8. Canal de Venda vs Rentabilidade.

[PROTOCOLO 4 — FORMATAÇÃO]
Cada slide: --- [SLIDE X — TÍTULO] --- Emojis: 🟢 bom 🟡 atenção 🔴 crítico. Tabelas Markdown. Mínimo 4 linhas análise real por parecer. VEREDICTO ao final de cada slide.

ESTRUTURA DOS 20 SLIDES:
1. PAINEL EXECUTIVO CEO — KPIs gerenciais com Realizado/Orçado/Benchmark. Semáforo (3 positivos, 3 atenção, 3 críticos). Veredicto e 3 alertas prioritários.
2. DESEMPENHO COMERCIAL E BCG — Tabela por LN (Fat/Ticket/Volume/MC/Rateio/Lucro Real/BCG). Concentração clientes. Funil. LTV/CAC. 5 alavancas de receita.
3. BALANÇO PATRIMONIAL — AC/ANC/PC/PNC/PL. Aging recebíveis. Estoques por LN. Endividamento geral. 3 principais movimentos patrimoniais.
4. DRE ANALÍTICO COMPLETO — Linha a linha: Receita por LN → Deduções → ROL → CMV → MOD → MC → Custo Sede (rateado) → EBITDA → EBIT → Resultado. Desvio vs orçado. PE operacional.
5. CAPITAL DE GIRO E CICLO FINANCEIRO — PMR/PME/PMP/NCG/CGL/Liquidez/Burn Rate. Mix formas pagamento. Impacto cartão crédito na NCG. 3 ações otimização.
6. FLUXO DE CAIXA — FCO/FCI/FCF. EBITDA vs FCO. Qualidade do resultado. Projeção 3 meses.
7. ESTRUTURA DE CAPITAL — 12 indicadores risco. Dívida/EBITDA. Cobertura. Taxa média. Plano passivo bancário (5 ações).
8. PESSOAS E PRODUTIVIDADE — Por LN + retaguarda. HC/Receita/Custo por colab. Turnover. Produtividade vendedor. 5 pontos cegos.
9. PARETO DE CUSTOS — Top 10 ofensores. Agrupamento macro. Orçamento teto. Normalizar custo/R$ receita por LN.
10. RADAR CONFORMIDADE 360° — Governança, tributário, CDC, LGPD, estoque, documentação. Semáforo cada item. Ação corretiva para cada 🔴.
11. INTELIGÊNCIA ESTRATÉGICA — SWOT profundo com evidência numérica. Barreiras entrada. 3 OKRs trimestre.
12. ESG — Ambiental/Social/Governança. Score. Plano ESG 3 trimestres.
13. TECNOLOGIA E DIGITAL — Maturidade digital 1-5. ERP, CRM, e-commerce, automação. Roadmap 12 meses.
14. MATRIZ DE RISCO — 12 dimensões incluindo estoque obsoleto e dependência fornecedor. Score ponderado. Top 3 com contingência.
15. VALUATION — 5 métodos: EBITDA, Receita, Patrimonial, Carteira, Marca. ROE/ROA/ROIC/WACC. Valor Líquido Acionista.
16. CANAIS, OPERAÇÃO E RENTABILIDADE POR LN — SLIDE MAIS IMPORTANTE. Tabela: LN/Receita/CMV/MC/Rateio Sede/Lucro Real/%. Para cada LN com lucro negativo: 3 opções (repricing, reestruturação, descontinuação). Ranking contribuição real.
17. FORMAÇÃO DE PREÇO E COMPETITIVIDADE — Markup real por LN (incluindo rateio). CMV% por LN. Curva ABC. Sensibilidade preço/CMV/volume.
18. PLANO DE AÇÃO E REESTRUTURAÇÃO — Mínimo 25 ações com prazo, responsável e impacto R$. Incluir ações de TODOS os slides anteriores.
19. CARTA AO ACIONISTA — Carta formal. Diagnóstico honesto. Referência ao rateio. 3 decisões urgentes ESTA SEMANA. Visão 24 meses. Assinar "PS — Conselheiro Digital".
20. METAS E PRÓXIMOS 90 DIAS — Tabela: KPI/Meta Mínima/Ideal/Ousada. 3 OKRs. Ritmo reuniões. KPIs semanais.

REGRA FINAL: Gere TODOS os 20 slides sem exceção. Nunca pule. Nunca resuma. Se dado ausente: sinalize lacuna com impacto. Mínimo 4 linhas análise real por parecer. Escreva como quem tem assento no Conselho e responde pelo resultado. O empresário NUNCA recebeu algo assim antes. A Carta ao Acionista é o slide que gera indicação — escreva como se estivesse assinando com sua reputação.`;

    // ═══ CALL CLAUDE (com retry automático) ═══
    let data: any = null;
    let lastError = "";
    const reqBody = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 24000,
      system: systemPrompt,
      messages: [{ role: "user", content: `DADOS COMPLETOS — GERE 20 SLIDES EXECUTIVOS V20:\n\n${blocos}` }],
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: reqBody,
        });
        data = await response.json();
        if (data.error) {
          const msg = data.error?.message || JSON.stringify(data.error);
          if ((msg.includes("Overloaded") || msg.includes("overloaded") || msg.includes("529")) && attempt < 3) {
            lastError = msg;
            await new Promise(r => setTimeout(r, 5000 * attempt));
            continue;
          }
          lastError = msg;
        } else { break; }
      } catch (e: any) { lastError = e.message; if (attempt < 3) await new Promise(r => setTimeout(r, 3000)); }
    }

    if (!data || data.error) {
      const msg = lastError || "Erro desconhecido";
      let friendly = "";
      if (msg.includes("Overloaded") || msg.includes("overloaded")) friendly = "O servidor de IA está temporariamente sobrecarregado. Tentamos 3 vezes. Aguarde 2-3 minutos e tente novamente.";
      else if (msg.includes("rate")) friendly = "Muitas solicitações. Aguarde 1 minuto.";
      else friendly = "Erro temporário na IA. Tente novamente em alguns minutos.";
      return NextResponse.json({ error: `⚠️ ${friendly}` }, { status: 503 });
    }

    const reportText = data.content?.map((c: any) => c.text || "").join("") || "Erro ao gerar.";

    // Auto-save to ai_reports for premium view
    try {
      await supabase.from("ai_reports").insert({
        company_id: compIds[0],
        report_type: "v20_ceo",
        report_content: reportText,
        metadata: { empresa: empresa_nome, periodo: `${periodo_inicio} a ${periodo_fim}`, slides: 20, fontes: 17, generated_at: new Date().toISOString() },
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
