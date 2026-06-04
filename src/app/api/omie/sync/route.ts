import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// maxDuration subido 120 -> 300 (Vercel Pro max) pra acomodar sync_type='produtos'
// completo · catalogo KGF tem 1725 itens em 35 paginas (~100s + ETL ~30s).
// 'all' nao roda produtos · permanece rapido (sub-30s tipicamente).
export const maxDuration = 300;

// Sentinel pra debug de deploy. Se a producao retornar _route_version != ROUTE_VERSION,
// e bundle stale na Vercel. v7 = BUG-OMIE-SYNC-ETL-SLOW-v1 (batch upsert produtos).
const ROUTE_VERSION = "v7-2026-06-04-BUG-OMIE-SYNC-ETL-SLOW-v1";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

// Headers CORS — permite chamada de qualquer origem (incl. file:// e outras páginas)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Preflight CORS — o navegador chama OPTIONS antes de POST cross-origin
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

async function omieCall(app_key: string, app_secret: string, endpoint: string, method: string, params: any = {}) {
  const res = await fetch(`https://app.omie.com.br/api/v1/${endpoint}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call: method, app_key, app_secret, param: [params] }),
  });
  return await res.json();
}

// Detecta SOAP fault no payload do Omie. Erros SOAP voltam com HTTP 200 +
// {faultcode, faultstring} no body · sem isso o sync gravava fault como
// import normal (record_count=1) e mascarava o erro.
function extractFault(r: any): string | null {
  if (!r || typeof r !== "object") return null;
  const code = r.faultcode ?? r.fault_code;
  const str = r.faultstring ?? r.fault_string;
  if (!code && !str) return null;
  return [code, str].filter(Boolean).join(" · ");
}

async function omieCallAllPages(app_key: string, app_secret: string, endpoint: string, method: string, arrayKey: string, extraParams: any = {}, perPageOverride?: number) {
  const allData: any[] = [];
  let page = 1;
  const perPage = perPageOverride ?? 500;
  let lastResponse: any = null;
  while (true) {
    const result = await omieCall(app_key, app_secret, endpoint, method, { pagina: page, registros_por_pagina: perPage, ...extraParams });
    lastResponse = result;
    // Fault na 1a pagina · retorna raw pra caller detectar via extractFault
    const fault = extractFault(result);
    if (fault) {
      if (page === 1) return result;
      // Fault em pagina N+1 · retorna o que ja acumulou + flag
      return { [arrayKey]: allData, total: allData.length, _partial_fault: fault };
    }
    const items = result[arrayKey];
    if (Array.isArray(items)) allData.push(...items);
    const totalPages = result.total_de_paginas || 1;
    if (page >= totalPages) break;
    page++;
    if (page > 100) break; // safety (subido pra acomodar produtos com perPage=50)
  }
  // Propaga total_de_registros / total_de_paginas direto do response Omie
  // (defesa contra parsing futuro · evita confiar so em allData.length).
  return {
    [arrayKey]: allData,
    total: allData.length,
    total_de_registros: Number(lastResponse?.total_de_registros) || allData.length,
    total_de_paginas: Number(lastResponse?.total_de_paginas) || 1,
  };
}

// ETL Omie produto -> erp_produtos · BATCH upsert idempotente.
// Antes (v6 · per-row): ~1725 SELECT + INSERT/UPDATE sequenciais (~75-100ms cada)
// estourava maxDuration 300s antes de save() executar -> sync ficava parcial.
// Agora (v7): 1 pre-fetch chunkado pra contar inseridos vs atualizados + N
// upserts em lote de 200 com onConflict 'company_id,codigo' (constraint
// existente). ETL cai de ~150s pra ~3-5s. Sync produtos < 120s total.
async function upsertProdutosOmie(
  sb: any,
  companyId: string,
  omieProdutos: any[]
): Promise<{ inseridos: number; atualizados: number; erros: number; pulados: number }> {
  // 1. Mapear Omie -> shape erp_produtos + filtrar (precisam codigo e nome)
  type Mapped = { codigo: string; payload: Record<string, unknown> };
  const mapped: Mapped[] = [];
  let pulados = 0;

  for (const omie of omieProdutos) {
    const isServico =
      omie.tipoItem === "04" ||
      omie.tipoItem === "05" ||
      String(omie.descr_detalhada ?? "").toLowerCase().includes("servi");
    const refId = String(
      omie.codigo_produto ?? omie.codigo_produto_integracao ?? omie.codigo ?? ""
    );
    const codigo = String(omie.codigo ?? omie.codigo_produto_integracao ?? refId).trim();
    const nome = String(omie.descricao ?? "").trim();

    if (!codigo || !nome) {
      pulados++;
      continue;
    }

    mapped.push({
      codigo,
      payload: {
        company_id: companyId,
        codigo,
        nome,
        descricao: omie.descr_detalhada ?? null,
        tipo: isServico ? "servico" : "produto",
        unidade: omie.unidade ?? "UN",
        categoria: omie.descricao_familia ?? null,
        marca: omie.marca ?? null,
        ncm: omie.ncm ?? null,
        codigo_barras: omie.ean ?? null,
        preco_venda: Number(omie.valor_unitario) || 0,
        preco_custo: Number(omie.custo_medio) || 0,
        estoque_atual: Number(omie.estoque_atual) || 0,
        estoque_minimo: Number(omie.estoque_minimo) || 0,
        peso_liquido: Number(omie.peso_liq) || 0,
        peso_bruto: Number(omie.peso_bruto) || 0,
        origem: omie.origem_mercadoria ?? "0",
        cfop_venda: omie.cfop ?? null,
        ref_externa_sistema: "OMIE",
        ref_externa_id: refId,
        ativo: omie.inativo !== "S",
      },
    });
  }

  if (mapped.length === 0) {
    return { inseridos: 0, atualizados: 0, erros: 0, pulados };
  }

  // 2. Pre-fetch dos codigos ja existentes pra distinguir insert vs update
  //    (chunk 200 evita URL length limit do PostgREST com .in())
  const existingCodes = new Set<string>();
  const allCodes = mapped.map((m) => m.codigo);
  const fetchChunkSize = 200;
  for (let i = 0; i < allCodes.length; i += fetchChunkSize) {
    const chunk = allCodes.slice(i, i + fetchChunkSize);
    const { data: existingRows, error } = await sb
      .from("erp_produtos")
      .select("codigo")
      .eq("company_id", companyId)
      .in("codigo", chunk);
    if (error) break; // degrada graciosamente · contagem fica aproximada
    for (const r of existingRows ?? []) existingCodes.add(String(r.codigo));
  }

  // 3. Batch upsert via onConflict 'company_id,codigo' (constraint existente)
  let inseridos = 0;
  let atualizados = 0;
  let erros = 0;
  const batchSize = 200;

  for (let i = 0; i < mapped.length; i += batchSize) {
    const batch = mapped.slice(i, i + batchSize);
    const payloads = batch.map((b) => b.payload);

    const { error } = await sb
      .from("erp_produtos")
      .upsert(payloads, { onConflict: "company_id,codigo", ignoreDuplicates: false });

    if (error) {
      erros += batch.length;
      continue;
    }

    // Contagem baseada no pre-fetch (rapido · sem query extra)
    for (const b of batch) {
      if (existingCodes.has(b.codigo)) atualizados++;
      else inseridos++;
    }
  }

  return { inseridos, atualizados, erros, pulados };
}

// ListarPosEstoque usa ListarEstPosRequest com naming diferente:
// - paginacao: nPagina / nRegPorPagina (NAO pagina/registros_por_pagina)
// - response: nTotPaginas / nTotRegistros (NAO total_de_paginas)
// - array key: produto_servico_lista
// Por isso precisa de um paginador dedicado (omieCallAllPages generico nao funciona).
async function omieListarPosEstoqueAllPages(app_key: string, app_secret: string, dDataPosicao: string) {
  const allData: any[] = [];
  let page = 1;
  const perPage = 500;
  let nTotPaginas = 1;
  let nTotRegistros = 0;

  while (true) {
    const result = await omieCall(app_key, app_secret, "estoque/consulta/", "ListarPosEstoque", {
      nPagina: page,
      nRegPorPagina: perPage,
      dDataPosicao,
    });
    const fault = extractFault(result);
    if (fault) {
      if (page === 1) return result; // raw fault
      return {
        produto_servico_lista: allData,
        nTotPaginas,
        nTotRegistros,
        total: allData.length,
        _partial_fault: fault,
      };
    }

    // Omie usa diferentes nomes em diferentes versoes do endpoint · tenta os conhecidos.
    const items =
      result.produto_servico_lista ??
      result.produtoServicoLista ??
      result.posicao_estoque ??
      result.lista ??
      [];
    if (Array.isArray(items)) allData.push(...items);

    nTotPaginas = Number(result.nTotPaginas ?? result.total_de_paginas ?? 1) || 1;
    nTotRegistros = Number(result.nTotRegistros ?? nTotRegistros) || nTotRegistros;
    if (page >= nTotPaginas) break;
    page++;
    if (page > 100) break; // safety
  }

  return {
    produto_servico_lista: allData,
    nTotPaginas,
    nTotRegistros: nTotRegistros || allData.length,
    total: allData.length,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { app_key, app_secret, sync_type, company_id } = await req.json();

    if (!app_key || !app_secret) {
      return NextResponse.json({ error: "Chaves do Omie nao fornecidas" }, { status: 400, headers: corsHeaders });
    }

    const supabase = company_id ? createClient(supabaseUrl, supabaseKey) : null;
    const results: any = {};
    const counts: Record<string, number> = {};
    const failures: Record<string, string> = {};
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

    // Helper: registra fault como FALHA do modulo (nao grava omie_imports como sucesso)
    const recordFault = (importType: string, fault: string) => {
      failures[importType] = fault;
      results[`${importType}_error`] = fault;
    };

    // Helper: roda chamada + detecta fault SOAP do Omie (HTTP 200 + faultcode)
    const runCall = async (importType: string, fn: () => Promise<any>, countFn: (d: any) => number = () => 1) => {
      try {
        const data = await fn();
        const fault = extractFault(data);
        if (fault) {
          recordFault(importType, fault);
          return;
        }
        results[importType] = data;
        await save(importType, data, countFn(data));
      } catch (e) {
        recordFault(importType, e instanceof Error ? e.message : String(e));
      }
    };

    // 1. Company info
    if (doAll || sync_type === "empresa") {
      await runCall("empresa", () =>
        omieCall(app_key, app_secret, "geral/empresas/", "ListarEmpresas", { pagina: 1, registros_por_pagina: 10 })
      );
    }

    // 2. Categories
    if (doAll || sync_type === "categorias") {
      await runCall("categorias", () =>
        omieCallAllPages(app_key, app_secret, "geral/categorias/", "ListarCategorias", "categoria_cadastro"),
        (d) => d?.total ?? 0
      );
    }

    // 3. Clients (era 4 · subiu apos decouple de produtos)
    if (doAll || sync_type === "clientes") {
      await runCall("clientes", () =>
        omieCallAllPages(app_key, app_secret, "geral/clientes/", "ListarClientes", "clientes_cadastro"),
        (d) => d?.total ?? 0
      );
    }

    // 4. Accounts Payable (era 5)
    if (doAll || sync_type === "contas_pagar") {
      await runCall("contas_pagar", () =>
        omieCallAllPages(app_key, app_secret, "financas/contapagar/", "ListarContasPagar", "conta_pagar_cadastro"),
        (d) => d?.total ?? 0
      );
    }

    // 5. Accounts Receivable (era 6)
    if (doAll || sync_type === "contas_receber") {
      await runCall("contas_receber", () =>
        omieCallAllPages(app_key, app_secret, "financas/contareceber/", "ListarContasReceber", "conta_receber_cadastro"),
        (d) => d?.total ?? 0
      );
    }

    // 6. Sales Orders (era 7)
    if (doAll || sync_type === "vendas") {
      await runCall("vendas", () =>
        omieCallAllPages(app_key, app_secret, "produtos/pedido/", "ListarPedidos", "pedido_venda_produto", { filtrar_por_etapa: "60" }),
        (d) => d?.total ?? 0
      );
    }

    // 7. Stock (era 8) · ListarPosEstoque · paginador DEDICADO (nPagina/nTotPaginas)
    //   record_count REAL (era 1 antes · agora reflete nTotRegistros / array length).
    if (doAll || sync_type === "estoque") {
      const hoje = new Date();
      const dd = String(hoje.getDate()).padStart(2, "0");
      const mm = String(hoje.getMonth() + 1).padStart(2, "0");
      const yyyy = hoje.getFullYear();
      const dDataPosicao = `${dd}/${mm}/${yyyy}`;
      await runCall(
        "estoque",
        () => omieListarPosEstoqueAllPages(app_key, app_secret, dDataPosicao),
        (d) => d?.nTotRegistros ?? d?.total ?? d?.produto_servico_lista?.length ?? 0
      );
    }

    // 8. Financial summary (era 9) · DERIVADO LOCALMENTE
    //   ObterResumoFinancas exige WS_PARAMS nao-vazio (dDataDe/dDataAte). Em vez de
    //   manter dependencia frgil da API Omie, derivamos resumo das contas_pagar +
    //   contas_receber que ja foram sincronizadas neste mesmo run. Menor risco · zero
    //   chamada adicional · permanece compativel com consumidores de omie_imports.
    if (doAll || sync_type === "resumo") {
      try {
        const pagar = results.contas_pagar?.conta_pagar_cadastro ?? [];
        const receber = results.contas_receber?.conta_receber_cadastro ?? [];
        const sum = (arr: any[]) =>
          arr.reduce((s: number, c: any) => s + (Number(c.valor_documento) || 0), 0);
        const aPagar = pagar.filter((c: any) => String(c.status_titulo ?? "").toUpperCase() !== "PAGO");
        const aReceber = receber.filter((c: any) => String(c.status_titulo ?? "").toUpperCase() !== "RECEBIDO");
        const resumo = {
          _derivado_local: true,
          _origem: "agregado de contas_pagar + contas_receber sincronizados neste run",
          total_pagar: sum(pagar),
          total_receber: sum(receber),
          saldo_estimado: sum(receber) - sum(pagar),
          qtd_pagar_total: pagar.length,
          qtd_receber_total: receber.length,
          qtd_a_pagar: aPagar.length,
          qtd_a_receber: aReceber.length,
          valor_a_pagar: sum(aPagar),
          valor_a_receber: sum(aReceber),
          data_calculo: new Date().toISOString(),
        };
        results.resumo = resumo;
        await save("resumo", resumo, 1);
      } catch (e) {
        recordFault("resumo", e instanceof Error ? e.message : String(e));
      }
    }

    // 9. Products (ULTIMO + DECOUPLED do 'all')
    //   BUG-OMIE-SYNC-TIMEOUT-v1: catalogo grande (KGF: 1725 itens em 35 paginas
    //   ~100s + ETL ~30s) starvava o financeiro no sync_type='all' (pg_net
    //   timeout em 110s). Agora produtos:
    //     - NAO roda no 'all' · so quando sync_type='produtos' explicito
    //     - roda por ULTIMO (defensivo · se algum dia voltar pro 'all',
    //       financeiro completa antes do timeout)
    //     - maxDuration do route bumpada pra 300s pra acomodar o catalogo
    //   Body comprovado empiricamente (v5): filtrar_apenas_omiepdv:'N' +
    //   perPage=50. ETL idempotente em erp_produtos via ref OMIE.
    //   Recomendado: agendar 1x/dia via cron separado (sync_type='produtos').
    if (sync_type === "produtos") {
      await runCall(
        "produtos",
        async () => {
          const result = await omieCallAllPages(
            app_key,
            app_secret,
            "geral/produtos/",
            "ListarProdutos",
            "produto_servico_cadastro",
            { filtrar_apenas_omiepdv: "N" },
            50 // perPage especifico pra ListarProdutos
          );
          if (supabase && company_id && Array.isArray(result?.produto_servico_cadastro)) {
            const etl = await upsertProdutosOmie(
              supabase,
              company_id,
              result.produto_servico_cadastro
            );
            (result as any)._etl_erp_produtos = etl;
          }
          return result;
        },
        (d) => d?.total_de_registros ?? d?.total ?? d?.produto_servico_cadastro?.length ?? 0
      );
    }

    const hasFailures = Object.keys(failures).length > 0;
    return NextResponse.json(
      {
        success: !hasFailures,
        _route_version: ROUTE_VERSION,
        counts,
        failures,
        company_id: company_id || null,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
