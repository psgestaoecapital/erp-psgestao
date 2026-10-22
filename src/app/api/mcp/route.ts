// Canal PS · servidor MCP remoto do ERP (CEO 07/10 16:20) — transporte Streamable HTTP, sem estado.
// Autenticação: OAuth do PRÓPRIO usuário do ERP (Supabase Auth como servidor de autorização). Sem token válido → 401 com
// o endereço dos metadados (RFC 9728), e o cliente (Claude) faz o login OAuth. Com token: cada ferramenta chama uma RPC
// com guarda COMO esse usuário (cliente Supabase com o token dele + chave pública). Nada de chave de serviço nem SQL livre.
import { createClient } from '@supabase/supabase-js'
import { caminhoMetadados, tratarCorpo, type Rpc } from '@/lib/canalPs/mcp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const opcoes = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

function origemDe(req: Request): string {
  const h = req.headers
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '')
  return host ? `${proto}://${host}` : new URL(req.url).origin
}

function semLogin(req: Request, motivo: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: `Login obrigatório: ${motivo}` } }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer realm="canal-ps", resource_metadata="${origemDe(req)}${caminhoMetadados}"`,
    },
  })
}

export async function POST(req: Request): Promise<Response> {
  if (!URL_SB || !ANON) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Canal PS sem configuração do Supabase' } }, { status: 500 })
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim()
  if (!token) return semLogin(req, 'conecte a sua Claude com o seu usuário do ERP')
  const { data, error } = await createClient(URL_SB, ANON, opcoes).auth.getUser(token)
  if (error || !data?.user) return semLogin(req, 'sessão inválida ou vencida')

  // cliente COMO O USUÁRIO: toda RPC passa pela guarda e pela RLS dele
  const sb = createClient(URL_SB, ANON, { ...opcoes, global: { headers: { Authorization: `Bearer ${token}` } } })
  const rpc: Rpc = async (fn, args) => {
    const r = await sb.rpc(fn, args)
    return { data: r.data, error: r.error ? { message: r.error.message } : null }
  }

  let corpo: unknown
  try { corpo = await req.json() } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }, { status: 400 })
  }
  const resposta = await tratarCorpo(corpo, rpc)
  if (resposta === null) return new Response(null, { status: 202 })
  return Response.json(resposta, { headers: { 'Cache-Control': 'no-store' } })
}

// sem fluxo SSE do servidor (stateless): GET/DELETE não se aplicam
const naoSuportado = () => new Response(null, { status: 405, headers: { Allow: 'POST' } })
export const GET = naoSuportado
export const DELETE = naoSuportado
