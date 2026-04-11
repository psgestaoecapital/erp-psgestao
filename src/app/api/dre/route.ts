import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'
import { applyStandardFilters } from '@/lib/dataFilters'

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  const periodo = searchParams.get('periodo')

  if (!empresaId) return NextResponse.json({ error: 'empresa_id obrigatório' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let query = supabase.from('lancamentos').select('*').eq('empresa_id', empresaId)

  if (periodo) {
    const [ano, mes] = periodo.split('-')
    const mesNum = String(Number(mes) + 1).padStart(2, '0')
    query = query.gte('data_lancamento', `${ano}-${mes}-01`).lt('data_lancamento', `${ano}-${mesNum}-01`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: applyStandardFilters(data ?? []) })
})
