import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', userId).single()

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Acesso negado — requer perfil admin' }, { status: 403 })
  }

  const { data: { users }, error } = await supabase.auth.admin.listUsers()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    data: users.map(u => ({
      id: u.id, email: u.email,
      role: u.user_metadata?.role ?? 'viewer',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }))
  })
})
