import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Revenda PF-b · rota pública do contador (SEM login). O token da URL é a credencial: as RPCs
// fn_veic_perfil_convite_* são SECURITY DEFINER e validam o token internamente (client anon).
// O IP vem do request (o cliente não sabe/prova o próprio IP) e é registrado no convite (LGPD).

function ipDe(req: NextRequest): string | null {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
}
function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  return createClient(url, anon, { auth: { persistSession: false } })
}

// GET — valida o token e devolve o mínimo (empresa: nome+CNPJ) + o rascunho para o contador editar.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const client = sb()
  if (!client) return NextResponse.json({ ok: false, erro: 'config' }, { status: 500 })
  const { data, error } = await client.rpc('fn_veic_perfil_convite_validar', { p_token: token, p_ip: ipDe(req) })
  if (error) return NextResponse.json({ ok: false, erro: 'falha' }, { status: 500 })
  const r = data as { ok?: boolean } | null
  return NextResponse.json(r ?? { ok: false, erro: 'token_invalido' }, { status: r?.ok ? 200 : 404 })
}

// POST — { action: 'salvar' | 'enviar', dados?, operacoes? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const client = sb()
  if (!client) return NextResponse.json({ ok: false, erro: 'config' }, { status: 500 })
  let body: { action?: string; dados?: unknown; operacoes?: unknown }
  try { body = await req.json() } catch { body = {} }
  const ip = ipDe(req)

  if (body.action === 'enviar') {
    const { data, error } = await client.rpc('fn_veic_perfil_convite_enviar', { p_token: token, p_ip: ip })
    if (error) return NextResponse.json({ ok: false, erro: 'falha' }, { status: 500 })
    const r = data as { ok?: boolean } | null
    return NextResponse.json(r ?? { ok: false }, { status: r?.ok ? 200 : 400 })
  }
  // default: salvar rascunho
  const { data, error } = await client.rpc('fn_veic_perfil_convite_salvar', {
    p_token: token, p_dados: body.dados ?? {}, p_operacoes: body.operacoes ?? null, p_ip: ip,
  })
  if (error) return NextResponse.json({ ok: false, erro: 'falha' }, { status: 500 })
  const r = data as { ok?: boolean } | null
  return NextResponse.json(r ?? { ok: false }, { status: r?.ok ? 200 : 400 })
}
