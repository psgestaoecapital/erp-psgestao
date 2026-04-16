import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET_TOKEN

/**
 * Middleware PS Gestão — v1.2
 * - Protege endpoint de deploy
 * - Redireciona rotas do dashboard pra raiz "/" (tela de login) quando não autenticado
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Protege endpoint de deploy com token secreto
  if (pathname.startsWith('/api/dev/deploy')) {
    const token = request.headers.get('x-deploy-token')
    if (!DEPLOY_SECRET || token !== DEPLOY_SECRET) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
  }

  // Redireciona dashboard pra tela de login (raiz) se não tiver cookie de sessão Supabase
  if (pathname.startsWith('/dashboard')) {
    const hasSession =
      request.cookies.getAll().some(c =>
        c.name.startsWith('sb-') && c.name.includes('-auth-token')
      )
    if (!hasSession) {
      const loginUrl = new URL('/', request.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/dev/:path*', '/dashboard/:path*'],
}
