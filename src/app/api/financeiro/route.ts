import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const SUPA_URL = "https://horsymhsinqcimflrtjo.supabase.co";
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

const TABELAS_VALIDAS = ["erp_clientes","erp_fornecedores","erp_receber","erp_pagar","erp_produtos","erp_contas_bancarias","erp_movimentacoes","erp_categorias","erp_centros_custo"];

function validarTabela(tipo: string): string | null {
  const tabela = tipo.startsWith("erp_") ? tipo : `erp_${tipo}`;
  return TABELAS_VALIDAS.includes(tabela) ? tabela : null;
}

// GET — lista registros
export async function GET(req: NextRequest) {
  const { searchParams } = new (globalThis as any).URL(req.url);
  const companyId = searchParams.get("company_id");
  const tipo = searchParams.get("tipo");
  const status = searchParams.get("status");
  const busca = searchParams.get("busca");
  const limite = parseInt(searchParams.get("limite") || "500");

  if (!companyId || !tipo) return NextResponse.json({ error: "company_id e tipo obrigatórios" }, { status: 400 });
  const tabela = validarTabela(tipo);
  if (!tabela) return NextResponse.json({ error: `Tipo inválido: ${tipo}` }, { status: 400 });

  const sb = createClient(SUPA_URL, KEY());
  let query = sb.from(tabela).select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(limite);

  if (status && (tabela === "erp_receber" || tabela === "erp_pagar")) query = query.eq("status", status);
  if (busca) query = query.or(`nome.ilike.%${busca}%,descricao.ilike.%${busca}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resumo para contas a pagar/receber
  let resumo = null;
  if (tabela === "erp_receber" || tabela === "erp_pagar") {
    const todos = data || [];
    resumo = {
      total: todos.length,
      aberto: todos.filter((r: any) => r.status === "aberto").reduce((s: number, r: any) => s + (r.valor || 0), 0),
      vencido: todos.filter((r: any) => r.status === "vencido" || (r.status === "aberto" && new Date(r.data_vencimento) < new Date())).reduce((s: number, r: any) => s + (r.valor || 0), 0),
      pago: todos.filter((r: any) => r.status === "pago").reduce((s: number, r: any) => s + (r.valor_pago || r.valor || 0), 0),
      qtdAberto: todos.filter((r: any) => r.status === "aberto").length,
      qtdVencido: todos.filter((r: any) => r.status === "vencido" || (r.status === "aberto" && new Date(r.data_vencimento) < new Date())).length,
      qtdPago: todos.filter((r: any) => r.status === "pago").length,
    };
  }

  return NextResponse.json({ success: true, data: data || [], total: data?.length || 0, resumo });
}

// POST — criar
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tipo, ...dados } = body;
  if (!tipo || !dados.company_id) return NextResponse.json({ error: "tipo e company_id obrigatórios" }, { status: 400 });
  const tabela = validarTabela(tipo);
  if (!tabela) return NextResponse.json({ error: `Tipo inválido: ${tipo}` }, { status: 400 });

  const sb = createClient(SUPA_URL, KEY());
  const { data, error } = await sb.from(tabela).insert(dados).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}

// PUT — atualizar
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { tipo, id, ...dados } = body;
  if (!tipo || !id) return NextResponse.json({ error: "tipo e id obrigatórios" }, { status: 400 });
  const tabela = validarTabela(tipo);
  if (!tabela) return NextResponse.json({ error: `Tipo inválido: ${tipo}` }, { status: 400 });

  dados.updated_at = new Date().toISOString();
  const sb = createClient(SUPA_URL, KEY());
  const { data, error } = await sb.from(tabela).update(dados).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}

// DELETE — excluir
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo");
  const id = searchParams.get("id");
  if (!tipo || !id) return NextResponse.json({ error: "tipo e id obrigatórios" }, { status: 400 });
  const tabela = validarTabela(tipo);
  if (!tabela) return NextResponse.json({ error: `Tipo inválido: ${tipo}` }, { status: 400 });

  const sb = createClient(SUPA_URL, KEY());
  const { error } = await sb.from(tabela).delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
