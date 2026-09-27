import { NextRequest, NextResponse } from 'next/server'
import { exigirLogin, exigirEmpresas } from '@/lib/auth/guardaApi'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const GET = exigirLogin(async (req: NextRequest, u) => {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('company_id')
  if (!companyId)
    return NextResponse.json({ error: 'company_id obrigatorio' }, { status: 400 })
  const negado = await exigirEmpresas(u, [companyId])
  if (negado) return negado
  const { data } = await supabaseAdmin.from('ind_unidades').select('*')
    .eq('company_id', companyId).eq('ativa', true).order('nome')
  return NextResponse.json({ unidades: data || [] })
})

export const POST = exigirLogin(async (req: NextRequest, u) => {
  const body = await req.json()
  const negado = await exigirEmpresas(u, [body?.company_id])
  if (negado) return negado
  const { data, error } = await supabaseAdmin
    .from('ind_unidades').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ unidade: data })
})