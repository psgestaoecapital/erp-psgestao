// PS Gestão ERP — Compliance Validação Automática
// POST /api/compliance/consultas       — enfileira nova consulta (manual)
// GET  /api/compliance/consultas       — lista historico com filtros
//
// Idempotente via fn_compliance_enfileirar_consulta no banco: se já existir
// sucesso < 24h ou pendente, devolve a mesma id.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALVO_TIPOS = new Set(['empresa_propria', 'funcionario', 'prestador', 'fornecedor', 'cliente', 'avulso'])
const PROVEDORES = new Set(['cndt_tst', 'negativa_federal', 'negativa_fgts'])

function fail(status: number, mensagem_humana: string) {
  return NextResponse.json({ ok: false, error: mensagem_humana, mensagem_humana }, { status })
}

function limparDoc(s: string): string {
  return (s || '').replace(/\D+/g, '')
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const body = await req.json().catch(() => null)
  if (!body) return fail(400, 'Corpo da requisição inválido.')

  const company_id = (body.company_id as string | undefined) || ''
  const alvo_tipo = (body.alvo_tipo as string | undefined) || ''
  const alvo_id = (body.alvo_id as string | null | undefined) ?? null
  const alvo_documento_raw = (body.alvo_documento as string | undefined) || ''
  const alvo_nome = (body.alvo_nome as string | null | undefined) ?? null
  const provedor_codigo = (body.provedor_codigo as string | undefined) || ''
  const prioridade = Number.isInteger(body.prioridade) ? body.prioridade : 5

  if (!company_id) return fail(400, 'company_id é obrigatório.')
  if (!ALVO_TIPOS.has(alvo_tipo)) return fail(400, `alvo_tipo inválido. Aceitos: ${Array.from(ALVO_TIPOS).join(', ')}.`)
  if (!PROVEDORES.has(provedor_codigo)) return fail(400, `provedor_codigo inválido. Aceitos: ${Array.from(PROVEDORES).join(', ')}.`)

  const alvo_documento = limparDoc(alvo_documento_raw)
  if (alvo_documento.length !== 11 && alvo_documento.length !== 14) {
    return fail(400, 'alvo_documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos.')
  }

  const { data, error } = await supabaseAdmin.rpc('fn_compliance_enfileirar_consulta', {
    p_company_id: company_id,
    p_alvo_tipo: alvo_tipo,
    p_alvo_id: alvo_id,
    p_alvo_documento: alvo_documento,
    p_alvo_nome: alvo_nome,
    p_provedor_codigo: provedor_codigo,
    p_iniciada_por: userId,
    p_iniciada_via: 'manual',
    p_prioridade: prioridade,
  })

  if (error) return fail(500, `Falha ao enfileirar: ${error.message}`)

  // A função retorna o UUID. Verifica se é nova ou reaproveitada checando status.
  const consulta_id = data as string
  const { data: registro } = await supabaseAdmin
    .from('compliance_consultas')
    .select('status, created_at')
    .eq('id', consulta_id)
    .maybeSingle()

  const reaproveitada = registro
    ? (Date.now() - new Date((registro as any).created_at).getTime()) > 5_000
    : false

  return NextResponse.json({
    ok: true,
    consulta_id,
    status: reaproveitada ? 'reaproveitada' : 'enfileirada',
    detalhe: registro?.status || 'pendente',
  })
})

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url)
  const company_id = url.searchParams.get('company_id')
  const alvo_tipo = url.searchParams.get('alvo_tipo')
  const alvo_id = url.searchParams.get('alvo_id')
  const status = url.searchParams.get('status')
  const provedor_codigo = url.searchParams.get('provedor_codigo')
  const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 500)

  if (!company_id) return fail(400, 'company_id é obrigatório.')

  let q = supabaseAdmin
    .from('compliance_consultas')
    .select('*')
    .eq('company_id', company_id)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (alvo_tipo) q = q.eq('alvo_tipo', alvo_tipo)
  if (alvo_id) q = q.eq('alvo_id', alvo_id)
  if (status) q = q.eq('status', status)
  if (provedor_codigo) q = q.eq('provedor_codigo', provedor_codigo)

  const { data, error } = await q
  if (error) return fail(500, `Falha ao listar: ${error.message}`)

  return NextResponse.json({ ok: true, consultas: data || [] })
})
