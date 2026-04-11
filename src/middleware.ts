import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/register', '/api/auth', '/api/health']
const DEPLOY_SECRET = process.env.DEPLOY_SECRET_TOKEN

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Permite rotas públicas
  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.next()
  }

  // Protege endpoint de deploy com token secreto
  if (pathname.startsWith('/api/dev/deploy')) {
    const authHeader = request.headers.get('x-deploy-token')
    if (!DEPLOY_SECRET || authHeader !== DEPLOY_SECRET) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Cria cliente Supabase para verificar sessão
  const response = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Redireciona para login se não autenticado
  if (!user && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Bloqueia API routes sem sessão
  if (!user && pathname.startsWith('/api/') && !pathname.startsWith('/api/auth')) {
    return NextResponse.json({ error: 'Sessão inválida ou expirada' }, { status: 401 })
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
