import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const GET = withAuth(async (req: NextRequest, { user }) => {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('company_id')
  if (!companyId) return NextResponse.json({ error: 'company_id obrigatório' }, { status: 400 })
  const { data } = await supabaseAdmin.from('ind_unidades').select('*')
    .eq('company_id', companyId).eq('ativa', true).order('nome')
  return NextResponse.json({ unidades: data || [] })
})

export const POST = withAuth(async (req: NextRequest, { user }) => {
  const body = await req.json()
  const { data, error } = await supabaseAdmin.from('ind_unidades').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ unidade: data })
})
