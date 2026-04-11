import { NextRequest, NextResponse } from 'next/server'

const DEPLOY_SECRET = process.env.DEPLOY_SECRET_TOKEN
const ALLOWED_ORIGINS = ['https://erp-psgestao.vercel.app', 'http://localhost:3000']

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-deploy-token',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  const token = req.headers.get('x-deploy-token')
  if (!DEPLOY_SECRET || token !== DEPLOY_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401, headers })
  }

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return NextResponse.json({ error: 'Origem não permitida' }, { status: 403, headers })
  }

  try {
    const body = await req.json()
    console.log('[Deploy] Iniciado | Payload:', JSON.stringify(body).slice(0, 200))
    return NextResponse.json({ success: true, timestamp: new Date().toISOString() }, { headers })
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400, headers })
  }
}
