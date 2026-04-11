import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { applyStandardFilters } from '@/lib/dataFilters'

export const GET = withAuth(async (req: NextRequest, { user }) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  const periodo = searchParams.get('periodo') // ex: '2024-01'

  if (!empresaId) {
    return NextResponse.json({ error: 'empresa_id é obrigatório' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  let query = supabase
    .from('lancamentos')
    .select('*')
    .eq('empresa_id', empresaId)

  if (periodo) {
    const [ano, mes] = periodo.split('-')
    query = query
      .gte('data_lancamento', `${ano}-${mes}-01`)
      .lt('data_lancamento', `${ano}-${String(Number(mes) + 1).padStart(2, '0')}-01`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const filtered = applyStandardFilters(data ?? [])
  return NextResponse.json({ data: filtered })
})
