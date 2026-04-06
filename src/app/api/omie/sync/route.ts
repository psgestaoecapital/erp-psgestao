import { NextRequest, NextResponse } from "next/server";

const OMIE_BASE = "https://app.omie.com.br/api/v1";

async function omieCall(app_key: string, app_secret: string, endpoint: string, method: string, params: any = {}) {
  const response = await fetch(`${OMIE_BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call: method, app_key, app_secret, param: [params] }),
  });
  return response.json();
}

// Fetch ALL pages from a paginated Omie endpoint
async function omieCallAllPages(app_key: string, app_secret: string, endpoint: string, method: string, arrayKey: string, extraParams: any = {}) {
  const perPage = 500;
  let page = 1;
  let allRecords: any[] = [];
  let totalPages = 1;

  while (page <= totalPages) {
    const result = await omieCall(app_key, app_secret, endpoint, method, {
      ...extraParams,
      pagina: page,
      registros_por_pagina: perPage,
    });

    if (result.faultstring) {
      // API error - return what we have so far
      break;
    }

    totalPages = result.total_de_paginas || 1;
    const records = result[arrayKey] || [];
    if (Array.isArray(records)) {
      allRecords = allRecords.concat(records);
    }

    page++;

    // Safety: max 50 pages (25,000 records)
    if (page > 50) break;
  }

  return {
    [arrayKey]: allRecords,
    total_de_registros: allRecords.length,
    paginas_importadas: page - 1,
    total_de_paginas: totalPages,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { app_key, app_secret, sync_type } = await req.json();

    if (!app_key || !app_secret) {
      return NextResponse.json({ error: "Chaves do Omie não fornecidas" }, { status: 400 });
    }

    const results: any = {};

    // 1. Company info
    if (!sync_type || sync_type === "all" || sync_type === "empresa") {
      try {
        results.empresa = await omieCall(app_key, app_secret, "geral/empresas/", "ListarEmpresas", { pagina: 1, registros_por_pagina: 10 });
      } catch(e) { results.empresa_error = "Erro"; }
    }

    // 2. Categories (ALL pages)
    if (!sync_type || sync_type === "all" || sync_type === "categorias") {
      try {
        results.categorias = await omieCallAllPages(app_key, app_secret, "geral/categorias/", "ListarCategorias", "categoria_cadastro");
      } catch(e) { results.categorias_error = "Erro"; }
    }

    // 3. Products (ALL pages)
    if (!sync_type || sync_type === "all" || sync_type === "produtos") {
      try {
        results.produtos = await omieCallAllPages(app_key, app_secret, "geral/produtos/", "ListarProdutos", "produto_servico_cadastro", { apenas_importado_api: "N" });
      } catch(e) { results.produtos_error = "Erro"; }
    }

    // 4. Clients (ALL pages)
    if (!sync_type || sync_type === "all" || sync_type === "clientes") {
      try {
        results.clientes = await omieCallAllPages(app_key, app_secret, "geral/clientes/", "ListarClientes", "clientes_cadastro");
      } catch(e) { results.clientes_error = "Erro"; }
    }

    // 5. Accounts Payable (ALL pages) ← CRITICAL
    if (!sync_type || sync_type === "all" || sync_type === "contas_pagar") {
      try {
        results.contas_pagar = await omieCallAllPages(app_key, app_secret, "financas/contapagar/", "ListarContasPagar", "conta_pagar_cadastro");
      } catch(e) { results.contas_pagar_error = "Erro"; }
    }

    // 6. Accounts Receivable (ALL pages) ← CRITICAL
    if (!sync_type || sync_type === "all" || sync_type === "contas_receber") {
      try {
        results.contas_receber = await omieCallAllPages(app_key, app_secret, "financas/contareceber/", "ListarContasReceber", "conta_receber_cadastro");
      } catch(e) { results.contas_receber_error = "Erro"; }
    }

    // 7. Sales Orders (ALL pages)
    if (!sync_type || sync_type === "all" || sync_type === "vendas") {
      try {
        results.vendas = await omieCallAllPages(app_key, app_secret, "produtos/pedido/", "ListarPedidos", "pedido_venda_produto", { filtrar_por_etapa: "60" });
      } catch(e) { results.vendas_error = "Erro"; }
    }

    // 8. Stock position (single page)
    if (!sync_type || sync_type === "all" || sync_type === "estoque") {
      try {
        results.estoque = await omieCall(app_key, app_secret, "estoque/consulta/", "ListarPosEstoque", { pagina: 1, registros_por_pagina: 500 });
      } catch(e) { results.estoque_error = "Erro"; }
    }

    // 9. Financial summary
    if (!sync_type || sync_type === "all" || sync_type === "resumo") {
      try {
        results.resumo = await omieCall(app_key, app_secret, "financas/resumo/", "ObterResumoFinancas", {});
      } catch(e) { results.resumo_error = "Erro"; }
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
