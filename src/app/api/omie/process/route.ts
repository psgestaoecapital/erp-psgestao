import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function parseMesAno(dt: string): string | null {
  if (!dt || typeof dt !== "string") return null;
  // DD/MM/YYYY format (Omie standard)
  const p = dt.split("/");
  if (p.length === 3) {
    const mes = parseInt(p[1]);
    let ano = parseInt(p[2]);
    if (p[2].length === 2) ano = 2000 + ano;
    if (ano >= 2020 && ano <= 2030 && mes >= 1 && mes <= 12) {
      return `${ano}-${String(mes).padStart(2,"0")}`;
    }
  }
  return null;
}

function fmtMes(key: string): string {
  const [a,m] = key.split("-");
  const n = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${n[parseInt(m)-1]}/${a.slice(2)}`;
}

function classifyCat(cod: string): string {
  if (!cod) return "outros";
  if (cod.startsWith("1.")) return "receita";
  if (cod.startsWith("3.")) return "deducao";
  if (cod.startsWith("2.01") || cod.startsWith("2.02") || cod.startsWith("2.03")) return "custo_direto";
  if (cod.startsWith("2.")) return "despesa_adm";
  if (cod.startsWith("4.") || cod.startsWith("5.")) return "financeiro";
  return "outros";
}

export async function POST(req: NextRequest) {
  try {
    const { company_ids, periodo_inicio, periodo_fim } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseKey);
    let query = supabase.from("omie_imports").select("*");
    if (company_ids?.length > 0) query = query.in("company_id", company_ids);
    const { data: imports, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!imports?.length) return NextResponse.json({ error: "Sem dados" }, { status: 404 });

    // Period filter (YYYY-MM format)
    const pInicio = periodo_inicio || "2020-01";
    const pFim = periodo_fim || "2030-12";

    // Category name map - handle multiple Omie field name formats
    const catMap: Record<string, string> = {};
    for (const cat of imports.filter((i: any) => i.import_type === "categorias")) {
      const regs = cat.import_data?.categoria_cadastro || [];
      if (Array.isArray(regs)) {
        for (const c of regs) {
          const cod = c.codigo || c.cCodigo || c.cCodCateg || "";
          const desc = c.descricao || c.cDescricao || c.cDescrCateg || "";
          if (cod) catMap[cod] = desc || cod;
        }
      }
    }

    // === PROCESS CONTAS A PAGAR (DESPESAS) ===
    const despPorCat: Record<string, { nome: string; valor: number; tipo: string }> = {};
    const despPorMes: Record<string, Record<string, number>> = {};
    let totalDesp = 0;

    for (const cp of imports.filter((i: any) => i.import_type === "contas_pagar")) {
      const regs = cp.import_data?.conta_pagar_cadastro || [];
      if (!Array.isArray(regs)) continue;
      for (const r of regs) {
        // Omie fields: valor_documento (number), data_emissao (DD/MM/YYYY), codigo_categoria (string)
        const v = Number(r.valor_documento) || 0;
        if (v <= 0) continue;
        const cat = r.codigo_categoria || "sem_cat";
        const dt = r.data_emissao || r.data_vencimento || r.data_previsao || "";
        const ma = parseMesAno(dt);
        if (ma && (ma < pInicio || ma > pFim)) continue; // Period filter
        const tipo = classifyCat(cat);

        totalDesp += v;
        if (!despPorCat[cat]) despPorCat[cat] = { nome: catMap[cat] || cat, valor: 0, tipo };
        despPorCat[cat].valor += v;
        if (ma) {
          if (!despPorMes[ma]) despPorMes[ma] = {};
          despPorMes[ma][tipo] = (despPorMes[ma][tipo] || 0) + v;
          despPorMes[ma]["_total"] = (despPorMes[ma]["_total"] || 0) + v;
        }
      }
    }

    // === PROCESS CONTAS A RECEBER (RECEITAS) ===
    const recPorMes: Record<string, number> = {};
    const recPorCat: Record<string, { nome: string; valor: number; operacional: boolean }> = {};
    let totalRec = 0;
    let totalRecOperacional = 0;
    let totalEmprestimos = 0;

    for (const cr of imports.filter((i: any) => i.import_type === "contas_receber")) {
      const regs = cr.import_data?.conta_receber_cadastro || [];
      if (!Array.isArray(regs)) continue;
      for (const r of regs) {
        const v = Number(r.valor_documento) || 0;
        if (v <= 0) continue;
        const cat = r.codigo_categoria || "sem_cat";
        const dt = r.data_emissao || r.data_vencimento || r.data_previsao || "";
        const ma = parseMesAno(dt);
        if (ma && (ma < pInicio || ma > pFim)) continue; // Period filter
        const nome = catMap[cat] || cat;
        
        // Classify: operational revenue vs non-operational
        const isOperacional = cat.startsWith("1.") && !nome.toLowerCase().includes("empréstimo") && !nome.toLowerCase().includes("financiamento") && !nome.toLowerCase().includes("aporte");
        const isEmprestimo = cat.startsWith("4.") || cat.startsWith("5.") || cat.startsWith("0.") || 
          nome.toLowerCase().includes("empréstimo") || nome.toLowerCase().includes("financiamento") || 
          nome.toLowerCase().includes("aporte") || nome.toLowerCase().includes("transferência");

        totalRec += v;
        if (isEmprestimo) {
          totalEmprestimos += v;
        } else {
          totalRecOperacional += v;
        }
        
        if (!recPorCat[cat]) recPorCat[cat] = { nome, valor: 0, operacional: !isEmprestimo };
        recPorCat[cat].valor += v;
        if (ma) recPorMes[ma] = (recPorMes[ma] || 0) + v;
      }
    }

    // === BUILD DRE MENSAL ===
    const allM = [...new Set([...Object.keys(recPorMes), ...Object.keys(despPorMes)])].sort();
    
    // Filter: only months up to current month (exclude future dates)
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const pastM = allM.filter(m => m <= currentMonth);

    const dreMensal = pastM.map(m => {
      const d = despPorMes[m] || {};
      const rec = recPorMes[m] || 0;
      const cd = d.custo_direto || 0;
      const da = d.despesa_adm || 0;
      const dd = d.deducao || 0;
      const df = d.financeiro || 0;
      const dout = d.outros || 0;
      return {
        mes: m, mesLabel: fmtMes(m), receita: rec, deducoes: dd, custos_diretos: cd,
        despesas_adm: da, financeiro: df, outros: dout,
        margem: rec - cd - dd, lucro_op: rec - cd - dd - da,
        lucro_final: rec - cd - dd - da - df - dout
      };
    });

    // === CHART DATA (last 12 months) ===
    const chartMensal = pastM.slice(-12).map(m => ({
      mes: m, mesLabel: fmtMes(m),
      receitas: recPorMes[m] || 0,
      despesas: despPorMes[m]?.["_total"] || 0,
      resultado: (recPorMes[m] || 0) - (despPorMes[m]?.["_total"] || 0),
    }));

    // === TOP CUSTOS & RECEITAS ===
    const topCustos = Object.values(despPorCat).sort((a, b) => b.valor - a.valor).slice(0, 20);
    const topReceitas = Object.values(recPorCat).sort((a, b) => b.valor - a.valor).slice(0, 10);

    // === COST GROUPS (Mapa de Custos) ===
    const gruposCusto: Record<string, { nome: string; total: number; contas: any[] }> = {};
    for (const info of Object.values(despPorCat)) {
      const g = info.tipo === "custo_direto" ? "Custos Diretos" :
               info.tipo === "despesa_adm" ? "Despesas Administrativas" :
               info.tipo === "deducao" ? "Deduções e Impostos" :
               info.tipo === "financeiro" ? "Resultado Financeiro" : "Outros";
      if (!gruposCusto[g]) gruposCusto[g] = { nome: g, total: 0, contas: [] };
      gruposCusto[g].total += info.valor;
      gruposCusto[g].contas.push({ nome: info.nome, valor: info.valor });
    }
    for (const g of Object.values(gruposCusto)) g.contas.sort((a: any, b: any) => b.valor - a.valor);

    // Client count
    let totalCli = 0;
    for (const cl of imports.filter((i: any) => i.import_type === "clientes")) totalCli += cl.record_count || 0;

    // Debug info
    const catSample = imports.filter((i:any)=>i.import_type==="categorias")[0]?.import_data?.categoria_cadastro?.[0] || null;
    const debug = {
      meses_despesas: Object.keys(despPorMes).sort(),
      meses_receitas: Object.keys(recPorMes).sort(),
      registros_pagar: imports.filter((i:any)=>i.import_type==="contas_pagar").reduce((a:number,c:any)=>{
        const r = c.import_data?.conta_pagar_cadastro; return a + (Array.isArray(r)?r.length:0);
      },0),
      registros_receber: imports.filter((i:any)=>i.import_type==="contas_receber").reduce((a:number,c:any)=>{
        const r = c.import_data?.conta_receber_cadastro; return a + (Array.isArray(r)?r.length:0);
      },0),
      cat_map_size: Object.keys(catMap).length,
      cat_sample: catSample ? JSON.stringify(Object.keys(catSample).slice(0,5)) : "nenhum",
      cat_first_entry: Object.entries(catMap).slice(0,2).map(([k,v])=>`${k}=${v}`),
    };

    const response = NextResponse.json({ success: true, data: {
      total_receitas: totalRec, total_despesas: totalDesp,
      total_rec_operacional: totalRecOperacional,
      total_emprestimos: totalEmprestimos,
      resultado_periodo: totalRecOperacional - totalDesp,
      margem: totalRecOperacional > 0 ? ((totalRecOperacional - totalDesp) / totalRecOperacional * 100).toFixed(1) : "0",
      total_clientes: totalCli,
      num_empresas: new Set(imports.map((i: any) => i.company_id)).size,
      dre_mensal: dreMensal, chart_mensal: chartMensal,
      top_custos: topCustos,
      top_receitas: topReceitas,
      top_receitas_operacionais: Object.values(recPorCat).filter((r:any)=>r.operacional).sort((a:any,b:any)=>b.valor-a.valor).slice(0,10),
      top_emprestimos: Object.values(recPorCat).filter((r:any)=>!r.operacional).sort((a:any,b:any)=>b.valor-a.valor).slice(0,10),
      grupos_custo: Object.values(gruposCusto).sort((a, b) => b.total - a.total),
      debug,
    }});
    response.headers.set("Cache-Control","no-store, no-cache, must-revalidate");
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
