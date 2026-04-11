import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST — vincula empresa ao escritório contábil
export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const { company_id, permissoes } = await req.json()

  const { data: contador } = await supabaseAdmin
    .from('contadores')
    .select('id, escritorio_id')
    .eq('user_id', userId)
    .single()

  if (!contador) return NextResponse.json({ error: 'Contador não encontrado' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('contador_clientes')
    .upsert({
      contador_id: contador.id,
      escritorio_id: contador.escritorio_id,
      company_id,
      permissoes: permissoes || { dre: true, fluxo: true, fiscal: true },
      ativo: true,
    }, { onConflict: 'escritorio_id,company_id' })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ vinculo: data })
})

// GET — lista empresas vinculadas ao escritório
export const GET = withAuth(async (_req: NextRequest, { userId }) => {
  const { data: contador } = await supabaseAdmin
    .from('contadores')
    .select('id, escritorio_id')
    .eq('user_id', userId)
    .single()

  if (!contador) return NextResponse.json({ clientes: [] })

  const { data: clientes } = await supabaseAdmin
    .from('contador_clientes')
    .select('*, companies:company_id(razao_social, nome_fantasia, cnpj)')
    .eq('escritorio_id', contador.escritorio_id)
    .eq('ativo', true)
    .order('desde', { ascending: false })

  return NextResponse.json({ clientes: clientes || [], total: clientes?.length || 0 })
})
