import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

type AuthedHandler = (
  req: NextRequest,
  context: { userId: string; userEmail?: string },
  routeCtx?: any
) => Promise<NextResponse | Response>

/**
 * HOF que protege API Routes verificando o Bearer token da sessão Supabase.
 * Compatível com Next.js 15/16 App Router (params assíncrono).
 *
 * O cliente deve enviar: Authorization: Bearer <access_token>
 *
 * Uso:
 *   export const GET = withAuth(async (req, { userId }) => {
 *     return NextResponse.json({ userId })
 *   })
 *
 * Rotas dinâmicas ([id], [slug], ...) recebem o 3º argumento `routeCtx`,
 * que é o objeto do Next contendo `params: Promise<{...}>`. Handlers
 * antigos com 2 argumentos continuam funcionando — o 3º é opcional.
 */
export function withAuth(handler: AuthedHandler) {
  return async (req: NextRequest, routeCtx: any) => {
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '').trim()

    if (!token) {
      return NextResponse.json(
        { error: 'Token de autenticação ausente. Envie: Authorization: Bearer <token>' },
        { status: 401 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return NextResponse.json(
        { error: 'Sessão inválida ou expirada. Faça login novamente.' },
        { status: 401 }
      )
    }

    return handler(req, { userId: user.id, userEmail: user.email }, routeCtx)
  }
}
