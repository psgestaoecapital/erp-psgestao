import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo';

function parseMesAno(dt: string): string | null {
  if (!dt || typeof dt !== "string") return null;
  const p1 = dt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (p1) {
    const mes = parseInt(p1[2]);
    let ano = parseInt(p1[3]);
    if (p1[3].length === 2) ano = 2000 + ano;
    if (ano >= 2015 && ano <= 2035 && mes >= 1 && mes <= 12) return `${ano}-${String(mes).padStart(2, "0")}`;
  }
  const p2 = dt.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (p2) {
    const ano = parseInt(p2[1]); const mes = parseInt(p2[2]);
    if (ano >= 2015 && ano <= 2035 && mes >= 1 && mes <= 12) return `${ano}-${String(mes).padStart(2, "0")}`;
  }
  return null;
}

function fmtMes(key: string): string {
  const [a, m] = key.split("-");
  const n = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${n[parseInt(m) - 1]}/${a.slice(2)}`;
}

function classifyCat(cod: string, catRefMap?: Record<string, string>): string {
  if (!cod) return "outros";
  // Omie format: starts with digit + dot (e.g. "1.01", "2.03")
  if (/^\d\./.test(cod)) {
    if (cod.startsWith("1.")) return "receita";
    if (cod.startsWith("3.")) return "deducao";
    if (cod.startsWith("2.01") || cod.startsWith("2.02") || cod.startsWith("2.03")) return "custo_direto";
    if (cod.startsWith("2.")) return "despesa_adm";
    if (cod.startsWith("4.") || cod.startsWith("5.")) return "financeiro";
  }
  // Nibo format: UUID — look up referenceCode
  if (catRefMap && catRefMap[cod]) {
    const ref = catRefMap[cod];
    if (ref === "1") return "receita";
    if (ref === "2") return "custo_direto";
    if (ref === "3") return "despesa_adm";
    if (ref === "4") return "investimento";
    if (ref === "5") return "financeiro";
  }
  return "outros";
}

const STATUS_EXCLUIDOS = new Set([
  "CANCELADO", "CANCELADA", "ESTORNADO", "ESTORNADA",
  "DEVOLVIDO", "DEVOLVIDA", "ANULADO", "ANULADA",
  "REJEITADO", "REJEITADA", "CANCELAMENTO",
]);

function isStatusValido(status: string): boolean {
  return !STATUS_EXCLUIDOS.has((status || "").toUpperCase().trim());
}

export async function POST(req: NextRequest) {
  try {
    const { company_ids, periodo_inicio, periodo_fim, regime } = await req.json();
    const regimeCaixa = regime === "caixa";
    const supabase = createClient(supabaseUrl, supabaseKey);
    let query = supabase.from("omie_imports").select("*");
    if (company_ids?.length > 0) query = query.in("company_id", company_ids);
    const { data: rawImports, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rawImports?.length) return NextResponse.json({ error: "Sem dados" }, { status: 404 });

    // DEDUP: keep only most recent per (company_id, import_type)
    const importMap = new Map<string, any>();
    for (const imp of rawImports) {
      const key = `${imp.company_id}|${imp.import_type}`;
      const existing = importMap.get(key);
      if (!existing || new Date(imp.imported_at || 0) > new Date(existing.imported_at || 0)) importMap.set(key, imp);
    }
    const imports = Array.from(importMap.values());
    const duplicatasRemovidas = rawImports.length - imports.length;

    const pInicio = periodo_inicio || "2020-01";
    const pFim = periodo_fim || "2035-12";

    const catMap: Record<string, string> = {};
    const catRefMap: Record<string, string> = {};
    for (const cat of imports.filter((i: any) => i.import_type === "categorias")) {
      const regs = cat.import_data?.categoria_cadastro || (Array.isArray(cat.import_data) ? cat.import_data : []);
      if (Array.isArray(regs)) for (const c of regs) {
        const cod = c.codigo || c.cCodigo || c.cCodCateg || "";
        const desc = c.descricao || c.cDescricao || c.cDescrCateg || "";
        if (cod) catMap[cod] = desc || cod;
        if (cod && c.grupo_ref) catRefMap[cod] = c.grupo_ref;
      }
    }

    let audit = { registros_pagar_total: 0, registros_pagar_cancelados: 0, registros_pagar_validos: 0, registros_receber_total: 0, registros_receber_cancelados: 0, registros_receber_validos: 0, registros_sem_data: 0, duplicatas_removidas: duplicatasRemovidas, emprestimos_excluidos_receita: 0 };

    const despPorCat: Record<string, { nome: string; valor: number; tipo: string; meses: Record<string, number> }> = {};
    const despPorMes: Record<string, Record<string, number>> = {};
    let totalDesp = 0;

    for (const cp of imports.filter((i: any) => i.import_type === "contas_pagar")) {
      const regs = cp.import_data?.conta_pagar_cadastro || (Array.isArray(cp.import_data) ? cp.import_data : []);
      if (!Array.isArray(regs)) continue;
      for (const r of regs) {
        audit.registros_pagar_total++;
        const v = Number(r.valor_documento) || 0;
        if (v <= 0) continue;
        const status = (r.status_titulo || "").toUpperCase().trim();
        if (!isStatusValido(status)) { audit.registros_pagar_cancelados++; continue; }
        if (regimeCaixa && status !== "PAGO" && status !== "LIQUIDADO" && status !== "BAIXADO") continue;
        audit.registros_pagar_validos++;
        const cat = r.codigo_categoria || "sem_cat";
        const dt = regimeCaixa ? (r.data_pagamento || r.data_baixa || r.data_vencimento || r.data_previsao || r.data_emissao || "") : (r.data_previsao || r.data_vencimento || r.data_emissao || "");
        const ma = parseMesAno(dt);
        if (!ma) audit.registros_sem_data++;
        if (ma && (ma < pInicio || ma > pFim)) continue;
        const tipo = classifyCat(cat, catRefMap);
        totalDesp += v;
        if (!despPorCat[cat]) despPorCat[cat] = { nome: catMap[cat] || cat, valor: 0, tipo, meses: {} };
        despPorCat[cat].valor += v;
        if (ma) {
          despPorCat[cat].meses[ma] = (despPorCat[cat].meses[ma] || 0) + v;
          if (!despPorMes[ma]) despPorMes[ma] = {};
          despPorMes[ma][tipo] = (despPorMes[ma][tipo] || 0) + v;
          despPorMes[ma]["_total"] = (despPorMes[ma]["_total"] || 0) + v;
        }
      }
    }

    const recPorMes: Record<string, number> = {};
    const recOperacionalPorMes: Record<string, number> = {};
    const recPorCat: Record<string, { nome: string; valor: number; operacional: boolean; meses: Record<string, number> }> = {};
    let totalRec = 0, totalRecOperacional = 0, totalEmprestimos = 0;

    for (const cr of imports.filter((i: any) => i.import_type === "contas_receber")) {
      const regs = cr.import_data?.conta_receber_cadastro || (Array.isArray(cr.import_data) ? cr.import_data : []);
      if (!Array.isArray(regs)) continue;
      for (const r of regs) {
        audit.registros_receber_total++;
        const v = Number(r.valor_documento) || 0;
        if (v <= 0) continue;
        const statusRec = (r.status_titulo || "").toUpperCase().trim();
        if (!isStatusValido(statusRec)) { audit.registros_receber_cancelados++; continue; }
        if (regimeCaixa && statusRec !== "RECEBIDO" && statusRec !== "LIQUIDADO" && statusRec !== "BAIXADO") continue;
        audit.registros_receber_validos++;
        const cat = r.codigo_categoria || "sem_cat";
        const dt = regimeCaixa ? (r.data_pagamento || r.data_baixa || r.data_recebimento || r.data_vencimento || r.data_previsao || r.data_emissao || "") : (r.data_previsao || r.data_vencimento || r.data_emissao || "");
        const ma = parseMesAno(dt);
        if (!ma) audit.registros_sem_data++;
        if (ma && (ma < pInicio || ma > pFim)) continue;
        const nome = catMap[cat] || cat;
        const isOperacional = cat.startsWith("1.") && !nome.toLowerCase().includes("empréstimo") && !nome.toLowerCase().includes("financiamento") && !nome.toLowerCase().includes("aporte");
        const isEmprestimo = cat.startsWith("4.") || cat.startsWith("5.") || cat.startsWith("0.") || nome.toLowerCase().includes("empréstimo") || nome.toLowerCase().includes("financiamento") || nome.toLowerCase().includes("aporte") || nome.toLowerCase().includes("transferência");

        totalRec += v;
        if (isEmprestimo) { totalEmprestimos += v; audit.emprestimos_excluidos_receita++; } else { totalRecOperacional += v; }
        if (!recPorCat[cat]) recPorCat[cat] = { nome, valor: 0, operacional: !isEmprestimo, meses: {} };
        recPorCat[cat].valor += v;
        if (ma) {
          recPorCat[cat].meses[ma] = (recPorCat[cat].meses[ma] || 0) + v;
          recPorMes[ma] = (recPorMes[ma] || 0) + v;
          if (!isEmprestimo) recOperacionalPorMes[ma] = (recOperacionalPorMes[ma] || 0) + v;
        }
      }
    }

    const allM = [...new Set([...Object.keys(recOperacionalPorMes), ...Object.keys(despPorMes)])].sort();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const pastM = allM.filter(m => m <= currentMonth);

    const dreMensal = pastM.map(m => {
      const d = despPorMes[m] || {};
      const rec = recOperacionalPorMes[m] || 0;
      const cd = d.custo_direto || 0; const da = d.despesa_adm || 0; const dd = d.deducao || 0; const df = d.financeiro || 0; const di = d.investimento || 0; const dout = d.outros || 0;
      return { mes: m, mesLabel: fmtMes(m), receita: rec, deducoes: dd, custos_diretos: cd, despesas_adm: da, financeiro: df, investimentos: di, outros: dout, margem: rec - cd - dd, lucro_op: rec - cd - dd - da, lucro_final: rec - cd - dd - da - df - di - dout };
    });

    const chartMensal = pastM.slice(-12).map(m => ({
      mes: m, mesLabel: fmtMes(m),
      receitas: recOperacionalPorMes[m] || 0,
      despesas: despPorMes[m]?.["_total"] || 0,
      resultado: (recOperacionalPorMes[m] || 0) - (despPorMes[m]?.["_total"] || 0),
    }));

    const topCustos = Object.entries(despPorCat).map(([cod, v]) => ({ ...v, cod })).sort((a, b) => b.valor - a.valor).slice(0, 20);
    const topReceitas = Object.entries(recPorCat).map(([cod, v]) => ({ ...v, cod })).sort((a, b) => b.valor - a.valor).slice(0, 10);

    const gruposCusto: Record<string, { nome: string; total: number; contas: any[] }> = {};
    for (const info of Object.values(despPorCat)) {
      const g = info.tipo === "custo_direto" ? "Custos Diretos" : info.tipo === "despesa_adm" ? "Despesas Administrativas" : info.tipo === "deducao" ? "Deduções e Impostos" : info.tipo === "financeiro" ? "Resultado Financeiro" : info.tipo === "investimento" ? "Investimentos" : "Outros";
      if (!gruposCusto[g]) gruposCusto[g] = { nome: g, total: 0, contas: [] };
      gruposCusto[g].total += info.valor;
      gruposCusto[g].contas.push({ nome: info.nome, valor: info.valor, meses: info.meses });
    }
    for (const g of Object.values(gruposCusto)) g.contas.sort((a: any, b: any) => b.valor - a.valor);

    let orcMap: Record<string, number> = {};
    try {
      const { data: orcData } = await supabase.from("orcamento").select("categoria,valor_orcado,tipo").in("company_id", company_ids);
      if (orcData && orcData.length > 0) for (const o of orcData) { const key = (o.categoria || "").toLowerCase().trim(); orcMap[key] = (orcMap[key] || 0) + Number(o.valor_orcado || 0); }
    } catch { }

    for (const c of topCustos as any[]) { const key = (c.nome || "").toLowerCase().trim(); const cod = (c.cod || "").toLowerCase().trim(); c.orcado = orcMap[key] || orcMap[cod] || 0; c.variacao = c.orcado > 0 ? ((c.valor / c.orcado - 1) * 100) : null; }
    for (const r of topReceitas as any[]) { const key = (r.nome || "").toLowerCase().trim(); const cod = (r.cod || "").toLowerCase().trim(); r.orcado = orcMap[key] || orcMap[cod] || 0; r.variacao = r.orcado > 0 ? ((r.valor / r.orcado - 1) * 100) : null; }
    for (const g of Object.values(gruposCusto) as any[]) {
      g.orcado = g.contas.reduce((s: number, c: any) => s + (c.orcado || 0), 0);
      g.variacao = g.orcado > 0 ? ((g.total / g.orcado - 1) * 100) : null;
      for (const c of g.contas as any[]) { const key = (c.nome || "").toLowerCase().trim(); c.orcado = orcMap[key] || 0; c.variacao = c.orcado > 0 ? ((c.valor / c.orcado - 1) * 100) : null; }
    }
    const totalOrcadoDesp = Object.values(orcMap).reduce((s, v) => s + v, 0);

    let totalCli = 0;
    for (const cl of imports.filter((i: any) => i.import_type === "clientes")) totalCli += cl.record_count || 0;

    const resultado = totalRecOperacional - totalDesp;
    const margem = totalRecOperacional > 0 ? ((resultado / totalRecOperacional) * 100).toFixed(1) : "0";

    const response = NextResponse.json({
      success: true, data: {
        regime: regimeCaixa ? "caixa" : "competencia",
        total_receitas: totalRec, total_despesas: totalDesp,
        total_rec_operacional: totalRecOperacional, total_emprestimos: totalEmprestimos,
        resultado_periodo: resultado, margem,
        total_clientes: totalCli,
        num_empresas: new Set(imports.map((i: any) => i.company_id)).size,
        dre_mensal: dreMensal, chart_mensal: chartMensal,
        top_custos: topCustos, top_receitas: topReceitas,
        top_receitas_operacionais: Object.entries(recPorCat).filter(([, r]: any) => r.operacional).map(([cod, v]) => ({ ...v, cod })).sort((a: any, b: any) => b.valor - a.valor).slice(0, 10),
        top_emprestimos: Object.entries(recPorCat).filter(([, r]: any) => !r.operacional).map(([cod, v]) => ({ ...v, cod })).sort((a: any, b: any) => b.valor - a.valor).slice(0, 10),
        grupos_custo: Object.values(gruposCusto).sort((a, b) => b.total - a.total),
        total_orcado_despesas: totalOrcadoDesp,
        variacao_global: totalOrcadoDesp > 0 ? ((totalDesp / totalOrcadoDesp - 1) * 100).toFixed(1) : null,
        audit,
      }
    });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
