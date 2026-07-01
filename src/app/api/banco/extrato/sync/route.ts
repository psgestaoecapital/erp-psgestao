// POST /api/banco/extrato/sync
// Puxa o extrato bancario direto do provider (Sicoob → Bradesco depois),
// grava em conciliacao_lote/movimento via fn_extrato_importar_sistema
// (idempotente por id_externo) e dispara fn_conciliacao_rodar_lote.
//
// Auth: x-ping-secret (cron) OU sessao (Bearer/cookie) com
// get_user_company_ids() incluindo a company.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getExtratoAdapter } from '@/lib/banco/extrato'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BANCO = '756' // Sicoob por default; adapter tem base URL propria

function userSupabaseBearer(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
}
async function userSupabaseCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const store = await cookies()
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: () => { /* read-only */ },
    },
  })
}
type AuthedClient = ReturnType<typeof userSupabaseBearer>
async function resolverSessao(req: NextRequest): Promise<AuthedClient | null> {
  const auth = req.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    const sb = userSupabaseBearer(req)
    const { data: { user } } = await sb.auth.getUser()
    if (user) return sb
  }
  try {
    const sb = (await userSupabaseCookies()) as unknown as AuthedClient
    const { data: { user } } = await sb.auth.getUser()
    if (user) return sb
  } catch { /* sem cookie */ }
  return null
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

// Fuso Sao Paulo — evita cursor virar dia futuro (licao do boleto).
function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}
function menos30dias(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 30)
  return d.toISOString().slice(0, 10)
}

async function logSync(company_id: string, provider: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  try {
    await supabaseAdmin.from('erp_banco_sync_log').insert({
      company_id, banco_codigo: BANCO, provider,
      tipo: 'extrato_sync', status, qtd: 0, mensagem: mensagem.slice(0, 1000),
      payload_resumo: payload,
    })
  } catch { /* nao deixar log derrubar a rota */ }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const providerConfigId: string | undefined = body?.provider_config_id
    let companyId: string | undefined = body?.company_id

    if (!temSegredoValido(req)) {
      const sb = await resolverSessao(req)
      if (!sb) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })
      const { data: perm, error: permErr } = await sb.rpc('get_user_company_ids')
      if (permErr) return NextResponse.json({ ok: false, erro: permErr.message }, { status: 500 })
      const permitidas = (Array.isArray(perm) ? (perm as string[]) : []).filter(Boolean)
      if (permitidas.length === 0) return NextResponse.json({ ok: false, erro: 'sem empresas acessiveis' }, { status: 403 })
      if (companyId) {
        if (!permitidas.includes(companyId)) return NextResponse.json({ ok: false, erro: 'sem acesso a esta empresa' }, { status: 403 })
      } else {
        companyId = permitidas[0]
      }
    }
    if (!companyId) return NextResponse.json({ ok: false, erro: 'company_id nao resolvido' }, { status: 400 })

    // 1) config do provider
    let cfgQuery = supabaseAdmin
      .from('erp_banco_provider_config')
      .select('id, provider, ambiente, client_id, cooperativa, conta, codigo_beneficiario, convenio, banco_conta_id, cursor_extrato, cap_extrato, ativo')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .eq('cap_extrato', true)
    if (providerConfigId) cfgQuery = cfgQuery.eq('id', providerConfigId)
    const { data: cfgs, error: cfgErr } = await cfgQuery.limit(2)
    if (cfgErr) return NextResponse.json({ ok: false, erro: cfgErr.message }, { status: 500 })
    const cfg = (cfgs ?? [])
      .sort((a, b) => (a.ambiente === 'producao' ? -1 : 1))[0]
    if (!cfg) return NextResponse.json({ ok: false, erro: 'sem configuracao de extrato ativa (cap_extrato=true)' }, { status: 412 })
    const provider = cfg.provider as string
    if (!cfg.banco_conta_id) return NextResponse.json({ ok: false, erro: 'banco_conta_id ausente na config' }, { status: 412 })

    // 2) credencial (Vault) — reusa fn_banco_obter_credencial do Sicoob
    const credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: cfg.ambiente,
    })
    const credRow = credResp.data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      return NextResponse.json({ ok: false, erro: 'credencial nao encontrada no Vault' }, { status: 412 })
    }
    const clientId = credRow.client_id as string | null
    const certBase64 = credRow.cert_base64 as string | null
    const certSenha = credRow.cert_senha as string | null
    if (!clientId || !certBase64 || !certSenha) {
      return NextResponse.json({ ok: false, erro: 'credencial incompleta (client_id/cert/senha)' }, { status: 412 })
    }

    // 3) janela: cursor -> hoje SP (default: ultimos 30 dias)
    const hoje = hojeSP()
    const begin = cfg.cursor_extrato ? String(cfg.cursor_extrato).slice(0, 10) : menos30dias(hoje)
    const end = hoje

    // 4) puxa via adapter
    const adapter = getExtratoAdapter(provider)
    let movimentos
    try {
      movimentos = await adapter.listarMovimentos({
        client_id: clientId,
        base_url: '', // adapter usa host propro por ambiente
        ambiente: cfg.ambiente as 'producao' | 'homologacao',
        pfx: Buffer.from(certBase64, 'base64'),
        passphrase: certSenha,
        cooperativa: (credRow.cooperativa as string | null) ?? cfg.cooperativa ?? '',
        conta: (credRow.conta as string | null) ?? cfg.conta ?? '',
        codigo_beneficiario: (credRow.codigo_beneficiario as string | null) ?? cfg.codigo_beneficiario ?? '',
        convenio: (credRow.convenio as string | null) ?? cfg.convenio ?? '',
      }, { begin, end })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const naoHabilitado = /extrato_nao_habilitado|scope|invalid_scope/i.test(msg)
      await supabaseAdmin.from('erp_banco_provider_config')
        .update({ ultimo_sync_em: new Date().toISOString(), ultimo_sync_status: `erro:${msg.slice(0, 120)}` })
        .eq('id', cfg.id)
      await logSync(companyId, provider, 'erro', msg, { begin, end })
      return NextResponse.json({
        ok: false,
        erro: naoHabilitado
          ? 'API Conta Corrente do Sicoob ainda nao autorizada (verifique escopo cco_consulta no app do portal). Nada foi salvo.'
          : 'Falha ao puxar o extrato.',
        detalhe: msg,
      }, { status: 502 })
    }

    // 5) grava via fn_extrato_importar_sistema (idempotente)
    const { data: imp, error: impErr } = await supabaseAdmin.rpc('fn_extrato_importar_sistema', {
      p_company_id: companyId,
      p_conta_bancaria_id: cfg.banco_conta_id,
      p_provider: provider,
      p_movimentos: movimentos,
      p_periodo_inicio: begin,
      p_periodo_fim: end,
    })
    if (impErr) {
      await logSync(companyId, provider, 'erro', `importar_sistema falhou: ${impErr.message}`, { begin, end })
      return NextResponse.json({ ok: false, erro: 'falha ao gravar movimentos' }, { status: 500 })
    }
    const j = imp as { sucesso?: boolean; lote_id?: string; inseridos?: number; ignorados_duplicados?: number } | null
    if (!j?.sucesso) {
      await logSync(companyId, provider, 'erro', 'importar_sistema sucesso=false', { j, begin, end })
      return NextResponse.json({ ok: false, erro: 'falha ao criar lote' }, { status: 500 })
    }
    const loteId = j.lote_id!
    const inseridos = j.inseridos ?? 0
    const ignorados = j.ignorados_duplicados ?? 0

    // 6) rodar motor de conciliacao (auto_aplicar = flag da conta)
    const { data: conta } = await supabaseAdmin
      .from('erp_banco_contas').select('auto_conciliar')
      .eq('id', cfg.banco_conta_id).maybeSingle()
    const autoAplicar = !!(conta as { auto_conciliar?: boolean } | null)?.auto_conciliar

    let sugestoes = 0
    try {
      const { data: rr } = await supabaseAdmin.rpc('fn_conciliacao_rodar_lote', {
        p_company_id: companyId,
        p_lote_id: loteId,
        p_auto_aplicar: autoAplicar,
        p_score_auto: 95,
        p_limite: 1000,
      })
      const r = rr as { sugestoes?: number } | null
      sugestoes = r?.sugestoes ?? 0
    } catch { /* motor ja loga; nao derrubar */ }

    // 7) atualizar cursor + ultimo_sync
    await supabaseAdmin.from('erp_banco_provider_config')
      .update({
        cursor_extrato: end,
        ultimo_sync_em: new Date().toISOString(),
        ultimo_sync_status: 'ok',
      })
      .eq('id', cfg.id)

    await logSync(companyId, provider, 'ok',
      `inseridos=${inseridos} ignorados=${ignorados} sugestoes=${sugestoes}`,
      { lote_id: loteId, begin, end, auto_aplicar: autoAplicar })

    return NextResponse.json({
      ok: true,
      provider, ambiente: cfg.ambiente,
      periodo: { begin, end },
      lote_id: loteId,
      inseridos, ignorados,
      sugestoes,
      auto_aplicar: autoAplicar,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
