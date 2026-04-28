// PS Gestão ERP — Compliance Hub (Prestadores PJ/MEI)
// GET  /api/compliance/prestadores?company_ids=...&q=...&ativo=true
// POST /api/compliance/prestadores  { company_id, razao_social, cnpj, ... }

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CAMPOS = [
  'company_id', 'razao_social', 'cnpj', 'nome_fantasia',
  'responsavel_nome', 'responsavel_cpf', 'email', 'telefone',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
  'tipo_contrato', 'data_contrato_inicio', 'data_contrato_fim',
  'valor_contrato_mensal', 'servico_descricao',
  'empresa_tomadora_id', 'empresa_tomadora_nome', 'obra_nome',
  'ativo', 'observacoes',
]

function fail(status: number, mensagem_humana: string) {
  return NextResponse.json({ ok: false, error: mensagem_humana, mensagem_humana }, { status })
}

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url)
  const idsParam = url.searchParams.get('company_ids')
  const idParam = url.searchParams.get('company_id')
  const ids = idsParam ? idsParam.split(',').map((s) => s.trim()).filter(Boolean) : (idParam ? [idParam] : [])
  const q = (url.searchParams.get('q') || '').trim()
  const ativo = url.searchParams.get('ativo')

  let query = supabaseAdmin.from('compliance_prestadores').select('*').order('razao_social')
  if (ids.length > 0) {
    const csv = ids.join(',')
    query = query.or(`company_id.in.(${csv}),empresa_tomadora_id.in.(${csv})`)
  }
  if (ativo === 'true') query = query.eq('ativo', true)
  if (ativo === 'false') query = query.eq('ativo', false)
  if (q) {
    const esc = q.replace(/[%_]/g, (c) => '\\' + c)
    query = query.or(`razao_social.ilike.%${esc}%,cnpj.ilike.%${esc}%,nome_fantasia.ilike.%${esc}%`)
  }

  const { data, error } = await query
  if (error) return fail(500, `Falha ao consultar prestadores: ${error.message}`)

  // Resumo de compliance via view de matriz prestadores.
  const presIds = (data || []).map((p: any) => p.id)
  const resumo: Record<string, { total: number; em_dia: number; pct: number }> = {}
  if (presIds.length > 0) {
    const { data: matriz } = await supabaseAdmin
      .from('v_compliance_matriz_prestadores')
      .select('prestador_id, obrigatorio, status_final')
      .in('prestador_id', presIds)
    for (const m of (matriz as any[]) || []) {
      if (!m.obrigatorio) continue
      const r = (resumo[m.prestador_id] ||= { total: 0, em_dia: 0, pct: 0 })
      r.total++
      if (m.status_final === 'valido') r.em_dia++
    }
    for (const k of Object.keys(resumo)) {
      const r = resumo[k]
      r.pct = r.total > 0 ? Math.round((r.em_dia / r.total) * 100) : 0
    }
  }

  const prestadores = (data || []).map((p: any) => ({
    ...p,
    compliance_resumo: resumo[p.id] ?? { total: 0, em_dia: 0, pct: 0 },
  }))
  return NextResponse.json({ ok: true, prestadores })
})

export const POST = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => null)
  if (!body) return fail(400, 'Corpo da requisição inválido.')
  if (!body.company_id || !body.razao_social || !body.cnpj) {
    return fail(400, 'company_id, razao_social e cnpj são obrigatórios.')
  }
  const payload: Record<string, any> = {}
  for (const k of CAMPOS) if (k in body) payload[k] = body[k]

  const { data, error } = await supabaseAdmin
    .from('compliance_prestadores')
    .insert(payload)
    .select('*')
    .single()
  if (error) return fail(400, `Falha ao criar prestador: ${error.message}`)
  return NextResponse.json({ ok: true, prestador: data })
})
