// src/app/api/omie/promote/route.ts
// PS Gestão ERP — Promove dados brutos de omie_imports para as tabelas ERP
// operacionais (erp_clientes, erp_pagar, erp_receber). Upsert por
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

// omie_imports.import_data guarda o payload bruto da Omie — o array de
// registros fica numa chave específica (clientes_cadastro,
// conta_pagar_cadastro, conta_receber_cadastro). Pegamos o primeiro array
// encontrado pra ser tolerante a variações (Nibo/ContaAzul com fonte=...).
function extrairRegistros(importData: any): any[] {
  if (!importData || typeof importData !== 'object') return []
  for (const k of Object.keys(importData)) {
    if (Array.isArray(importData[k])) return importData[k]
  }
  return []
}

// ─── Mapeamentos Omie → ERP ────────────────────────────────────────────
// Espelha o mapeamento de /api/sync/omie/clientes/route.ts pra manter
// consistência entre a rota que sincroniza da API Omie e esta que promove
// a partir do snapshot salvo em omie_imports.
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

// ─── Promoção por tipo ─────────────────────────────────────────────────
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

async function promoverClientes(companyId: string, errors: string[]): Promise<number> {
  const registros = await carregarImport(companyId, 'clientes')
  let processed = 0

  for (const omie of registros) {
    try {
      const dados = mapCliente(omie, companyId)
      if (!dados.razao_social || !dados.ref_externa_id) continue

      const { data: existing } = await supabase
        .from('erp_clientes')
        .select('id')
        .eq('company_id', companyId)
        .eq('ref_externa_sistema', 'OMIE')
        .eq('ref_externa_id', dados.ref_externa_id)
        .maybeSingle()

      if (existing) {
        const { error } = await supabase.from('erp_clientes').update(dados).eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('erp_clientes').insert(dados)
        if (error) throw error
      }
      processed++
    } catch (err: any) {
      errors.push(`clientes[${omie?.codigo_cliente_omie ?? '?'}]: ${err.message}`)
    }
  }
  return processed
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
  let processed = 0

  // Cache de lookup cliente/fornecedor → id (evita N queries no loop).
  const vinculoCache = new Map<string, string | null>()
  const resolverVinculo = async (refId: string): Promise<string | null> => {
    if (!refId) return null
    if (vinculoCache.has(refId)) return vinculoCache.get(refId) ?? null
    const { data } = await supabase
      .from(tabelaVinculo)
      .select('id')
      .eq('company_id', companyId)
      .eq('ref_externa_sistema', 'OMIE')
      .eq('ref_externa_id', refId)
      .maybeSingle()
    const id = data?.id ?? null
    vinculoCache.set(refId, id)
    return id
  }

  for (const r of registros) {
    try {
      const dados: Record<string, any> = mapTituloFinanceiro(r, companyId)
      if (!dados.ref_externa_id) continue

      const vinculoRefId = String(r.codigo_cliente_fornecedor || r.codigo_cliente || '')
      const vinculoId = await resolverVinculo(vinculoRefId)
      if (vinculoId) dados[campoVinculoId] = vinculoId
      dados[campoVinculoNome] = r.nome_cliente || r.nome_fornecedor || ''

      const { data: existing } = await supabase
        .from(tabela)
        .select('id')
        .eq('company_id', companyId)
        .eq('ref_externa_sistema', 'OMIE')
        .eq('ref_externa_id', dados.ref_externa_id)
        .maybeSingle()

      if (existing) {
        const { error } = await supabase.from(tabela).update(dados).eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from(tabela).insert(dados)
        if (error) throw error
      }
      processed++
    } catch (err: any) {
      errors.push(`${importType}[${r?.codigo_lancamento_omie ?? '?'}]: ${err.message}`)
    }
  }
  return processed
}

// ─── Handler ───────────────────────────────────────────────────────────
export async function POST(req: Request) {
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

    return NextResponse.json({ ok: true, processed, errors })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message, processed: { clientes: 0, pagar: 0, receber: 0 }, errors: [err.message] },
      { status: 500 }
    )
  }
}
