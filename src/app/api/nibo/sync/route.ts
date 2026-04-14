import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const NIBO_BASE = "https://api.nibo.com.br/empresas/v1";

async function niboFetch(endpoint: string, apiToken: string) {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${NIBO_BASE}${endpoint}${sep}apitoken=${apiToken}`;
  const res = await fetch(url, {
    headers: { "ApiToken": apiToken, "Content-Type": "application/json", "Accept": "application/json" },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Nibo ${res.status}: ${errText}`);
  }
  return res.json();
}

async function niboFetchAll(endpoint: string, apiToken: string, orderBy: string = "id", maxPages = 30) {
  let allItems: any[] = [];
  let skip = 0;
  const top = 200;
  while (skip < maxPages * top) {
    const sep = endpoint.includes("?") ? "&" : "?";
    const data = await niboFetch(`${endpoint}${sep}$orderby=${orderBy}&$top=${top}&$skip=${skip}`, apiToken);
    const items = data?.items || data?.value || (Array.isArray(data) ? data : []);
    if (items.length === 0) break;
    allItems = allItems.concat(items);
    if (items.length < top) break;
    skip += top;
  }
  return allItems;
}

export async function POST(req: NextRequest) {
  try {
    const { company_id, nibo_api_key, nibo_org_id, nibo_api_secret, sync_types } = await req.json();
    
    if (!company_id || !nibo_api_key) {
      return NextResponse.json({ error: "Campos obrigatorios: company_id, nibo_api_key" }, { status: 400 });
    }

    const apiToken = nibo_api_key;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const results: any = {};
    const types = sync_types || ["stakeholders", "categorias", "debitos", "creditos", "contas"];

    // ═══ 1. STAKEHOLDERS (Clientes + Fornecedores) ═══
    if (types.includes("stakeholders") || types.includes("clientes")) {
      try {
        const items = await niboFetchAll("/stakeholders", apiToken, "name");
        const clientes = items.filter((s: any) => s.isCustomer);
        const fornecedores = items.filter((s: any) => s.isSupplier);
        
        const mappedClientes = items.map((c: any) => ({
          codigo_cliente_omie: c.id || c.stakeholderId || "",
          nome_fantasia: c.tradeName || c.name || "",
          razao_social: c.name || "",
          cnpj_cpf: c.document || c.cpfCnpj || "",
          email: c.email || "",
          telefone: c.phoneNumber || c.phone || "",
          cidade: c.city || "",
          uf: c.state || "",
          isCustomer: c.isCustomer || false,
          isSupplier: c.isSupplier || false,
        }));
        
        await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", "clientes");
        await supabase.from("omie_imports").insert({
          company_id, import_type: "clientes",
          import_data: { clientes_cadastro: mappedClientes, fonte: "nibo" },
          record_count: mappedClientes.length,
        });
        
        results.stakeholders = { total: items.length, clientes: clientes.length, fornecedores: fornecedores.length, status: "ok" };
      } catch (e: any) { results.stakeholders = { status: "erro", msg: e.message }; }
    }

    // ═══ 2. CATEGORIAS ═══
    if (types.includes("categorias")) {
      try {
        const items = await niboFetchAll("/categories", apiToken, "name");
        const mapped = items.map((c: any) => ({
          codigo: c.id || c.categoryId || "",
          descricao: c.name || c.description || "",
          tipo: c.type || "",
          grupo: c.group?.name || c.parentName || "",
          grupo_ref: c.group?.referenceCode || "",
        }));
        
        await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", "categorias");
        await supabase.from("omie_imports").insert({
          company_id, import_type: "categorias",
          import_data: { categoria_cadastro: mapped, fonte: "nibo" },
          record_count: mapped.length,
        });
        
        results.categorias = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.categorias = { status: "erro", msg: e.message }; }
    }

    // ═══ 3. DEBITOS (Contas a Pagar) ═══
    if (types.includes("debitos") || types.includes("pagamentos")) {
      try {
        const items = await niboFetchAll("/schedules/debit", apiToken, "dueDate desc", 50);
        const mapped = items.map((p: any) => ({
          codigo_lancamento_omie: p.id || p.scheduleId || "",
          valor_documento: p.value || p.amount || 0,
          data_vencimento: p.dueDate || "",
          data_emissao: p.issueDate || p.date || p.dueDate || "",
          data_pagamento: p.paymentDate || p.paidDate || "",
          status_titulo: p.isPaid ? "PAGO" : p.isOverdue ? "VENCIDO" : "EM_ABERTO",
          codigo_cliente_fornecedor: p.stakeholder?.id || p.stakeholderId || "",
          descricao_categoria: p.category?.name || p.categoryName || "",
          codigo_categoria: p.category?.id || p.categoryId || "",
          observacao: p.description || p.observation || "",
          numero_documento: p.documentNumber || p.invoiceNumber || "",
          nome_fornecedor: p.stakeholder?.name || "",
        }));
        
        await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", "contas_pagar");
        await supabase.from("omie_imports").insert({
          company_id, import_type: "contas_pagar",
          import_data: { conta_pagar_cadastro: mapped, fonte: "nibo" },
          record_count: mapped.length,
        });
        
        results.debitos = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.debitos = { status: "erro", msg: e.message }; }
    }

    // ═══ 4. CREDITOS (Contas a Receber) ═══
    if (types.includes("creditos") || types.includes("recebimentos")) {
      try {
        const items = await niboFetchAll("/schedules/credit", apiToken, "dueDate desc", 50);
        const mapped = items.map((r: any) => ({
          codigo_lancamento_omie: r.id || r.scheduleId || "",
          valor_documento: r.value || r.amount || 0,
          data_vencimento: r.dueDate || "",
          data_emissao: r.issueDate || r.date || r.dueDate || "",
          data_pagamento: r.paymentDate || r.paidDate || "",
          status_titulo: r.isPaid ? "RECEBIDO" : r.isOverdue ? "VENCIDO" : "EM_ABERTO",
          codigo_cliente_fornecedor: r.stakeholder?.id || r.stakeholderId || "",
          descricao_categoria: r.category?.name || r.categoryName || "",
          codigo_categoria: r.category?.id || r.categoryId || "",
          observacao: r.description || r.observation || "",
          numero_documento: r.documentNumber || r.invoiceNumber || "",
          nome_cliente: r.stakeholder?.name || "",
        }));
        
        await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", "contas_receber");
        await supabase.from("omie_imports").insert({
          company_id, import_type: "contas_receber",
          import_data: { conta_receber_cadastro: mapped, fonte: "nibo" },
          record_count: mapped.length,
        });
        
        results.creditos = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.creditos = { status: "erro", msg: e.message }; }
    }

    // ═══ 5. CONTAS BANCARIAS ═══
    if (types.includes("contas")) {
      try {
        const items = await niboFetchAll("/bankaccounts", apiToken, "name");
        const mapped = items.map((c: any) => ({
          id: c.id || c.bankAccountId,
          nome: c.name || c.description || "",
          banco: c.bankName || "",
          agencia: c.branch || "",
          conta: c.accountNumber || "",
          saldo: c.balance || 0,
          tipo: c.type || "",
        }));
        
        await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", "contas_bancarias");
        await supabase.from("omie_imports").insert({
          company_id, import_type: "contas_bancarias",
          import_data: { contas: mapped, fonte: "nibo" },
          record_count: mapped.length,
        });
        
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
      counts: Object.fromEntries(Object.entries(results).filter(([, r]: any) => r.status === "ok").map(([k, r]: any) => [k, r.total])),
      results,
    });

  } catch (error: any) {
    return NextResponse.json({ error: `Erro Nibo: ${error.message}` }, { status: 500 });
  }
}
