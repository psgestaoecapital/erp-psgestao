import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo';

export async function POST(req: NextRequest) {
  try {
    const { company_ids, categoria, tipo, periodo_inicio, periodo_fim } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase.from("omie_imports").select("*");
    if (company_ids?.length > 0) query = query.in("company_id", company_ids);
    
    const importType = tipo === "receita" ? "contas_receber" : "contas_pagar";
    query = query.eq("import_type", importType);
    
    const { data: imports, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!imports?.length) return NextResponse.json({ error: "Sem dados" }, { status: 404 });

    const arrayKey = tipo === "receita" ? "conta_receber_cadastro" : "conta_pagar_cadastro";
    const pInicio = periodo_inicio || "2020-01";
    const pFim = periodo_fim || "2030-12";
    
    // Load client/supplier names from clientes import
    const clienteNomes: Record<string, string> = {};
    const { data: clienteImports } = await supabase.from("omie_imports").select("import_data").in("company_id", company_ids).eq("import_type", "clientes");
    if (clienteImports) {
      for (const ci of clienteImports) {
        const clientes = ci.import_data?.clientes_cadastro || ci.import_data?.clientes || [];
        if (Array.isArray(clientes)) {
          for (const c of clientes) {
            const cod = c.codigo_cliente_omie || c.codigo_cliente || c.codigo;
            const nome = c.nome_fantasia || c.razao_social || c.nome || "";
            if (cod && nome) clienteNomes[String(cod)] = nome;
          }
        }
      }
    }

    const transactions: any[] = [];
    
    for (const imp of imports) {
      const regs = imp.import_data?.[arrayKey] || (Array.isArray(imp.import_data) ? imp.import_data : []);
      if (!Array.isArray(regs)) continue;
      for (const r of regs) {
        const cat = r.codigo_categoria || "sem_cat";
        if (categoria && cat !== categoria) continue;
        
        const dt = r.data_emissao || r.data_vencimento || r.data_previsao || "";
        const parts = dt.split("/");
        if (parts.length === 3) {
          let ano = parseInt(parts[2]);
          if (parts[2].length === 2) ano = 2000 + ano;
          const mes = parseInt(parts[1]);
          if (ano >= 2020 && ano <= 2030 && mes >= 1 && mes <= 12) {
            const mesKey = `${ano}-${String(mes).padStart(2,"0")}`;
            if (mesKey < pInicio || mesKey > pFim) continue;
          }
        }
        
        const codCF = String(r.codigo_cliente_fornecedor || r.codigo_cliente || "");
        
        transactions.push({
          valor: Number(r.valor_documento) || 0,
          data: dt,
          vencimento: r.data_vencimento || "",
          status: r.status_titulo || "",
          documento: r.numero_documento || r.numero_documento_fiscal || "",
          parcela: r.numero_parcela || "",
          cliente_fornecedor: codCF,
          nome_cf: clienteNomes[codCF] || r.nome_cliente || r.nome_fornecedor || "",
          observacao: r.observacao || r.descricao || "",
          categoria: cat,
          desc_categoria: r.descricao_categoria || "",
          nf: r.numero_documento_fiscal || r.numero_nf || "",
          pedido: r.numero_pedido || "",
        });
      }
    }
    
    // Sort by value descending
    transactions.sort((a, b) => b.valor - a.valor);
    
    // Summary
    const total = transactions.reduce((a, t) => a + t.valor, 0);
    const porStatus: Record<string, { count: number; valor: number }> = {};
    for (const t of transactions) {
      const s = t.status || "Sem status";
      if (!porStatus[s]) porStatus[s] = { count: 0, valor: 0 };
      porStatus[s].count++;
      porStatus[s].valor += t.valor;
    }
    
    const response = NextResponse.json({
      success: true,
      data: {
        total,
        count: transactions.length,
        por_status: porStatus,
        transacoes: transactions.slice(0, 50), // Top 50
      }
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
