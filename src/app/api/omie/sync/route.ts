import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

async function omieCall(app_key: string, app_secret: string, endpoint: string, method: string, params: any = {}) {
  const res = await fetch(`https://app.omie.com.br/api/v1/${endpoint}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call: method, app_key, app_secret, param: [params] }),
  });
  return await res.json();
}

async function omieCallAllPages(app_key: string, app_secret: string, endpoint: string, method: string, arrayKey: string, extraParams: any = {}) {
  const allData: any[] = [];
  let page = 1;
  const perPage = 500;
  while (true) {
    const result = await omieCall(app_key, app_secret, endpoint, method, { pagina: page, registros_por_pagina: perPage, ...extraParams });
    const items = result[arrayKey];
    if (Array.isArray(items)) allData.push(...items);
    const totalPages = result.total_de_paginas || 1;
    if (page >= totalPages) break;
    page++;
    if (page > 50) break; // safety limit
  }
  return { [arrayKey]: allData, total: allData.length };
}

export async function POST(req: NextRequest) {
  try {
    const { app_key, app_secret, sync_type, company_id } = await req.json();

    if (!app_key || !app_secret) {
      return NextResponse.json({ error: "Chaves do Omie nao fornecidas" }, { status: 400 });
    }

    const supabase = company_id ? createClient(supabaseUrl, supabaseKey) : null;
    const results: any = {};
    const counts: Record<string, number> = {};
    const doAll = !sync_type || sync_type === "all" || sync_type === "full";

    // Helper: save to omie_imports
    const save = async (importType: string, data: any, count: number) => {
      if (!supabase || !company_id) return;
      // Delete previous import of same type
      await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", importType);
      // Insert new
      await supabase.from("omie_imports").insert({ company_id, import_type: importType, import_data: data, record_count: count });
      counts[importType] = count;
    };

    // 1. Company info
    if (doAll || sync_type === "empresa") {
      try {
        results.empresa = await omieCall(app_key, app_secret, "geral/empresas/", "ListarEmpresas", { pagina: 1, registros_por_pagina: 10 });
        await save("empresa", results.empresa, 1);
      } catch (e) { results.empresa_error = String(e); }
    }

    // 2. Categories
    if (doAll || sync_type === "categorias") {
      try {
        results.categorias = await omieCallAllPages(app_key, app_secret, "geral/categorias/", "ListarCategorias", "categoria_cadastro");
        await save("categorias", results.categorias, results.categorias?.total || 0);
      } catch (e) { results.categorias_error = String(e); }
    }

    // 3. Products
    if (doAll || sync_type === "produtos") {
      try {
        results.produtos = await omieCallAllPages(app_key, app_secret, "geral/produtos/", "ListarProdutos", "produto_servico_cadastro", { apenas_importado_api: "N" });
        await save("produtos", results.produtos, results.produtos?.total || 0);
      } catch (e) { results.produtos_error = String(e); }
    }

    // 4. Clients
    if (doAll || sync_type === "clientes") {
      try {
        results.clientes = await omieCallAllPages(app_key, app_secret, "geral/clientes/", "ListarClientes", "clientes_cadastro");
        await save("clientes", results.clientes, results.clientes?.total || 0);
      } catch (e) { results.clientes_error = String(e); }
    }

    // 5. Accounts Payable
    if (doAll || sync_type === "contas_pagar") {
      try {
        results.contas_pagar = await omieCallAllPages(app_key, app_secret, "financas/contapagar/", "ListarContasPagar", "conta_pagar_cadastro");
        await save("contas_pagar", results.contas_pagar, results.contas_pagar?.total || 0);
      } catch (e) { results.contas_pagar_error = String(e); }
    }

    // 6. Accounts Receivable
    if (doAll || sync_type === "contas_receber") {
      try {
        results.contas_receber = await omieCallAllPages(app_key, app_secret, "financas/contareceber/", "ListarContasReceber", "conta_receber_cadastro");
        await save("contas_receber", results.contas_receber, results.contas_receber?.total || 0);
      } catch (e) { results.contas_receber_error = String(e); }
    }

    // 7. Sales Orders
    if (doAll || sync_type === "vendas") {
      try {
        results.vendas = await omieCallAllPages(app_key, app_secret, "produtos/pedido/", "ListarPedidos", "pedido_venda_produto", { filtrar_por_etapa: "60" });
        await save("vendas", results.vendas, results.vendas?.total || 0);
      } catch (e) { results.vendas_error = String(e); }
    }

    // 8. Stock
    if (doAll || sync_type === "estoque") {
      try {
        results.estoque = await omieCall(app_key, app_secret, "estoque/consulta/", "ListarPosEstoque", { pagina: 1, registros_por_pagina: 500 });
        await save("estoque", results.estoque, 1);
      } catch (e) { results.estoque_error = String(e); }
    }

    // 9. Financial summary
    if (doAll || sync_type === "resumo") {
      try {
        results.resumo = await omieCall(app_key, app_secret, "financas/resumo/", "ObterResumoFinancas", {});
        await save("resumo", results.resumo, 1);
      } catch (e) { results.resumo_error = String(e); }
    }

    return NextResponse.json({ success: true, counts, company_id: company_id || null });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
