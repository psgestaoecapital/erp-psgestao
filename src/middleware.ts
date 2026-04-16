import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
const DEPLOY_SECRET = process.env.DEPLOY_SECRET_TOKEN
/**
 * Middleware PS Gestão — v1.1
 * Proteção mínima no edge sem dependências externas.
 * Auth detalhada é feita pelo withAuth em cada API Route.
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
  return NextResponse.next()
}
export const config = {
  matcher: ['/api/dev/:path*'],
}
