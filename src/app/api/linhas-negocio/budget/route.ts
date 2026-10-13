import { NextRequest, NextResponse } from 'next/server'
import { exigirLogin, exigirEmpresas, negar } from '@/lib/auth/guardaApi'
import { createClient } from '@supabase/supabase-js'

export const GET = exigirLogin(async (req: NextRequest, u) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  const ano = searchParams.get('ano')
  if (!empresaId || !ano) return NextResponse.json({ error: 'empresa_id e ano obrigatórios' }, { status: 400 })
  const negado = await exigirEmpresas(u, [empresaId])
  if (negado) return negado
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await sb.from('linhas_negocio_budget')
    .select('*, linhas_negocio(nome, cor)').eq('empresa_id', empresaId).eq('ano', Number(ano))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
})

export const POST = exigirLogin(async (req: NextRequest, u) => {
  const body = await req.json()
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  // Upsert por linha_id: vale a empresa REAL da linha (e a do body, se vier).
  if (!body?.linha_id) return negar(400, 'linha_id obrigatório.')
  const { data: linha } = await sb.from('linhas_negocio').select('empresa_id').eq('id', body.linha_id).maybeSingle()
  if (!linha) return negar(404, 'Linha de negócio não encontrada.')
  const negado = await exigirEmpresas(u, [linha.empresa_id, body.empresa_id])
  if (negado) return negado
  const { data, error } = await sb.from('linhas_negocio_budget')
    .upsert(body, { onConflict: 'linha_id,ano,mes' }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
})
