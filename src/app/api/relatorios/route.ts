import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const GET = withAuth(async (req: NextRequest, { user }) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  const tipo = searchParams.get('tipo') // 'dre' | 'bpo' | 'fluxo'

  if (!empresaId || !tipo) {
    return NextResponse.json({ error: 'empresa_id e tipo são obrigatórios' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  const { data, error } = await supabase
    .from('relatorios')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('tipo', tipo)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
})
