// PS Gestão ERP — Compliance Hub
// GET  /api/compliance/funcionarios?company_id=...&q=...&cargo=...&setor=...&empresa_tomadora=...&status=...
// POST /api/compliance/funcionarios  { company_id, nome_completo, cpf?, ... }

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url)
  const companyIdsParam = url.searchParams.get('company_ids')
  const companyIdParam = url.searchParams.get('company_id')
  const companyIds = companyIdsParam
    ? companyIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : companyIdParam
      ? [companyIdParam]
      : []
  const q = (url.searchParams.get('q') || '').trim()
  const cargo = url.searchParams.get('cargo')
  const setor = url.searchParams.get('setor')
  const empresaTomadora = url.searchParams.get('empresa_tomadora')
  const ativo = url.searchParams.get('ativo')

  const sb = admin()
  let query = sb.from('compliance_funcionarios').select('*').order('nome_completo')
  if (companyIds.length > 0) {
    // Empregadora (company_id) OU tomadora (empresa_tomadora_id) — terceirização.
    const idsCsv = companyIds.join(',')
    query = query.or(`company_id.in.(${idsCsv}),empresa_tomadora_id.in.(${idsCsv})`)
  }
  if (cargo) query = query.eq('cargo', cargo)
  if (setor) query = query.eq('setor', setor)
  if (empresaTomadora) query = query.eq('empresa_tomadora_nome', empresaTomadora)
  if (ativo === 'true') query = query.eq('ativo', true)
  if (ativo === 'false') query = query.eq('ativo', false)
  if (q) {
    const esc = q.replace(/[%_]/g, (c) => '\\' + c)
    query = query.or(`nome_completo.ilike.%${esc}%,cpf.ilike.%${esc}%,matricula.ilike.%${esc}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // Computa % de documentos em dia por funcionário usando a view.
  const ids = (data || []).map((f: any) => f.id)
  const resumo: Record<string, { total: number; em_dia: number; pct: number }> = {}
  if (ids.length > 0) {
    const { data: matriz } = await sb
      .from('v_compliance_matriz_funcionarios')
      .select('funcionario_id, obrigatorio, status_final')
      .in('funcionario_id', ids)
    for (const m of (matriz as any[]) || []) {
      if (!m.obrigatorio) continue
      const f = (resumo[m.funcionario_id] ||= { total: 0, em_dia: 0, pct: 0 })
      f.total++
      if (m.status_final === 'valido') f.em_dia++
    }
    for (const k of Object.keys(resumo)) {
      const r = resumo[k]
      r.pct = r.total > 0 ? Math.round((r.em_dia / r.total) * 100) : 0
    }
  }

  const funcionarios = (data || []).map((f: any) => ({
    ...f,
    compliance_resumo: resumo[f.id] ?? { total: 0, em_dia: 0, pct: 0 },
  }))
  return NextResponse.json({ ok: true, funcionarios })
})

export const POST = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  if (!body.company_id || !body.nome_completo) {
    return NextResponse.json(
      { ok: false, error: 'company_id e nome_completo obrigatórios' },
      { status: 400 }
    )
  }

  // Whitelist dos campos aceitos para evitar injeção de colunas não esperadas.
  const CAMPOS = [
    'company_id', 'nome_completo', 'cpf', 'rg', 'data_nascimento', 'email', 'telefone',
    'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
    'matricula', 'cargo', 'setor', 'funcao', 'data_admissao', 'data_demissao',
    'tipo_contrato', 'salario_base', 'empresa_tomadora_id', 'empresa_tomadora_nome',
    'obra_nome', 'ativo', 'observacoes',
  ]
  const payload: Record<string, any> = {}
  for (const k of CAMPOS) if (k in body) payload[k] = body[k]

  const sb = admin()
  const { data, error } = await sb
    .from('compliance_funcionarios')
    .insert(payload)
    .select('*')
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, funcionario: data })
})
