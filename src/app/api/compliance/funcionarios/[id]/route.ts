// PS Gestão ERP — Compliance Hub
// GET    /api/compliance/funcionarios/:id          — detalhe + documentos + matriz
// PATCH  /api/compliance/funcionarios/:id          — atualização parcial
// DELETE /api/compliance/funcionarios/:id          — soft delete (ativo=false)

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Next.js 15+: params é Promise.
type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth(async (req: NextRequest, _authCtx: any, ctx?: Ctx) => {
  const { id } = await (ctx as Ctx).params
  const sb = admin()

  const { data: funcionario, error } = await sb
    .from('compliance_funcionarios')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!funcionario) {
    return NextResponse.json({ ok: false, error: 'não encontrado' }, { status: 404 })
  }

  // Matriz (status por tipo de documento) e documentos ativos.
  const [{ data: matriz }, { data: documentos }, { data: historico }] = await Promise.all([
    sb
      .from('v_compliance_matriz_funcionarios')
      .select('*')
      .eq('funcionario_id', id)
      .order('tipo_nome'),
    sb
      .from('compliance_documentos')
      .select('*')
      .eq('funcionario_id', id)
      .eq('ativo', true)
      .order('uploaded_at', { ascending: false }),
    sb
      .from('compliance_documentos')
      .select('*')
      .eq('funcionario_id', id)
      .order('uploaded_at', { ascending: false })
      .limit(200),
  ])

  return NextResponse.json({
    ok: true,
    funcionario,
    matriz: matriz ?? [],
    documentos: documentos ?? [],
    historico: historico ?? [],
  })
}) as any

export const PATCH = withAuth(async (req: NextRequest, _authCtx: any, ctx?: Ctx) => {
  const { id } = await (ctx as Ctx).params
  const body = await req.json().catch(() => ({}))
  const CAMPOS = [
    'nome_completo', 'cpf', 'rg', 'data_nascimento', 'email', 'telefone',
    'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
    'matricula', 'cargo', 'setor', 'funcao', 'data_admissao', 'data_demissao',
    'tipo_contrato', 'salario_base', 'empresa_tomadora_id', 'empresa_tomadora_nome',
    'obra_nome', 'ativo', 'observacoes',
  ]
  const payload: Record<string, any> = { updated_at: new Date().toISOString() }
  for (const k of CAMPOS) if (k in body) payload[k] = body[k]

  const sb = admin()
  const { data, error } = await sb
    .from('compliance_funcionarios')
    .update(payload)
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ ok: false, error: 'não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true, funcionario: data })
}) as any

export const DELETE = withAuth(async (req: NextRequest, _authCtx: any, ctx?: Ctx) => {
  const { id } = await (ctx as Ctx).params
  const sb = admin()
  const { error } = await sb
    .from('compliance_funcionarios')
    .update({ ativo: false, data_demissao: new Date().toISOString().slice(0, 10) })
    .eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}) as any
