import { NextRequest, NextResponse } from 'next/server'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET_TOKEN
const ALLOWED_ORIGINS = [
  'https://erp-psgestao.vercel.app',
  'http://localhost:3000',
]

// Cabeçalhos CORS restritivos — apenas origens autorizadas
function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-deploy-token',
    'Access-Control-Max-Age': '86400',
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  // 1. Valida token secreto
  const token = req.headers.get('x-deploy-token')
  if (!DEPLOY_SECRET || token !== DEPLOY_SECRET) {
    console.warn('[Deploy] Tentativa não autorizada de:', req.headers.get('x-forwarded-for'))
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401, headers })
  }

  // 2. Valida origem
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return NextResponse.json({ error: 'Origem não permitida' }, { status: 403, headers })
  }

  try {
    const body = await req.json()
    // Lógica de deploy aqui — ex: trigger Vercel webhook, atualizar status, etc.
    console.log('[Deploy] Iniciado por origem:', origin, '| Payload:', JSON.stringify(body).slice(0, 200))

    return NextResponse.json(
      { success: true, message: 'Deploy iniciado com sucesso', timestamp: new Date().toISOString() },
      { status: 200, headers }
    )
  } catch (err: any) {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400, headers })
  }
}
