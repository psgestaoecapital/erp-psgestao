import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

type AuthedHandler = (
  req: NextRequest,
  context: { params?: Record<string, string>; userId: string; userEmail?: string }
) => Promise<NextResponse>

/**
 * HOF que protege API Routes verificando o Bearer token da sessão Supabase.
 * O cliente deve enviar: Authorization: Bearer <access_token>
 *
 * Uso: export const GET = withAuth(async (req, { userId }) => { ... })
 */
export function withAuth(handler: AuthedHandler) {
  return async (req: NextRequest, context: { params?: Record<string, string> }) => {
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '').trim()

    if (!token) {
      return NextResponse.json({ error: 'Token de autenticação ausente' }, { status: 401 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return NextResponse.json({ error: 'Sessão inválida ou expirada' }, { status: 401 })
    }

    return handler(req, { ...context, userId: user.id, userEmail: user.email })
  }
}
