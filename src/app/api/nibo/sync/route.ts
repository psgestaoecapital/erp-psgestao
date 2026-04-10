import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const NIBO_BASE = "https://api.nibo.com.br/empresas/v1";

// ═══ NIBO API CLIENT ═══
async function niboFetch(endpoint: string, apiKey: string, orgId: string) {
  const url = `${NIBO_BASE}/${orgId}${endpoint}`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Nibo API ${res.status}: ${errText}`);
  }
  return res.json();
}

// Fetch paginated Nibo data
async function niboFetchAll(endpoint: string, apiKey: string, orgId: string, maxPages = 20) {
  let allItems: any[] = [];
  let page = 1;
  while (page <= maxPages) {
    const sep = endpoint.includes("?") ? "&" : "?";
    const data = await niboFetch(`${endpoint}${sep}$top=100&$skip=${(page - 1) * 100}`, apiKey, orgId);
    const items = data?.items || data?.value || (Array.isArray(data) ? data : []);
    if (items.length === 0) break;
    allItems = allItems.concat(items);
    if (items.length < 100) break;
    page++;
  }
  return allItems;
}

export async function POST(req: NextRequest) {
  try {
    const { company_id, nibo_api_key, nibo_org_id, sync_types } = await req.json();
    
    if (!company_id || !nibo_api_key || !nibo_org_id) {
      return NextResponse.json({ error: "Campos obrigatórios: company_id, nibo_api_key, nibo_org_id" }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const results: any = {};
    const types = sync_types || ["clientes", "fornecedores", "recebimentos", "pagamentos", "categorias", "contas"];

    // ═══ 1. CLIENTES ═══
    if (types.includes("clientes")) {
      try {
        const clientes = await niboFetchAll("/contacts/customers", nibo_api_key, nibo_org_id);
        const mapped = clientes.map((c: any) => ({
          codigo_cliente: c.id || c.contactId,
          nome_fantasia: c.tradeName || c.name || "",
          razao_social: c.name || "",
          cnpj_cpf: c.document || c.cpfCnpj || "",
          email: c.email || "",
          telefone: c.phone || "",
          cidade: c.city || "",
          uf: c.state || "",
        }));
        
        await supabase.from("omie_imports").upsert({
          company_id,
          import_type: "clientes",
          import_data: { clientes_cadastro: mapped, fonte: "nibo" },
          record_count: mapped.length,
          imported_at: new Date().toISOString(),
        }, { onConflict: "company_id,import_type" });
        
        results.clientes = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.clientes = { status: "erro", msg: e.message }; }
    }

    // ═══ 2. FORNECEDORES ═══
    if (types.includes("fornecedores")) {
      try {
        const fornecedores = await niboFetchAll("/contacts/suppliers", nibo_api_key, nibo_org_id);
        const mapped = fornecedores.map((f: any) => ({
          codigo_fornecedor: f.id || f.contactId,
          nome: f.name || f.tradeName || "",
          cnpj_cpf: f.document || f.cpfCnpj || "",
          email: f.email || "",
          telefone: f.phone || "",
        }));
        
        await supabase.from("omie_imports").upsert({
          company_id,
          import_type: "fornecedores",
          import_data: { fornecedores_cadastro: mapped, fonte: "nibo" },
          record_count: mapped.length,
          imported_at: new Date().toISOString(),
        }, { onConflict: "company_id,import_type" });
        
        results.fornecedores = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.fornecedores = { status: "erro", msg: e.message }; }
    }

    // ═══ 3. CATEGORIAS ═══
    if (types.includes("categorias")) {
      try {
        const categorias = await niboFetchAll("/categories", nibo_api_key, nibo_org_id);
        const mapped = categorias.map((c: any) => ({
          codigo: c.id || c.categoryId || "",
          descricao: c.name || c.description || "",
          tipo: c.type || c.categoryType || "",
          grupo: c.parentName || c.group || "",
        }));
        
        await supabase.from("omie_imports").upsert({
          company_id,
          import_type: "categorias",
          import_data: { categoria_cadastro: mapped, fonte: "nibo" },
          record_count: mapped.length,
          imported_at: new Date().toISOString(),
        }, { onConflict: "company_id,import_type" });
        
        results.categorias = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.categorias = { status: "erro", msg: e.message }; }
    }

    // ═══ 4. CONTAS A RECEBER ═══
    if (types.includes("recebimentos")) {
      try {
        // Recebimentos agendados (a receber)
        const agendados = await niboFetchAll("/schedules/receivable", nibo_api_key, nibo_org_id);
        // Recebimentos realizados
        const recebidos = await niboFetchAll("/schedules/receipt", nibo_api_key, nibo_org_id);
        
        const allRec = [...agendados, ...recebidos];
        const mapped = allRec.map((r: any) => ({
          codigo_lancamento: r.id || r.scheduleId || "",
          valor_documento: r.value || r.amount || 0,
          data_vencimento: r.dueDate || r.date || "",
          data_emissao: r.issueDate || r.date || "",
          data_pagamento: r.paymentDate || r.paidDate || "",
          status_titulo: r.isPaid ? "RECEBIDO" : r.isOverdue ? "VENCIDO" : "EM_ABERTO",
          codigo_cliente_fornecedor: r.contactId || r.customerId || "",
          descricao_categoria: r.categoryName || r.description || "",
          codigo_categoria: r.categoryId || "",
          observacao: r.description || r.observation || "",
          numero_documento: r.documentNumber || r.invoiceNumber || "",
          conta_bancaria: r.bankAccountName || "",
        }));
        
        await supabase.from("omie_imports").upsert({
          company_id,
          import_type: "contas_receber",
          import_data: { conta_receber_cadastro: mapped, fonte: "nibo" },
          record_count: mapped.length,
          imported_at: new Date().toISOString(),
        }, { onConflict: "company_id,import_type" });
        
        results.recebimentos = { total: mapped.length, agendados: agendados.length, recebidos: recebidos.length, status: "ok" };
      } catch (e: any) { results.recebimentos = { status: "erro", msg: e.message }; }
    }

    // ═══ 5. CONTAS A PAGAR ═══
    if (types.includes("pagamentos")) {
      try {
        // Pagamentos agendados (a pagar)
        const agendados = await niboFetchAll("/schedules/payable", nibo_api_key, nibo_org_id);
        // Pagamentos realizados
        const pagos = await niboFetchAll("/schedules/payment", nibo_api_key, nibo_org_id);
        
        const allPag = [...agendados, ...pagos];
        const mapped = allPag.map((p: any) => ({
          codigo_lancamento: p.id || p.scheduleId || "",
          valor_documento: p.value || p.amount || 0,
          data_vencimento: p.dueDate || p.date || "",
          data_emissao: p.issueDate || p.date || "",
          data_pagamento: p.paymentDate || p.paidDate || "",
          status_titulo: p.isPaid ? "PAGO" : p.isOverdue ? "VENCIDO" : "EM_ABERTO",
          codigo_cliente_fornecedor: p.contactId || p.supplierId || "",
          descricao_categoria: p.categoryName || p.description || "",
          codigo_categoria: p.categoryId || "",
          observacao: p.description || p.observation || "",
          numero_documento: p.documentNumber || "",
          conta_bancaria: p.bankAccountName || "",
        }));
        
        await supabase.from("omie_imports").upsert({
          company_id,
          import_type: "contas_pagar",
          import_data: { conta_pagar_cadastro: mapped, fonte: "nibo" },
          record_count: mapped.length,
          imported_at: new Date().toISOString(),
        }, { onConflict: "company_id,import_type" });
        
        results.pagamentos = { total: mapped.length, agendados: agendados.length, pagos: pagos.length, status: "ok" };
      } catch (e: any) { results.pagamentos = { status: "erro", msg: e.message }; }
    }

    // ═══ 6. CONTAS BANCÁRIAS E SALDO ═══
    if (types.includes("contas")) {
      try {
        const contas = await niboFetch("/bankaccounts", nibo_api_key, nibo_org_id);
        const items = contas?.items || contas?.value || (Array.isArray(contas) ? contas : []);
        const mapped = items.map((c: any) => ({
          id: c.id || c.bankAccountId,
          nome: c.name || c.description || "",
          banco: c.bankName || "",
          agencia: c.branch || "",
          conta: c.accountNumber || "",
          saldo: c.balance || 0,
          tipo: c.type || "",
        }));
        
        await supabase.from("omie_imports").upsert({
          company_id,
          import_type: "contas_bancarias",
          import_data: { contas: mapped, fonte: "nibo" },
          record_count: mapped.length,
          imported_at: new Date().toISOString(),
        }, { onConflict: "company_id,import_type" });
        
        results.contas = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.contas = { status: "erro", msg: e.message }; }
    }

    // ═══ SUMMARY ═══
    const totalRecords = Object.values(results).reduce((s: number, r: any) => s + (r.total || 0), 0);
    const errors = Object.entries(results).filter(([, r]: any) => r.status === "erro");

    return NextResponse.json({
      success: errors.length === 0,
      message: `Nibo sync: ${totalRecords} registros importados${errors.length > 0 ? `, ${errors.length} erro(s)` : ""}`,
      fonte: "nibo",
      company_id,
      results,
      synced_at: new Date().toISOString(),
    });

  } catch (error: any) {
    return NextResponse.json({ error: `Erro na sincronização Nibo: ${error.message}` }, { status: 500 });
  }
}

// GET — status da integração
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id");
  if (!companyId) return NextResponse.json({ error: "company_id obrigatório" }, { status: 400 });
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data } = await supabase.from("omie_imports")
    .select("import_type, record_count, imported_at")
    .eq("company_id", companyId)
    .order("imported_at", { ascending: false });
  
  const niboImports = (data || []).filter((d: any) => {
    // Check if it's a nibo import by looking at the data
    return true; // All imports for this company
  });

  return NextResponse.json({
    company_id: companyId,
    imports: niboImports,
    last_sync: niboImports.length > 0 ? niboImports[0].imported_at : null,
  });
}
