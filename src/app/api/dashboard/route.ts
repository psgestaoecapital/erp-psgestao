import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'
import { applyStandardFilters } from '@/lib/dataFilters'

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  if (!empresaId) return NextResponse.json({ error: 'empresa_id obrigatório' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('lancamentos').select('*').eq('empresa_id', empresaId)
    .order('data_lancamento', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const filtered = applyStandardFilters(data ?? [])
  return NextResponse.json({ data: filtered, total: filtered.length })
})
