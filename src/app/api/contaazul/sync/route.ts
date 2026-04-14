import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const CA_BASE = "https://api.contaazul.com/v2";

async function caFetch(token: string, endpoint: string) {
  const res = await fetch(`${CA_BASE}${endpoint}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`ContaAzul ${res.status}: ${e}`); }
  return res.json();
}

async function caFetchAll(token: string, endpoint: string, maxPages = 30) {
  let all: any[] = [];
  let page = 1;
  while (page <= maxPages) {
    const sep = endpoint.includes("?") ? "&" : "?";
    try {
      const data = await caFetch(token, `${endpoint}${sep}page=${page}&size=200`);
      const items = Array.isArray(data) ? data : data?.items || [];
      if (items.length === 0) break;
      all = all.concat(items);
      if (items.length < 200) break;
      page++;
    } catch { break; }
  }
  return all;
}

export async function POST(req: NextRequest) {
  try {
    const { company_id, token, sync_types } = await req.json();
    if (!company_id || !token) return NextResponse.json({ error: "company_id e token obrigatorios" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const results: any = {};
    const types = sync_types || ["clientes", "categorias", "contas_pagar", "contas_receber"];

    // ═══ CLIENTES ═══
    if (types.includes("clientes")) {
      try {
        const items = await caFetchAll(token, "/customers");
        const mapped = items.map((c: any) => ({
          codigo_cliente_omie: c.id || "",
          nome_fantasia: c.company_name || c.name || "",
          razao_social: c.name || "",
          cnpj_cpf: c.federal_tax_number || c.document || "",
          email: c.email || "",
          telefone: c.phone?.number || "",
          cidade: c.address?.city || "",
          uf: c.address?.state || "",
        }));
        await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", "clientes");
        await supabase.from("omie_imports").insert({ company_id, import_type: "clientes", import_data: { clientes_cadastro: mapped, fonte: "contaazul" }, record_count: mapped.length });
        results.clientes = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.clientes = { status: "erro", msg: e.message }; }
    }

    // ═══ CATEGORIAS ═══
    if (types.includes("categorias")) {
      try {
        const items = await caFetchAll(token, "/categories");
        const mapped = items.map((c: any) => ({
          codigo: c.id || "",
          descricao: c.name || c.description || "",
          tipo: c.type || "",
          grupo: c.parent_category?.name || "",
          grupo_ref: c.type === "INCOME" ? "1" : c.type === "OUTCOME" ? "3" : "",
        }));
        await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", "categorias");
        await supabase.from("omie_imports").insert({ company_id, import_type: "categorias", import_data: { categoria_cadastro: mapped, fonte: "contaazul" }, record_count: mapped.length });
        results.categorias = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.categorias = { status: "erro", msg: e.message }; }
    }

    // ═══ CONTAS A PAGAR ═══
    if (types.includes("contas_pagar")) {
      try {
        const items = await caFetchAll(token, "/finance/payables");
        const mapped = items.map((p: any) => ({
          codigo_lancamento_omie: p.id || "",
          valor_documento: p.value || p.amount || 0,
          data_vencimento: p.due_date || "",
          data_emissao: p.emission_date || p.document_date || p.due_date || "",
          data_pagamento: p.payment_date || "",
          status_titulo: p.status === "PAID" ? "PAGO" : p.status === "OVERDUE" ? "VENCIDO" : "EM_ABERTO",
          codigo_cliente_fornecedor: p.supplier?.id || p.contact?.id || "",
          descricao_categoria: p.category?.name || "",
          codigo_categoria: p.category?.id || "",
          observacao: p.description || p.note || "",
          numero_documento: p.document_number || "",
          nome_fornecedor: p.supplier?.name || p.contact?.name || "",
        }));
        await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", "contas_pagar");
        await supabase.from("omie_imports").insert({ company_id, import_type: "contas_pagar", import_data: { conta_pagar_cadastro: mapped, fonte: "contaazul" }, record_count: mapped.length });
        results.contas_pagar = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.contas_pagar = { status: "erro", msg: e.message }; }
    }

    // ═══ CONTAS A RECEBER ═══
    if (types.includes("contas_receber")) {
      try {
        const items = await caFetchAll(token, "/finance/receivables");
        const mapped = items.map((r: any) => ({
          codigo_lancamento_omie: r.id || "",
          valor_documento: r.value || r.amount || 0,
          data_vencimento: r.due_date || "",
          data_emissao: r.emission_date || r.document_date || r.due_date || "",
          data_pagamento: r.payment_date || "",
          status_titulo: r.status === "PAID" ? "RECEBIDO" : r.status === "OVERDUE" ? "VENCIDO" : "EM_ABERTO",
          codigo_cliente_fornecedor: r.customer?.id || r.contact?.id || "",
          descricao_categoria: r.category?.name || "",
          codigo_categoria: r.category?.id || "",
          observacao: r.description || r.note || "",
          numero_documento: r.document_number || "",
          nome_cliente: r.customer?.name || r.contact?.name || "",
        }));
        await supabase.from("omie_imports").delete().eq("company_id", company_id).eq("import_type", "contas_receber");
        await supabase.from("omie_imports").insert({ company_id, import_type: "contas_receber", import_data: { conta_receber_cadastro: mapped, fonte: "contaazul" }, record_count: mapped.length });
        results.contas_receber = { total: mapped.length, status: "ok" };
      } catch (e: any) { results.contas_receber = { status: "erro", msg: e.message }; }
    }

    const totalRecords = Object.values(results).reduce((s: number, r: any) => s + (r.total || 0), 0);
    const errors = Object.entries(results).filter(([, r]: any) => r.status === "erro");

    return NextResponse.json({
      success: errors.length === 0,
      message: `ContaAzul sync: ${totalRecords} registros importados${errors.length > 0 ? `, ${errors.length} erro(s)` : ""}`,
      fonte: "contaazul", company_id, results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
