// src/app/api/omie/promote/route.ts
// PS Gestão ERP — Promove dados brutos de omie_imports para as tabelas ERP
// operacionais (erp_clientes, erp_pagar, erp_receber). Upsert em lote por
// ref_externa_id (código Omie).
//
// POST /api/omie/promote
// Body: { company_id: string, import_types?: string[] }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const IMPORT_TYPES_PADRAO = ['clientes', 'contas_pagar', 'contas_receber'] as const
type ImportType = typeof IMPORT_TYPES_PADRAO[number]

const BATCH_SIZE = 100       // linhas por insert/upsert
const FETCH_PAGE = 1000      // linhas por página no SELECT inicial
const ON_CONFLICT = 'company_id,ref_externa_sistema,ref_externa_id'

// ─── Helpers ───────────────────────────────────────────────────────────
function parseOmieDate(val: any): string | null {
  if (!val) return null
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function parseOmieNumero(val: any): number {
  if (typeof val === 'number') return val
  if (val == null || val === '') return 0
  const s = String(val).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return isFinite(n) ? n : 0
}

function mapStatusTitulo(status: any): string {
  const s = String(status || '').toUpperCase()
  if (s === 'RECEBIDO' || s === 'PAGO' || s === 'LIQUIDADO') return 'pago'
  if (s === 'VENCIDO') return 'vencido'
  if (s === 'CANCELADO' || s === 'ESTORNADO') return 'cancelado'
  return 'aberto'
}

function extrairRegistros(importData: any): any[] {
  if (!importData || typeof importData !== 'object') return []
  for (const k of Object.keys(importData)) {
    if (Array.isArray(importData[k])) return importData[k]
  }
  return []
}

// ─── Mapeamentos Omie → ERP ────────────────────────────────────────────
function mapCliente(omie: any, companyId: string) {
  return {
    company_id: companyId,
    codigo: String(omie.codigo_cliente_integracao || omie.codigo_cliente_omie || ''),
    razao_social: omie.razao_social || '',
    nome_fantasia: omie.nome_fantasia || omie.razao_social || '',
    tipo_pessoa: (omie.cnpj_cpf || '').length > 11 ? 'PJ' : 'PF',
    cpf_cnpj: (omie.cnpj_cpf || '').replace(/\D/g, ''),
    ie: omie.inscricao_estadual || '',
    im: omie.inscricao_municipal || '',
    telefone: (omie.telefone1_ddd || '') + (omie.telefone1_numero || ''),
    celular: (omie.telefone2_ddd || '') + (omie.telefone2_numero || ''),
    email: omie.email || '',
    site: omie.homepage || '',
    cep: (omie.cep || '').replace(/\D/g, ''),
    logradouro: omie.endereco || '',
    numero: omie.endereco_numero || '',
    complemento: omie.complemento || '',
    bairro: omie.bairro || '',
    cidade: omie.cidade || '',
    uf: omie.estado || '',
    atividade_principal: omie.cnae || '',
    situacao_cadastral: omie.inativo === 'S' ? 'Inativo' : 'Ativo',
    observacoes: omie.observacao || '',
    ref_externa_sistema: 'OMIE',
    ref_externa_id: String(omie.codigo_cliente_omie || ''),
    ativo: omie.inativo !== 'S',
    bloqueado: omie.bloqueado === 'S',
  }
}

function mapTituloFinanceiro(r: any, companyId: string) {
  const refId = String(
    r.codigo_lancamento_omie ||
    r.codigo_lancamento_integracao ||
    r.codigo_lancamento ||
    ''
  )
  return {
    company_id: companyId,
    ref_externa_sistema: 'OMIE',
    ref_externa_id: refId,
    descricao: r.observacao || r.descricao_categoria || r.descricao || `Omie ${refId}`,
    valor: parseOmieNumero(r.valor_documento ?? r.valor),
    valor_pago: parseOmieNumero(r.valor_pago),
    data_emissao: parseOmieDate(r.data_emissao),
    data_vencimento: parseOmieDate(r.data_vencimento),
    data_pagamento: parseOmieDate(r.data_pagamento),
    status: mapStatusTitulo(r.status_titulo),
    categoria: r.descricao_categoria || '',
    numero_documento: r.numero_documento || '',
    numero_nf: r.numero_nf || '',
  }
}

// ─── Acesso a dados em lote ────────────────────────────────────────────
async function carregarImport(companyId: string, importType: string) {
  const { data } = await supabase
    .from('omie_imports')
    .select('import_data')
    .eq('company_id', companyId)
    .eq('import_type', importType)
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return extrairRegistros(data?.import_data)
}

// Carrega todos os registros de uma tabela ERP que já têm ref_externa_id
// Omie e retorna um Map<ref_externa_id, id>. Usado para:
//   (1) detectar "novos vs existentes" antes do upsert
//   (2) resolver FK cliente_id / fornecedor_id nos títulos financeiros
async function carregarMapaRefExterna(
  companyId: string,
  tabela: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(tabela)
      .select('id, ref_externa_id')
      .eq('company_id', companyId)
      .eq('ref_externa_sistema', 'OMIE')
      .not('ref_externa_id', 'is', null)
      .range(from, from + FETCH_PAGE - 1)
    if (error) throw new Error(`select ${tabela}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const row of data) {
      if (row.ref_externa_id) map.set(String(row.ref_externa_id), row.id as string)
    }
    if (data.length < FETCH_PAGE) break
    from += FETCH_PAGE
  }
  return map
}

// Batch INSERT: tenta em lotes de BATCH_SIZE; se um lote falhar, cai pra
// inserção individual só dos registros daquele lote pra não perder tudo.
async function batchInsert(
  tabela: string,
  rows: any[],
  errors: string[]
): Promise<number> {
  if (rows.length === 0) return 0
  let ok = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const lote = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from(tabela).insert(lote)
    if (!error) { ok += lote.length; continue }

    for (const r of lote) {
      const { error: e } = await supabase.from(tabela).insert(r)
      if (e) errors.push(`${tabela} insert[${r.ref_externa_id}]: ${e.message}`)
      else ok++
    }
  }
  return ok
}

// Batch UPSERT (UPDATE via ON CONFLICT) — usado para registros já existentes.
// Depende do UNIQUE INDEX em (company_id, ref_externa_sistema, ref_externa_id).
async function batchUpsert(
  tabela: string,
  rows: any[],
  errors: string[]
): Promise<number> {
  if (rows.length === 0) return 0
  let ok = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const lote = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from(tabela)
      .upsert(lote, { onConflict: ON_CONFLICT })
    if (!error) { ok += lote.length; continue }

    for (const r of lote) {
      const { error: e } = await supabase
        .from(tabela)
        .upsert(r, { onConflict: ON_CONFLICT })
      if (e) errors.push(`${tabela} upsert[${r.ref_externa_id}]: ${e.message}`)
      else ok++
    }
  }
  return ok
}

// ─── Promoção por tipo ─────────────────────────────────────────────────
async function promoverClientes(companyId: string, errors: string[]): Promise<number> {
  const registros = await carregarImport(companyId, 'clientes')
  if (registros.length === 0) return 0

  const existentesMap = await carregarMapaRefExterna(companyId, 'erp_clientes')

  const novos: any[] = []
  const existentes: any[] = []
  for (const omie of registros) {
    const dados = mapCliente(omie, companyId)
    if (!dados.razao_social || !dados.ref_externa_id) continue
    if (existentesMap.has(dados.ref_externa_id)) existentes.push(dados)
    else novos.push(dados)
  }

  const ins = await batchInsert('erp_clientes', novos, errors)
  const upd = await batchUpsert('erp_clientes', existentes, errors)
  return ins + upd
}

async function promoverTitulos(
  companyId: string,
  importType: 'contas_pagar' | 'contas_receber',
  errors: string[]
): Promise<number> {
  const tabela = importType === 'contas_pagar' ? 'erp_pagar' : 'erp_receber'
  const tabelaVinculo = importType === 'contas_pagar' ? 'erp_fornecedores' : 'erp_clientes'
  const campoVinculoId = importType === 'contas_pagar' ? 'fornecedor_id' : 'cliente_id'
  const campoVinculoNome = importType === 'contas_pagar' ? 'fornecedor_nome' : 'cliente_nome'

  const registros = await carregarImport(companyId, importType)
  if (registros.length === 0) return 0

  // Dois selects em paralelo: títulos já existentes + mapa de vínculo (FK).
  const [existentesMap, vinculoMap] = await Promise.all([
    carregarMapaRefExterna(companyId, tabela),
    carregarMapaRefExterna(companyId, tabelaVinculo),
  ])

  const novos: any[] = []
  const existentes: any[] = []
  for (const r of registros) {
    const dados: Record<string, any> = mapTituloFinanceiro(r, companyId)
    if (!dados.ref_externa_id) continue

    const vinculoRefId = String(r.codigo_cliente_fornecedor || r.codigo_cliente || '')
    const vinculoId = vinculoRefId ? vinculoMap.get(vinculoRefId) : undefined
    if (vinculoId) dados[campoVinculoId] = vinculoId
    dados[campoVinculoNome] = r.nome_cliente || r.nome_fornecedor || ''

    if (existentesMap.has(dados.ref_externa_id)) existentes.push(dados)
    else novos.push(dados)
  }

  const ins = await batchInsert(tabela, novos, errors)
  const upd = await batchUpsert(tabela, existentes, errors)
  return ins + upd
}

// ─── Handler ───────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const inicio = Date.now()
  try {
    const body = await req.json().catch(() => ({}))
    const { company_id, import_types } = body as {
      company_id?: string
      import_types?: string[]
    }

    if (!company_id) {
      return NextResponse.json(
        { ok: false, error: 'company_id obrigatório', processed: { clientes: 0, pagar: 0, receber: 0 }, errors: [] },
        { status: 400 }
      )
    }

    const tipos = (Array.isArray(import_types) && import_types.length > 0
      ? import_types
      : IMPORT_TYPES_PADRAO) as ImportType[]

    const processed = { clientes: 0, pagar: 0, receber: 0 }
    const errors: string[] = []

    // Clientes primeiro: pagar/receber resolvem FK contra erp_clientes/erp_fornecedores.
    if (tipos.includes('clientes')) {
      processed.clientes = await promoverClientes(company_id, errors)
    }
    if (tipos.includes('contas_pagar')) {
      processed.pagar = await promoverTitulos(company_id, 'contas_pagar', errors)
    }
    if (tipos.includes('contas_receber')) {
      processed.receber = await promoverTitulos(company_id, 'contas_receber', errors)
    }

    return NextResponse.json({
      ok: true,
      processed,
      errors,
      duracao_ms: Date.now() - inicio,
    })
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        processed: { clientes: 0, pagar: 0, receber: 0 },
        errors: [err.message],
        duracao_ms: Date.now() - inicio,
      },
      { status: 500 }
    )
  }
}
