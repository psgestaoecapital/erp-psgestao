import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Guarda única das rotas /api que usam o service_role (ignora a RLS).
// 1) valida o Bearer do usuário; 2) confere empresa com get_user_company_ids() chamada com o JWT
// do PRÓPRIO usuário — é a mesma regra da RLS (user_companies ∪ PS admins, respeitando restritas).
// Admin PS = is_admin() (SECURITY DEFINER). Nunca logar o token.

export type UsuarioApi = { userId: string; token: string; maquina?: boolean }

export type OpcoesGuarda = {
  admin?: boolean // exige is_admin() (ferramentas internas PS)
  cron?: boolean  // aceita também Bearer <CRON_SECRET> (chamada máquina-a-máquina)
}

export type ContextoGuarda = UsuarioApi & { empresas: () => Promise<Set<string>> }

const MSG_401 = 'Não autenticado. Faça login novamente.'
const MSG_403_ADMIN = 'Acesso restrito à equipe PS.'
const MSG_403_EMPRESA = 'Sem acesso a esta empresa.'

export function negar(status: number, msg: string): NextResponse {
  return NextResponse.json({ ok: false, error: msg }, { status })
}

function tokenDoHeader(req: Request): string | null {
  const h = (req.headers.get('authorization') || '').trim()
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1].trim() : null
}

function clienteAnon(token?: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  })
}

// Mesmo padrão de /api/cron/*: Vercel Cron / rota interna manda Authorization: Bearer <CRON_SECRET>.
export function ehChamadaCron(req: Request): boolean {
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

export async function usuarioDaRequisicao(req: Request): Promise<{ userId: string; token: string } | null> {
  const token = tokenDoHeader(req)
  if (!token) return null
  try {
    const { data, error } = await clienteAnon().auth.getUser(token)
    if (error || !data?.user) return null
    return { userId: data.user.id, token }
  } catch {
    return null
  }
}

export async function empresasDoUsuario(token: string): Promise<Set<string>> {
  const { data, error } = await clienteAnon(token).rpc('get_user_company_ids')
  if (error || !Array.isArray(data)) return new Set()
  const ids = (data as unknown[]).map((r) =>
    r && typeof r === 'object' ? (r as { get_user_company_ids?: string }).get_user_company_ids : r
  )
  return new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))
}

export async function ehAdminPS(token: string): Promise<boolean> {
  const { data, error } = await clienteAnon(token).rpc('is_admin')
  return !error && data === true
}

// 403 se QUALQUER id informado não for do usuário; 400 se não veio nenhum; null = liberado.
export async function exigirEmpresas(
  quem: string | UsuarioApi,
  ids: (string | null | undefined)[]
): Promise<NextResponse | null> {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0))]
  if (lista.length === 0) return negar(400, 'Empresa obrigatória.')
  if (typeof quem !== 'string' && quem.maquina) return null
  const permitidas = await empresasDoUsuario(typeof quem === 'string' ? quem : quem.token)
  return lista.every((id) => permitidas.has(id)) ? null : negar(403, MSG_403_EMPRESA)
}

// Uso inline (sem reindentar o handler): `const u = await exigirUsuario(req); if (u instanceof NextResponse) return u`
export async function exigirUsuario(req: Request, opts: OpcoesGuarda = {}): Promise<UsuarioApi | NextResponse> {
  if (opts.cron && ehChamadaCron(req)) return { userId: 'cron', token: '', maquina: true }
  const u = await usuarioDaRequisicao(req)
  if (!u) return negar(401, MSG_401)
  if (opts.admin && !(await ehAdminPS(u.token))) return negar(403, MSG_403_ADMIN)
  return u
}

type HandlerGuardado<R> = (req: R, ctx: ContextoGuarda, routeCtx?: unknown) => Promise<Response>

export function comGuarda<R extends Request>(opts: OpcoesGuarda, handler: HandlerGuardado<R>) {
  return async (req: R, routeCtx?: unknown): Promise<Response> => {
    const u = await exigirUsuario(req, opts)
    if (u instanceof NextResponse) return u
    let cache: Promise<Set<string>> | null = null
    const empresas = () => (cache ??= empresasDoUsuario(u.token))
    return handler(req, { ...u, empresas }, routeCtx)
  }
}

export const exigirLogin = <R extends Request>(h: HandlerGuardado<R>) => comGuarda<R>({}, h)
export const exigirAdmin = <R extends Request>(h: HandlerGuardado<R>) => comGuarda<R>({ admin: true }, h)
