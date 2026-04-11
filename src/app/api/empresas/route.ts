import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const GET = withAuth(async (req: NextRequest, { user }) => {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  // Retorna apenas empresas às quais o usuário tem acesso via profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })

  // Admin vê todas; usuário comum vê apenas a sua
  const query = profile.role === 'admin'
    ? supabase.from('empresas').select('*').order('nome')
    : supabase.from('empresas').select('*').eq('id', profile.empresa_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
})
