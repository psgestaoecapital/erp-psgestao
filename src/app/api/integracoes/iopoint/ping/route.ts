// IO Point - ping de validacao do token armazenado no Vault.
// Le o token (vault.secrets) pelo nome pre-definido, bate em
// /api/customer/v2/collaborator e devolve so:
//   - status HTTP
//   - quantos colaboradores vieram
//   - os CAMPOS (chaves) do primeiro registro — SEM PII (nem valores).
//
// NUNCA loga, retorna ou expoe o token em nenhuma resposta.
//
// Auth: x-ping-secret (mesmo padrao das rotas Sicoob) OU sessao de
// usuario. Sem auth: 401.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// company_id -> nome do secret no Vault
const VAULT_SECRET_POR_EMPRESA: Record<string, string> = {
  '975365cc-9e5a-4251-9022-68c6bfde10d8': 'IOPOINT_TOKEN_FRIOESTE',
  // Tryo Gessos / Tryo Acabamentos ja existem no Vault — se quiserem,
  // mapear o company_id aqui pra testa-los pela mesma rota.
}

function temSegredoValido(req: NextRequest): boolean {
  const expected = process.env.PING_SICOOB_SECRET
  const provided = req.headers.get('x-ping-secret') || ''
  if (!expected || !provided) return false
  const A = Buffer.from(provided)
  const B = Buffer.from(expected)
  if (A.length !== B.length) return false
  return timingSafeEqual(A, B)
}

function userSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
}

async function handle(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const company = url.searchParams.get('company') || '975365cc-9e5a-4251-9022-68c6bfde10d8'
    const secretName = VAULT_SECRET_POR_EMPRESA[company]
    if (!secretName) {
      return NextResponse.json({ ok: false, erro: `empresa sem secret mapeado (${company})` }, { status: 412 })
    }

    if (!temSegredoValido(req)) {
      const sb = userSupabase(req)
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })
    }

    // Le o token decodificado do Vault (vault.decrypted_secrets — view
    // do supabase-vault). Service role necessario.
    const { data, error } = await supabaseAdmin
      .schema('vault' as never)
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', secretName)
      .maybeSingle()
    if (error || !data) {
      return NextResponse.json({ ok: false, erro: 'secret nao encontrado no Vault', detalhe: error?.message }, { status: 500 })
    }
    const token = (data as { decrypted_secret: string }).decrypted_secret
    if (!token) return NextResponse.json({ ok: false, erro: 'secret vazio' }, { status: 500 })

    const t0 = Date.now()
    let res: Response
    try {
      res = await fetch('https://api.iopoint.com.br/api/customer/v2/collaborator', {
        method: 'GET',
        headers: { apiIopointToken: token, accept: 'application/json' },
      })
    } catch (e) {
      return NextResponse.json({
        ok: false, status: 0,
        erro: 'falha de rede ao alcancar api.iopoint.com.br',
        detalhe: e instanceof Error ? e.message : String(e),
      }, { status: 502 })
    }
    const latencia_ms = Date.now() - t0
    const text = await res.text()
    let body: unknown = text
    try { body = JSON.parse(text) } catch { /* fica string */ }

    if (!res.ok) {
      return NextResponse.json({
        ok: false, status: res.status, latencia_ms,
        erro: 'IO Point recusou a requisicao',
        // primeiros 300 chars do erro, sem token
        resposta: typeof body === 'string' ? body.slice(0, 300) : body,
      }, { status: res.status === 401 ? 401 : 502 })
    }

    // Sucesso: extrair so metadados (count + chaves do 1o registro), sem PII.
    let total = 0
    let chaves: string[] = []
    const arr = Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown[] })?.data) ? (body as { data: unknown[] }).data
      : Array.isArray((body as { collaborators?: unknown[] })?.collaborators) ? (body as { collaborators: unknown[] }).collaborators
      : null
    if (arr) {
      total = arr.length
      if (arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null) {
        chaves = Object.keys(arr[0] as Record<string, unknown>).sort()
      }
    } else if (typeof body === 'object' && body !== null) {
      // Estrutura inesperada — devolver as chaves do envelope, sem valores.
      chaves = Object.keys(body as Record<string, unknown>).sort()
    }

    return NextResponse.json({
      ok: true,
      status: res.status,
      latencia_ms,
      company,
      total_colaboradores: total,
      campos_primeiro_registro: chaves,
    })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
