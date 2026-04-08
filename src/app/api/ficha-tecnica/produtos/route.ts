import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo';

export async function POST(req: NextRequest) {
  try {
    const { company_id, busca } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load products from Omie imports
    const { data: imports } = await supabase.from("omie_imports")
      .select("import_data").eq("company_id", company_id).eq("import_type", "produtos");

    const produtos: any[] = [];
    if (imports) {
      for (const imp of imports) {
        const regs = imp.import_data?.produto_servico_cadastro || imp.import_data?.produtos || [];
        if (Array.isArray(regs)) {
          for (const p of regs) {
            produtos.push({
              codigo_omie: p.codigo_produto || "",
              codigo: p.codigo || "",
              descricao: p.descricao || "",
              unidade: p.unidade || "UN",
              ncm: p.ncm || "",
              valor_unitario: Number(p.valor_unitario) || 0,
              preco_custo: Number(p.preco_custo) || Number(p.valor_unitario) || 0,
              marca: p.marca || "",
              modelo: p.modelo || "",
              peso_bruto: Number(p.peso_bruto) || 0,
              ativo: p.inativo !== "S",
            });
          }
        }
      }
    }

    // Load stock data if available
    const { data: estoqueImports } = await supabase.from("omie_imports")
      .select("import_data").eq("company_id", company_id).eq("import_type", "estoque");

    const estoque: Record<string, number> = {};
    if (estoqueImports) {
      for (const imp of estoqueImports) {
        const regs = imp.import_data?.produtos || [];
        if (Array.isArray(regs)) {
          for (const e of regs) {
            estoque[String(e.nCodProd || e.codigo_produto)] = Number(e.nSaldo) || 0;
          }
        }
      }
    }

    // Merge stock with products
    for (const p of produtos) {
      p.estoque = estoque[String(p.codigo_omie)] || 0;
    }

    // Filter if search term provided
    let filtered = produtos;
    if (busca && busca.trim()) {
      const term = busca.toLowerCase().trim();
      filtered = produtos.filter(p =>
        p.descricao.toLowerCase().includes(term) ||
        p.codigo.toLowerCase().includes(term) ||
        p.codigo_omie.toString().includes(term)
      );
    }

    // Sort by description
    filtered.sort((a, b) => a.descricao.localeCompare(b.descricao));

    return NextResponse.json({
      success: true,
      produtos: filtered.slice(0, 100),
      total: produtos.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
