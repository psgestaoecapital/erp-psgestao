import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Apenas admin pode listar usuários
export const GET = withAuth(async (req: NextRequest, { user }) => {
  const role = user.user_metadata?.role
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Acesso negado — requer perfil admin' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin.auth.admin.listUsers()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Retorna apenas campos não-sensíveis
  const users = data.users.map(u => ({
    id: u.id,
    email: u.email,
    role: u.user_metadata?.role ?? 'viewer',
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
  }))

  return NextResponse.json({ data: users })
})
