import { NextRequest, NextResponse } from "next/server";

const CA_BASE = "https://api.contaazul.com/v2";

async function caCall(token: string, endpoint: string) {
  const response = await fetch(`${CA_BASE}${endpoint}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ContaAzul API error ${response.status}: ${err}`);
  }
  return response.json();
}

// Fetch all pages from a paginated ContaAzul endpoint
async function caCallAllPages(token: string, endpoint: string, pageSize: number = 200) {
  let page = 1;
  let allRecords: any[] = [];
  let hasMore = true;

  while (hasMore) {
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const result = await caCall(token, `${endpoint}${separator}page=${page}&size=${pageSize}`);
      
      if (Array.isArray(result)) {
        allRecords = allRecords.concat(result);
        hasMore = result.length === pageSize;
      } else if (result.items && Array.isArray(result.items)) {
        allRecords = allRecords.concat(result.items);
        hasMore = result.items.length === pageSize;
      } else {
        // Single object or unknown format
        if (Object.keys(result).length > 0) allRecords.push(result);
        hasMore = false;
      }
    } catch (e) {
      hasMore = false;
    }

    page++;
    if (page > 50) break; // Safety limit
  }

  return allRecords;
}

export async function POST(req: NextRequest) {
  try {
    const { token, sync_type } = await req.json();

    if (!token) {
      return NextResponse.json({ error: "Token do ContaAzul não fornecido" }, { status: 400 });
    }

    let result: any = {};

    if (sync_type === "test") {
      // Test connection by fetching company info
      try {
        const company = await caCall(token, "/company");
        return NextResponse.json({
          success: true,
          company: {
            name: company.name || company.company_name,
            cnpj: company.federal_tax_number || company.cnpj,
          },
        });
      } catch (e: any) {
        return NextResponse.json({ error: `Falha na conexão: ${e.message}` }, { status: 401 });
      }
    }

    if (sync_type === "contas_receber" || sync_type === "all") {
      try {
        const receivables = await caCallAllPages(token, "/finance/receivables");
        result.contas_receber = {
          registros: receivables,
          total: receivables.length,
        };
      } catch (e: any) {
        result.contas_receber = { error: e.message, registros: [], total: 0 };
      }
    }

    if (sync_type === "contas_pagar" || sync_type === "all") {
      try {
        const payables = await caCallAllPages(token, "/finance/payables");
        result.contas_pagar = {
          registros: payables,
          total: payables.length,
        };
      } catch (e: any) {
        result.contas_pagar = { error: e.message, registros: [], total: 0 };
      }
    }

    if (sync_type === "clientes" || sync_type === "all") {
      try {
        const customers = await caCallAllPages(token, "/customers");
        result.clientes = {
          registros: customers,
          total: customers.length,
        };
      } catch (e: any) {
        result.clientes = { error: e.message, registros: [], total: 0 };
      }
    }

    if (sync_type === "vendas" || sync_type === "all") {
      try {
        const sales = await caCallAllPages(token, "/sales");
        result.vendas = {
          registros: sales,
          total: sales.length,
        };
      } catch (e: any) {
        result.vendas = { error: e.message, registros: [], total: 0 };
      }
    }

    if (sync_type === "categorias" || sync_type === "all") {
      try {
        const categories = await caCallAllPages(token, "/categories");
        result.categorias = {
          registros: categories,
          total: categories.length,
        };
      } catch (e: any) {
        result.categorias = { error: e.message, registros: [], total: 0 };
      }
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Erro na sincronização" }, { status: 500 });
  }
}
