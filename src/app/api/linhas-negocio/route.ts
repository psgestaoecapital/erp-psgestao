import { NextRequest, NextResponse } from 'next/server'
import { exigirLogin, exigirEmpresas, negar } from '@/lib/auth/guardaApi'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Empresa REAL do registro (service_role) — a checagem usa ela, nunca a do body.
async function empresaDaLinha(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await sb.from('linhas_negocio').select('empresa_id').eq('id', id).maybeSingle()
  return (data as { empresa_id?: string } | null)?.empresa_id ?? null
}

export const GET = exigirLogin(async (req: NextRequest, u) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  if (!empresaId) return NextResponse.json({ error: 'empresa_id obrigatório' }, { status: 400 })
  const negado = await exigirEmpresas(u, [empresaId])
  if (negado) return negado

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await sb
    .from('linhas_negocio').select('*')
    .eq('empresa_id', empresaId).eq('ativo', true)
    .order('ordem')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
})

export const POST = exigirLogin(async (req: NextRequest, u) => {
  const body = await req.json()
  const negado = await exigirEmpresas(u, [body?.empresa_id])
  if (negado) return negado
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await sb
    .from('linhas_negocio').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
})

export const PATCH = exigirLogin(async (req: NextRequest, u) => {
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  // Empresa REAL da linha; se o body tentar mover, a de destino também.
  const empresaAtual = await empresaDaLinha(sb, id)
  if (!empresaAtual) return negar(404, 'Linha de negócio não encontrada.')
  const negado = await exigirEmpresas(u, [empresaAtual, updates.empresa_id])
  if (negado) return negado
  const { data, error } = await sb
    .from('linhas_negocio').update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
})

export const DELETE = exigirLogin(async (req: NextRequest, u) => {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const empresaAtual = await empresaDaLinha(sb, id)
  if (!empresaAtual) return negar(404, 'Linha de negócio não encontrada.')
  const negado = await exigirEmpresas(u, [empresaAtual])
  if (negado) return negado
  const { error } = await sb.from('linhas_negocio').update({ ativo: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
})
