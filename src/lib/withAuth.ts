import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

type RouteHandler = (
  req: NextRequest,
  context: { params?: Record<string, string>; user: { id: string; email?: string } }
) => Promise<NextResponse>

/**
 * HOF que protege API Routes verificando sessão Supabase.
 * Uso: export const GET = withAuth(async (req, { user }) => { ... })
 */
export function withAuth(handler: RouteHandler) {
  return async (req: NextRequest, context: { params?: Record<string, string> }) => {
    try {
      const cookieStore = await cookies()
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() { return cookieStore.getAll() },
            setAll(toSet) {
              toSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            },
          },
        }
      )

      const { data: { user }, error } = await supabase.auth.getUser()

      if (error || !user) {
        return NextResponse.json(
          { error: 'Não autorizado — sessão inválida ou expirada' },
          { status: 401 }
        )
      }

      return handler(req, { ...context, user })
    } catch (err) {
      console.error('[withAuth] Erro interno:', err)
      return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
    }
  }
}
