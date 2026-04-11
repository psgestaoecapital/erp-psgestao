import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import crypto from 'crypto'

export interface ContadorSession {
  contador_id: string
  escritorio_id: string
  escopos: string[]
  company_ids: string[]
}

export async function withContadorAuth(
  req: NextRequest,
  handler: (req: NextRequest, session: ContadorSession) => Promise<NextResponse>
): Promise<NextResponse> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace('Bearer ', '').trim()

  if (!token || !token.startsWith('PSG-')) {
    return NextResponse.json({ error: 'API Key inválida' }, { status: 401 })
  }

  const prefix = token.substring(0, 12)
  const hash = crypto.createHash('sha256').update(token).digest('hex')

  const { data: key } = await supabaseAdmin
    .from('contador_api_keys')
    .select('id, contador_id, escritorio_id, escopos, ativo, expira_em')
    .eq('token_prefix', prefix)
    .eq('token_hash', hash)
    .single()

  if (!key || !key.ativo) {
    return NextResponse.json({ error: 'API Key não encontrada ou inativa' }, { status: 401 })
  }

  if (key.expira_em && new Date(key.expira_em) < new Date()) {
    return NextResponse.json({ error: 'API Key expirada' }, { status: 401 })
  }

  // Atualiza ultimo_uso e total_requests
  await supabaseAdmin
    .from('contador_api_keys')
    .update({ ultimo_uso: new Date().toISOString(), total_requests: supabaseAdmin.rpc('increment', { x: 1 }) })
    .eq('id', key.id)

  // Busca empresas vinculadas ao escritório
  const { data: clientes } = await supabaseAdmin
    .from('contador_clientes')
    .select('company_id')
    .eq('escritorio_id', key.escritorio_id)
    .eq('ativo', true)

  const company_ids = (clientes || []).map((c: any) => c.company_id)

  // Log de acesso
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
  await supabaseAdmin.from('contador_acessos_log').insert({
    contador_id: key.contador_id,
    escritorio_id: key.escritorio_id,
    acao: req.method + ' ' + req.nextUrl.pathname,
    endpoint: req.nextUrl.pathname,
    ip,
  })

  return handler(req, {
    contador_id: key.contador_id,
    escritorio_id: key.escritorio_id,
    escopos: key.escopos || [],
    company_ids,
  })
}

export function gerarApiKey(): { token: string; hash: string; prefix: string } {
  const uuid = crypto.randomUUID().replace(/-/g, '')
  const token = 'PSG-' + uuid.substring(0,8) + '-' + uuid.substring(8,12) + '-' +
    uuid.substring(12,16) + '-' + uuid.substring(16,20) + '-' + uuid.substring(20)
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const prefix = token.substring(0, 12)
  return { token, hash, prefix }
}
