import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { applyStandardFilters } from '@/lib/dataFilters'

export const GET = withAuth(async (req: NextRequest, { user }) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  const dataInicio = searchParams.get('data_inicio')
  const dataFim = searchParams.get('data_fim')

  if (!empresaId) return NextResponse.json({ error: 'empresa_id obrigatório' }, { status: 400 })

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  let query = supabase
    .from('lancamentos')
    .select('id, data_lancamento, descricao, valor, tipo, categoria, status')
    .eq('empresa_id', empresaId)

  if (dataInicio) query = query.gte('data_lancamento', dataInicio)
  if (dataFim) query = query.lte('data_lancamento', dataFim)

  const { data, error } = await query.order('data_lancamento')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const filtered = applyStandardFilters(data ?? [])
  return NextResponse.json({ data: filtered })
})
