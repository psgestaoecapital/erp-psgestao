// PS Gestão ERP — Compliance Hub (Prestadores PJ/MEI — detalhe)
// GET    /api/compliance/prestadores/[id]
// PATCH  /api/compliance/prestadores/[id]  { campos editaveis }
// DELETE /api/compliance/prestadores/[id]  (soft delete: ativo=false)

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CAMPOS_EDIT = [
  'razao_social', 'cnpj', 'nome_fantasia',
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

async function getId(routeCtx: any): Promise<string> {
  const params = await routeCtx.params
  return params.id as string
}

export const GET = withAuth(async (_req: NextRequest, _ctx, routeCtx) => {
  const id = await getId(routeCtx)
  const { data, error } = await supabaseAdmin
    .from('compliance_prestadores')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return fail(500, `Falha ao consultar prestador: ${error.message}`)
  if (!data) return fail(404, 'Prestador não encontrado.')

  // Matriz de documentos do prestador
  const { data: matriz, error: errMat } = await supabaseAdmin
    .from('v_compliance_matriz_prestadores')
    .select('*')
    .eq('prestador_id', id)
  if (errMat) return fail(500, `Falha ao consultar matriz: ${errMat.message}`)

  // Histórico de documentos
  const { data: historico } = await supabaseAdmin
    .from('compliance_documentos')
    .select('*')
    .eq('prestador_id', id)
    .order('uploaded_at', { ascending: false })

  return NextResponse.json({
    ok: true,
    prestador: data,
    matriz: matriz || [],
    historico: historico || [],
  })
})

export const PATCH = withAuth(async (req: NextRequest, _ctx, routeCtx) => {
  const id = await getId(routeCtx)
  const body = await req.json().catch(() => null)
  if (!body) return fail(400, 'Corpo da requisição inválido.')
  const payload: Record<string, any> = {}
  for (const k of CAMPOS_EDIT) if (k in body) payload[k] = body[k]
  if (Object.keys(payload).length === 0) return fail(400, 'Nada para atualizar.')

  const { data, error } = await supabaseAdmin
    .from('compliance_prestadores')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(400, `Falha ao atualizar prestador: ${error.message}`)
  return NextResponse.json({ ok: true, prestador: data })
})

export const DELETE = withAuth(async (_req: NextRequest, _ctx, routeCtx) => {
  const id = await getId(routeCtx)
  const { error } = await supabaseAdmin
    .from('compliance_prestadores')
    .update({ ativo: false })
    .eq('id', id)
  if (error) return fail(500, `Falha ao desativar prestador: ${error.message}`)
  return NextResponse.json({ ok: true })
})
