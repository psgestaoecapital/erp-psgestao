import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { company_ids } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase.from("omie_imports").select("*");
    if (company_ids && company_ids.length > 0) {
      query = query.in("company_id", company_ids);
    }
    const { data: imports, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!imports || imports.length === 0) return NextResponse.json({ error: "Sem dados" }, { status: 404 });

    let totalPagar = 0;
    const pagarPorCategoria: Record<string, number> = {};
    const pagarPorMes: Record<string, number> = {};

    for (const cp of imports.filter(i => i.import_type === "contas_pagar")) {
      const regs = cp.import_data?.conta_pagar_cadastro || cp.import_data?.contasPagar || [];
      if (Array.isArray(regs)) {
        for (const r of regs) {
          const valor = parseFloat(r.valor_documento || r.valor_titulo || r.nValor || 0);
          const cat = r.codigo_categoria || r.cCodCateg || "sem_cat";
          const dt = r.data_emissao || r.dDtEmissao || r.data_vencimento || r.dDtVenc || "";
          totalPagar += valor;
          pagarPorCategoria[cat] = (pagarPorCategoria[cat] || 0) + valor;
          if (dt) { const p = dt.split("/"); if (p.length === 3) pagarPorMes[`${p[1]}/${p[2]}`] = (pagarPorMes[`${p[1]}/${p[2]}`] || 0) + valor; }
        }
      }
    }

    let totalReceber = 0;
    const receberPorMes: Record<string, number> = {};

    for (const cr of imports.filter(i => i.import_type === "contas_receber")) {
      const regs = cr.import_data?.conta_receber_cadastro || cr.import_data?.contasReceber || [];
      if (Array.isArray(regs)) {
        for (const r of regs) {
          const valor = parseFloat(r.valor_documento || r.valor_titulo || r.nValor || 0);
          const dt = r.data_emissao || r.dDtEmissao || r.data_vencimento || r.dDtVenc || "";
          totalReceber += valor;
          if (dt) { const p = dt.split("/"); if (p.length === 3) receberPorMes[`${p[1]}/${p[2]}`] = (receberPorMes[`${p[1]}/${p[2]}`] || 0) + valor; }
        }
      }
    }

    let totalClientes = 0;
    for (const cl of imports.filter(i => i.import_type === "clientes")) totalClientes += cl.record_count || 0;

    const categorias: Record<string, string> = {};
    for (const cat of imports.filter(i => i.import_type === "categorias")) {
      const regs = cat.import_data?.categoria_cadastro || [];
      if (Array.isArray(regs)) for (const c of regs) categorias[c.codigo || c.cCodigo || ""] = c.descricao || c.cDescricao || "";
    }

    const topCustos = Object.entries(pagarPorCategoria)
      .map(([cod, val]) => ({ categoria: categorias[cod] || cod, valor: val }))
      .sort((a, b) => b.valor - a.valor).slice(0, 15);

    const meses = [...new Set([...Object.keys(pagarPorMes), ...Object.keys(receberPorMes)])].sort();
    const resumoMensal = meses.map(m => ({
      mes: m,
      receitas: receberPorMes[m] || 0,
      despesas: pagarPorMes[m] || 0,
      resultado: (receberPorMes[m] || 0) - (pagarPorMes[m] || 0),
    }));

    return NextResponse.json({
      success: true,
      data: {
        total_receitas: totalReceber,
        total_despesas: totalPagar,
        resultado_periodo: totalReceber - totalPagar,
        margem: totalReceber > 0 ? ((totalReceber - totalPagar) / totalReceber * 100).toFixed(1) : "0",
        total_clientes: totalClientes,
        num_empresas: new Set(imports.map(i => i.company_id)).size,
        top_custos: topCustos,
        resumo_mensal: resumoMensal,
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
