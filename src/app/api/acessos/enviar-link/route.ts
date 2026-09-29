// Admin › Acessos · "Enviar link de acesso" (CEO 29/09 · caso Renato/Tryo). Regra em src/lib/acessos/enviarLink.ts.
// GET  ?company_id=… → convites pendentes da empresa + último envio de cada pessoa/convite (quem e quando).
// POST { company_id, user_id } | { company_id, invite_id } → envia o e-mail (provedor do sistema, fn_enviar_email).
// Permissão: fn_acessos_pode_gerir com o JWT de quem clicou (master da empresa ou PS). O link de senha é de
// recuperação, gerado aqui com a service key, e NUNCA volta na resposta (só no e-mail). Tudo vai para audit_log_global.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exigirUsuario, negar } from '@/lib/auth/guardaApi'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ACAO_AUDIT_LINK, VALIDADE_CONVITE_DIAS, planoDeEnvio, type UltimoEnvio } from '@/lib/acessos/enviarLink'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function podeGerir(token: string, companyId: string): Promise<boolean> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await sb.rpc('fn_acessos_pode_gerir', { p_company_id: companyId })
  return !error && data === true
}

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

export async function GET(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u
  const companyId = req.nextUrl.searchParams.get('company_id')
  if (!uuid(companyId)) return negar(400, 'Empresa obrigatória.')
  if (!(await podeGerir(u.token, companyId))) return negar(403, 'Sem permissão para gerir acessos desta empresa.')

  const [conv, env] = await Promise.all([
    supabaseAdmin.from('invites').select('id, email, created_at, expires_at')
      .eq('company_id', companyId).eq('is_used', false).order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('audit_log_global').select('registro_id, user_email, created_at')
      .eq('acao', ACAO_AUDIT_LINK).eq('company_id', companyId).order('created_at', { ascending: false }).limit(300),
  ])
  if (conv.error || env.error) return negar(500, 'Não foi possível carregar os envios.')
  const ultimos: Record<string, UltimoEnvio> = {}
  for (const r of (env.data ?? []) as { registro_id: string | null; user_email: string | null; created_at: string }[]) {
    if (r.registro_id && !ultimos[r.registro_id]) ultimos[r.registro_id] = { em: r.created_at, por: r.user_email }
  }
  return NextResponse.json({ ok: true, convites_pendentes: conv.data ?? [], ultimos_envios: ultimos })
}

export async function POST(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u
  const body = (await req.json().catch(() => ({}))) as { company_id?: string; user_id?: string; invite_id?: string }
  const companyId = body.company_id
  if (!uuid(companyId)) return negar(400, 'Empresa obrigatória.')
  if (!uuid(body.user_id) && !uuid(body.invite_id)) return negar(400, 'Informe a pessoa ou o convite.')
  if (!(await podeGerir(u.token, companyId))) return negar(403, 'Sem permissão para gerir acessos desta empresa.')

  const origem = req.nextUrl.origin
  const { data: emp } = await supabaseAdmin.from('companies').select('nome_fantasia, razao_social').eq('id', companyId).maybeSingle()
  const empresa = (emp?.nome_fantasia || emp?.razao_social || null) as string | null

  let email: string, nome: string | null = null, link: string, registroId: string
  let plano
  if (uuid(body.user_id)) {
    // a pessoa tem de ser DESTA empresa (nunca envia link de conta de outra empresa)
    const { data: vinc } = await supabaseAdmin.from('user_companies').select('user_id')
      .eq('user_id', body.user_id).eq('company_id', companyId).maybeSingle()
    if (!vinc) return negar(404, 'Pessoa não encontrada nesta empresa.')
    const { data: au, error: auErr } = await supabaseAdmin.auth.admin.getUserById(body.user_id)
    if (auErr || !au?.user?.email) return negar(404, 'Conta da pessoa não encontrada.')
    email = au.user.email
    const { data: pu } = await supabaseAdmin.from('users').select('full_name').eq('id', body.user_id).maybeSingle()
    nome = (pu?.full_name as string | null) ?? null
    plano = planoDeEnvio({ tipo: 'pessoa', jaEntrou: !!au.user.last_sign_in_at })
    const { data: gl, error: glErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery', email, options: { redirectTo: `${origem}/auth/nova-senha` },
    })
    const acao = gl?.properties?.action_link
    if (glErr || !acao) return negar(500, 'Não foi possível gerar o link de acesso.')
    link = acao
    registroId = body.user_id
  } else {
    const { data: inv } = await supabaseAdmin.from('invites').select('id, email, invite_code, is_used')
      .eq('id', body.invite_id as string).eq('company_id', companyId).maybeSingle()
    if (!inv || inv.is_used) return negar(404, 'Convite pendente não encontrado nesta empresa.')
    email = inv.email as string
    plano = planoDeEnvio({ tipo: 'convite_pendente' })
    const expira = new Date(Date.now() + VALIDADE_CONVITE_DIAS * 86400000).toISOString()
    const { error: upErr } = await supabaseAdmin.from('invites').update({ expires_at: expira }).eq('id', inv.id)
    if (upErr) return negar(500, 'Não foi possível renovar o convite.')
    link = `${origem}/convite?code=${inv.invite_code}`
    registroId = inv.id as string
  }

  const { data: mail } = await supabaseAdmin.rpc('fn_enviar_email', {
    p_destino: email, p_template: plano.template,
    p_dados: { nome, empresa, link, company_id: companyId, idempotency_key: `acesso-link-${registroId}-${Date.now()}` },
  })
  const r = (mail ?? {}) as { ok?: boolean; erro?: string }
  const emailOk = r.ok === true

  const { data: quem } = await supabaseAdmin.from('users').select('email').eq('id', u.userId).maybeSingle()
  const agora = new Date().toISOString()
  await supabaseAdmin.from('audit_log_global').insert({
    tabela: 'acessos', acao: ACAO_AUDIT_LINK, registro_id: registroId, company_id: companyId,
    user_id: u.userId, user_email: (quem?.email as string | null) ?? null, created_at: agora,
    valor_novo: { destino: email, template: plano.template, link: plano.link, email_enviado: emailOk, email_erro: r.erro ?? null },
  })

  if (!emailOk) return NextResponse.json({ ok: false, erro: r.erro || 'O e-mail não saiu.', enviado_em: agora }, { status: 502 })
  return NextResponse.json({ ok: true, rotulo: plano.rotulo, destino: email, enviado_em: agora, por: quem?.email ?? null })
}
