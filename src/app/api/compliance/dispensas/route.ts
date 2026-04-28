// PS Gestão ERP — Compliance Hub
// POST   /api/compliance/dispensas   { company_id, tipo_documento_id, funcionario_id?, motivo? }
// DELETE /api/compliance/dispensas   { id } | { company_id, tipo_documento_id, funcionario_id? }
//
// Marca um par (empresa, tipo_documento[, funcionario]) como "não se aplica".
// A view v_compliance_matriz_funcionarios já reflete dispensas ativas como
// status_final='nao_se_aplica'. Soft delete via flag ativo=false.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function fail(status: number, mensagem_humana: string) {
  return NextResponse.json({ ok: false, error: mensagem_humana, mensagem_humana }, { status })
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const body = await req.json().catch(() => null)
  if (!body) return fail(400, 'Corpo da requisição inválido.')

  const company_id = (body.company_id as string | undefined) || ''
  const tipo_documento_id = (body.tipo_documento_id as string | undefined) || ''
  const funcionario_id = (body.funcionario_id as string | null | undefined) ?? null
  const motivo = (body.motivo as string | null | undefined) ?? null

  if (!company_id || !tipo_documento_id) {
    return fail(400, 'company_id e tipo_documento_id são obrigatórios.')
  }

  // Tenta reativar dispensa existente; se não existir, insere nova.
  // Filtros NULL precisam de tratamento explícito porque .eq() com null não casa.
  let upd = supabaseAdmin
    .from('compliance_dispensas')
    .update({
      ativo: true,
      motivo,
      dispensado_por: userId,
      dispensado_em: new Date().toISOString(),
    })
    .eq('company_id', company_id)
    .eq('tipo_documento_id', tipo_documento_id)
  upd = funcionario_id ? upd.eq('funcionario_id', funcionario_id) : upd.is('funcionario_id', null)
  const { data: existentes, error: updErr } = await upd.select('*')

  if (updErr) {
    return fail(500, `Falha ao registrar dispensa: ${updErr.message}`)
  }

  if (existentes && existentes.length > 0) {
    return NextResponse.json({ ok: true, dispensa: existentes[0] })
  }

  const { data: nova, error: insErr } = await supabaseAdmin
    .from('compliance_dispensas')
    .insert({
      company_id,
      tipo_documento_id,
      funcionario_id,
      motivo,
      dispensado_por: userId,
      ativo: true,
    })
    .select('*')
    .single()

  if (insErr) {
    return fail(500, `Falha ao registrar dispensa: ${insErr.message}`)
  }

  return NextResponse.json({ ok: true, dispensa: nova })
})

export const DELETE = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => null)
  if (!body) return fail(400, 'Corpo da requisição inválido.')

  const id = body.id as string | undefined
  const company_id = body.company_id as string | undefined
  const tipo_documento_id = body.tipo_documento_id as string | undefined
  const funcionario_id = (body.funcionario_id as string | null | undefined) ?? null

  if (!id && !(company_id && tipo_documento_id)) {
    return fail(400, 'Informe id da dispensa ou (company_id + tipo_documento_id).')
  }

  let q = supabaseAdmin.from('compliance_dispensas').update({ ativo: false })
  if (id) {
    q = q.eq('id', id)
  } else {
    q = q.eq('company_id', company_id!).eq('tipo_documento_id', tipo_documento_id!)
    q = funcionario_id ? q.eq('funcionario_id', funcionario_id) : q.is('funcionario_id', null)
  }

  const { error } = await q
  if (error) return fail(500, `Falha ao revogar dispensa: ${error.message}`)
  return NextResponse.json({ ok: true })
})
