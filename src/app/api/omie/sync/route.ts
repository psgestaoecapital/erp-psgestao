import { NextRequest, NextResponse } from "next/server";

const OMIE_BASE = "https://app.omie.com.br/api/v1";

async function omieCall(app_key: string, app_secret: string, endpoint: string, method: string, params: any = {}) {
  const response = await fetch(`${OMIE_BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call: method,
      app_key,
      app_secret,
      param: [params],
    }),
  });
  return response.json();
}

export async function POST(req: NextRequest) {
  try {
    const { app_key, app_secret, sync_type } = await req.json();

    if (!app_key || !app_secret) {
      return NextResponse.json({ error: "Chaves do Omie não fornecidas" }, { status: 400 });
    }

    const results: any = {};

    if (!sync_type || sync_type === "all" || sync_type === "empresa") {
      try {
        results.empresa = await omieCall(app_key, app_secret, "geral/empresas/", "ListarEmpresas", { pagina: 1, registros_por_pagina: 10 });
      } catch(e) { results.empresa_error = "Erro ao buscar empresa"; }
    }

    if (!sync_type || sync_type === "all" || sync_type === "categorias") {
      try {
        results.categorias = await omieCall(app_key, app_secret, "geral/categorias/", "ListarCategorias", { pagina: 1, registros_por_pagina: 500 });
      } catch(e) { results.categorias_error = "Erro ao buscar categorias"; }
    }

    if (!sync_type || sync_type === "all" || sync_type === "produtos") {
      try {
        results.produtos = await omieCall(app_key, app_secret, "geral/produtos/", "ListarProdutos", { pagina: 1, registros_por_pagina: 500, apenas_importado_api: "N" });
      } catch(e) { results.produtos_error = "Erro ao buscar produtos"; }
    }

    if (!sync_type || sync_type === "all" || sync_type === "clientes") {
      try {
        results.clientes = await omieCall(app_key, app_secret, "geral/clientes/", "ListarClientes", { pagina: 1, registros_por_pagina: 500 });
      } catch(e) { results.clientes_error = "Erro ao buscar clientes"; }
    }

    if (!sync_type || sync_type === "all" || sync_type === "contas_pagar") {
      try {
        results.contas_pagar = await omieCall(app_key, app_secret, "financas/contapagar/", "ListarContasPagar", { pagina: 1, registros_por_pagina: 500 });
      } catch(e) { results.contas_pagar_error = "Erro ao buscar contas a pagar"; }
    }

    if (!sync_type || sync_type === "all" || sync_type === "contas_receber") {
      try {
        results.contas_receber = await omieCall(app_key, app_secret, "financas/contareceber/", "ListarContasReceber", { pagina: 1, registros_por_pagina: 500 });
      } catch(e) { results.contas_receber_error = "Erro ao buscar contas a receber"; }
    }

    if (!sync_type || sync_type === "all" || sync_type === "vendas") {
      try {
        results.vendas = await omieCall(app_key, app_secret, "produtos/pedido/", "ListarPedidos", { pagina: 1, registros_por_pagina: 500, filtrar_por_etapa: "60" });
      } catch(e) { results.vendas_error = "Erro ao buscar vendas"; }
    }

    if (!sync_type || sync_type === "all" || sync_type === "estoque") {
      try {
        results.estoque = await omieCall(app_key, app_secret, "estoque/consulta/", "ListarPosEstoque", { pagina: 1, registros_por_pagina: 500 });
      } catch(e) { results.estoque_error = "Erro ao buscar estoque"; }
    }

    if (!sync_type || sync_type === "all" || sync_type === "resumo") {
      try {
        results.resumo = await omieCall(app_key, app_secret, "financas/resumo/", "ObterResumoFinancas", {});
      } catch(e) { results.resumo_error = "Erro ao buscar resumo financeiro"; }
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
