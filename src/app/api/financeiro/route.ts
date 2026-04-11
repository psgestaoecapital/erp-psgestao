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

  // ═══ UNIFICAÇÃO: Merge com omie_imports ═══
  let merged = (data || []).map((d: any) => ({ ...d, _origem: "PS Gestão", _editavel: true }));

  const IMPORT_MAP: Record<string, string> = {
    erp_receber: "contas_receber",
    erp_pagar: "contas_pagar",
    erp_clientes: "clientes",
    erp_fornecedores: "fornecedores",
  };

  const importType = IMPORT_MAP[tabela];
  if (importType) {
    const { data: imports } = await sb.from("omie_imports")
      .select("import_data, imported_at, record_count")
      .eq("company_id", companyId)
      .eq("import_type", importType)
      .order("imported_at", { ascending: false })
      .limit(1);

    if (imports && imports.length > 0) {
      const importData = imports[0].import_data;
      const importedAt = imports[0].imported_at;
      // Detectar fonte (Omie ou Nibo)
      const fonte = importData?.fonte || "Omie";

      // Extrair array de registros do import
      let registros: any[] = [];
      const keys = Object.keys(importData || {});
      for (const k of keys) {
        if (Array.isArray(importData[k])) { registros = importData[k]; break; }
      }

      // Mapear para formato unificado
      const importados = registros.map((r: any, idx: number) => {
        if (tabela === "erp_receber" || tabela === "erp_pagar") {
          return {
            id: `imp_${importType}_${idx}`,
            descricao: r.descricao_categoria || r.observacao || r.descricao || `Lançamento ${fonte} #${idx + 1}`,
            valor: r.valor_documento || r.valor || 0,
            valor_pago: r.valor_pago || 0,
            data_vencimento: r.data_vencimento || "",
            data_emissao: r.data_emissao || "",
            data_pagamento: r.data_pagamento || "",
            status_titulo: r.status_titulo || "",
            status: r.status_titulo === "RECEBIDO" || r.status_titulo === "PAGO" ? "pago" :
                    r.status_titulo === "VENCIDO" ? "vencido" :
                    r.status_titulo === "CANCELADO" ? "cancelado" : "aberto",
            cliente_nome: r.nome_cliente || "",
            fornecedor_nome: r.nome_fornecedor || "",
            categoria: r.descricao_categoria || "",
            numero_documento: r.numero_documento || "",
            numero_nf: r.numero_nf || "",
            _origem: fonte,
            _editavel: false,
            _importadoEm: importedAt,
          };
        }
        if (tabela === "erp_clientes") {
          return {
            id: `imp_cli_${idx}`,
            nome: r.razao_social || r.nome || r.nome_fantasia || "",
            nome_fantasia: r.nome_fantasia || "",
            cpf_cnpj: r.cnpj_cpf || "",
            email: r.email || "",
            telefone: r.telefone || "",
            cidade: r.cidade || "",
            uf: r.uf || "",
            _origem: fonte,
            _editavel: false,
          };
        }
        if (tabela === "erp_fornecedores") {
          return {
            id: `imp_for_${idx}`,
            nome: r.razao_social || r.nome || "",
            nome_fantasia: r.nome_fantasia || "",
            cpf_cnpj: r.cnpj_cpf || "",
            email: r.email || "",
            telefone: r.telefone || "",
            cidade: r.cidade || "",
            uf: r.uf || "",
            _origem: fonte,
            _editavel: false,
          };
        }
        return null;
      }).filter(Boolean);

      // Deduplicar por número documento ou nome+valor
      const idsExistentes = new Set(merged.map((m: any) => `${m.numero_documento||""}_${m.valor||""}_${m.nome||""}`));
      const novos = importados.filter((imp: any) => {
        const key = `${imp.numero_documento||""}_${imp.valor||""}_${imp.nome||""}`;
        return !idsExistentes.has(key);
      });

      merged = [...merged, ...novos];
    }
  }

  // Filtro por status nos importados
  if (status && status !== "todos" && (tabela === "erp_receber" || tabela === "erp_pagar")) {
    merged = merged.filter((m: any) => m.status === status);
  }

  // Resumo para contas a pagar/receber
  let resumo = null;
  if (tabela === "erp_receber" || tabela === "erp_pagar") {
    const todos = merged;
    resumo = {
      total: todos.length,
      aberto: todos.filter((r: any) => r.status === "aberto").reduce((s: number, r: any) => s + (r.valor || 0), 0),
      vencido: todos.filter((r: any) => r.status === "vencido" || (r.status === "aberto" && r.data_vencimento && new Date(r.data_vencimento) < new Date())).reduce((s: number, r: any) => s + (r.valor || 0), 0),
      pago: todos.filter((r: any) => r.status === "pago").reduce((s: number, r: any) => s + (r.valor_pago || r.valor || 0), 0),
      qtdAberto: todos.filter((r: any) => r.status === "aberto").length,
      qtdVencido: todos.filter((r: any) => r.status === "vencido" || (r.status === "aberto" && r.data_vencimento && new Date(r.data_vencimento) < new Date())).length,
      qtdPago: todos.filter((r: any) => r.status === "pago").length,
      qtdPSGestao: todos.filter((r: any) => r._origem === "PS Gestão").length,
      qtdOmie: todos.filter((r: any) => r._origem === "Omie").length,
      qtdNibo: todos.filter((r: any) => r._origem === "Nibo").length,
    };
  }

  return NextResponse.json({ success: true, data: merged, total: merged.length, resumo });
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
