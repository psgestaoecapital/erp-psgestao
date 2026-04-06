import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function classifyCategory(codigo: string): string {
  if (!codigo) return "outros";
  if (codigo.startsWith("1.")) return "receita";
  if (codigo.startsWith("3.")) return "deducao";
  if (codigo.startsWith("2.01") || codigo.startsWith("2.02") || codigo.startsWith("2.03")) return "custo_direto";
  if (codigo.startsWith("2.")) return "despesa_adm";
  if (codigo.startsWith("4.") || codigo.startsWith("5.")) return "financeiro";
  return "outros";
}

function parseMesAno(dt: string): string | null {
  if (!dt) return null;
  const p = dt.split("/");
  return p.length === 3 ? p[1]+"/"+p[2] : null;
}

export async function POST(req: NextRequest) {
  try {
    const { company_ids } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseKey);
    let query = supabase.from("omie_imports").select("*");
    if (company_ids?.length > 0) query = query.in("company_id", company_ids);
    const { data: imports, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!imports?.length) return NextResponse.json({ error: "Sem dados" }, { status: 404 });

    const catMap: Record<string, string> = {};
    for (const cat of imports.filter((i: any) => i.import_type === "categorias")) {
      const regs = cat.import_data?.categoria_cadastro || [];
      if (Array.isArray(regs)) for (const c of regs) catMap[c.codigo || ""] = c.descricao || "";
    }

    const despPorCat: Record<string, { nome: string; valor: number; tipo: string }> = {};
    const despPorMes: Record<string, Record<string, number>> = {};
    let totalDesp = 0;

    for (const cp of imports.filter((i: any) => i.import_type === "contas_pagar")) {
      const regs = cp.import_data?.conta_pagar_cadastro || [];
      if (!Array.isArray(regs)) continue;
      for (const r of regs) {
        const v = parseFloat(r.valor_documento || r.nValor || 0);
        if (v <= 0) continue;
        const cat = r.codigo_categoria || r.cCodCateg || "sem_cat";
        const dt = r.data_emissao || r.dDtEmissao || r.data_vencimento || r.dDtVenc || "";
        const ma = parseMesAno(dt);
        const tipo = classifyCategory(cat);
        totalDesp += v;
        if (!despPorCat[cat]) despPorCat[cat] = { nome: catMap[cat] || cat, valor: 0, tipo };
        despPorCat[cat].valor += v;
        if (ma) { if (!despPorMes[ma]) despPorMes[ma] = {}; despPorMes[ma][tipo] = (despPorMes[ma][tipo] || 0) + v; }
      }
    }

    const recPorMes: Record<string, number> = {};
    const recPorCat: Record<string, { nome: string; valor: number }> = {};
    let totalRec = 0;

    for (const cr of imports.filter((i: any) => i.import_type === "contas_receber")) {
      const regs = cr.import_data?.conta_receber_cadastro || [];
      if (!Array.isArray(regs)) continue;
      for (const r of regs) {
        const v = parseFloat(r.valor_documento || r.nValor || 0);
        if (v <= 0) continue;
        const cat = r.codigo_categoria || r.cCodCateg || "sem_cat";
        const dt = r.data_emissao || r.dDtEmissao || r.data_vencimento || r.dDtVenc || "";
        const ma = parseMesAno(dt);
        totalRec += v;
        if (!recPorCat[cat]) recPorCat[cat] = { nome: catMap[cat] || cat, valor: 0 };
        recPorCat[cat].valor += v;
        if (ma) recPorMes[ma] = (recPorMes[ma] || 0) + v;
      }
    }

    const allM = [...new Set([...Object.keys(recPorMes), ...Object.keys(despPorMes)])].sort();

    const dreMensal = allM.map(m => {
      const d = despPorMes[m] || {};
      const rec = recPorMes[m] || 0;
      const cd = d.custo_direto || 0;
      const da = d.despesa_adm || 0;
      const dd = d.deducao || 0;
      const df = d.financeiro || 0;
      const dout = d.outros || 0;
      return { mes: m, receita: rec, deducoes: dd, custos_diretos: cd, despesas_adm: da, financeiro: df, outros: dout, margem: rec - cd - dd, lucro_op: rec - cd - dd - da, lucro_final: rec - cd - dd - da - df - dout };
    });

    const chartMensal = allM.slice(-12).map(m => ({
      mes: m, receitas: recPorMes[m] || 0,
      despesas: Object.values(despPorMes[m] || {}).reduce((a, v) => a + v, 0),
      resultado: (recPorMes[m] || 0) - Object.values(despPorMes[m] || {}).reduce((a, v) => a + v, 0),
    }));

    const topCustos = Object.values(despPorCat).sort((a, b) => b.valor - a.valor).slice(0, 20);
    const topReceitas = Object.values(recPorCat).sort((a, b) => b.valor - a.valor).slice(0, 10);

    const gruposCusto: Record<string, { nome: string; total: number; contas: any[] }> = {};
    for (const info of Object.values(despPorCat)) {
      const g = info.tipo === "custo_direto" ? "Custos Diretos" : info.tipo === "despesa_adm" ? "Despesas Administrativas" : info.tipo === "deducao" ? "Deduções e Impostos" : info.tipo === "financeiro" ? "Resultado Financeiro" : "Outros";
      if (!gruposCusto[g]) gruposCusto[g] = { nome: g, total: 0, contas: [] };
      gruposCusto[g].total += info.valor;
      gruposCusto[g].contas.push({ nome: info.nome, valor: info.valor });
    }
    for (const g of Object.values(gruposCusto)) g.contas.sort((a: any, b: any) => b.valor - a.valor);

    let totalCli = 0;
    for (const cl of imports.filter((i: any) => i.import_type === "clientes")) totalCli += cl.record_count || 0;

    return NextResponse.json({ success: true, data: {
      total_receitas: totalRec, total_despesas: totalDesp,
      resultado_periodo: totalRec - totalDesp,
      margem: totalRec > 0 ? ((totalRec - totalDesp) / totalRec * 100).toFixed(1) : "0",
      total_clientes: totalCli,
      num_empresas: new Set(imports.map((i: any) => i.company_id)).size,
      dre_mensal: dreMensal, chart_mensal: chartMensal,
      top_custos: topCustos, top_receitas: topReceitas,
      grupos_custo: Object.values(gruposCusto).sort((a, b) => b.total - a.total),
    }});
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
