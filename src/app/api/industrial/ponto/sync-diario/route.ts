// POST/GET /api/industrial/ponto/sync-diario — ingestão DIÁRIA do ponto.
// Le ind_ponto_provider_config, busca o token no Vault, chama o adapter
// (listarMarcacoesDiarias) e popula ind_ponto_dia + ind_ponto_marcacao.
// Granularidade por DIA (o filtro de data do BI passa a filtrar de verdade).
// Auth: x-ping-secret OU sessao de usuario (mesmo padrao do sync de periodo).
// Segredos SO do Vault; token nunca em log/resposta. LGPD: sem nome/email nas tabelas.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getPontoAdapter } from '@/lib/ponto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function temSegredoValido(req: NextRequest): boolean {
  const expected = process.env.PING_SICOOB_SECRET
  const provided = req.headers.get('x-ping-secret') || ''
  if (!expected || !provided) return false
  const A = Buffer.from(provided); const B = Buffer.from(expected)
  if (A.length !== B.length) return false
  return timingSafeEqual(A, B)
}

function userSupabaseBearer(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
}
async function userSupabaseCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const store = await cookies()
  return createServerClient(url, anon, {
    cookies: { getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })), setAll: () => {} },
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
async function usuarioTemAcessoEmpresa(sb: AuthedClient, companyId: string): Promise<boolean> {
  const { data, error } = await sb.rpc('get_user_company_ids')
  if (error || !Array.isArray(data)) return false
  return (data as string[]).includes(companyId)
}
async function lerSecret(name: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('fn_vault_ler_secret', { p_name: name })
  if (error || !data) return null
  return (data as string) || null
}
async function logSync(company_id: string, provider: string, status: 'ok' | 'erro', mensagem: string, qtd: number, payload: unknown) {
  try {
    await supabaseAdmin.from('erp_banco_sync_log').insert({
      company_id, banco_codigo: '000', provider, tipo: 'ponto_sync_diario', status, qtd, mensagem: mensagem.slice(0, 1000), payload_resumo: payload,
    })
  } catch { /* nao derruba a rota */ }
}

async function handle(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const companyId = url.searchParams.get('company_id') || ''
    const beginISO = url.searchParams.get('begin_date') || ''
    const endISO = url.searchParams.get('end_date') || ''
    if (!companyId || !beginISO || !endISO) {
      return NextResponse.json({ ok: false, erro: 'company_id, begin_date e end_date sao obrigatorios' }, { status: 400 })
    }

    if (!temSegredoValido(req)) {
      const sess = await resolverSessao(req)
      if (!sess) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })
      if (!(await usuarioTemAcessoEmpresa(sess, companyId))) return NextResponse.json({ ok: false, erro: 'sem acesso a esta empresa' }, { status: 403 })
    }

    // config do provider (por empresa, ativa)
    const { data: cfg } = await supabaseAdmin
      .from('ind_ponto_provider_config')
      .select('provider, base_url, vault_secret_name, plant_id, ativo')
      .eq('company_id', companyId).eq('ativo', true).maybeSingle()
    if (!cfg) return NextResponse.json({ ok: false, erro: 'empresa sem provider de ponto configurado' }, { status: 412 })
    const provider = cfg.provider as string
    const plantId = (cfg.plant_id as string | null) ?? null

    const token = await lerSecret(cfg.vault_secret_name as string)
    if (!token) {
      await logSync(companyId, provider, 'erro', `secret ${cfg.vault_secret_name} ausente no Vault`, 0, { beginISO, endISO })
      return NextResponse.json({ ok: false, erro: 'secret do provider nao encontrado no Vault' }, { status: 500 })
    }

    const adapter = getPontoAdapter(provider)
    if (!adapter.listarMarcacoesDiarias) {
      return NextResponse.json({ ok: false, erro: `provider ${provider} nao expoe marcacao diaria` }, { status: 501 })
    }

    let dias: Awaited<ReturnType<NonNullable<typeof adapter.listarMarcacoesDiarias>>>
    try {
      dias = await adapter.listarMarcacoesDiarias({ token, base_url: cfg.base_url as string }, beginISO, endISO)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await logSync(companyId, provider, 'erro', `marcacoes diarias: ${msg}`, 0, { beginISO, endISO })
      return NextResponse.json({ ok: false, erro: 'falha ao buscar marcacoes diarias', detalhe: msg }, { status: 502 })
    }

    const nowISO = new Date().toISOString()
    // ind_ponto_dia (resumo por dia)
    const rowsDia = dias.map((d) => ({
      company_id: companyId, plant_id: plantId, cpf: d.cpf, registration_number: d.registration_number,
      data: d.data, shift: d.shift, worked_seconds: d.worked_seconds,
      department: d.departamento, team: d.equipe, business_unit: d.unidade_negocio,
      total_pontos: d.total_pontos, tem_ajuste: d.tem_ajuste, raw: d.raw, sincronizado_em: nowISO,
    }))
    if (rowsDia.length > 0) {
      const { error } = await supabaseAdmin.from('ind_ponto_dia').upsert(rowsDia, { onConflict: 'company_id,cpf,data' })
      if (error) {
        await logSync(companyId, provider, 'erro', `upsert dia: ${error.message}`, rowsDia.length, { beginISO, endISO })
        return NextResponse.json({ ok: false, erro: 'falha ao gravar dias', detalhe: error.message }, { status: 502 })
      }
    }

    // ind_ponto_marcacao (batidas com point_id — dedup por (company, point_id))
    const rowsMarca = dias.flatMap((d) => d.pontos
      .filter((p) => p.point_id != null)
      .map((p) => ({
        company_id: companyId, plant_id: plantId, cpf: d.cpf, data: d.data,
        point_id: p.point_id, datetime: p.datetime, hora: p.hora, method: p.method, origin: p.origin,
        is_adjusted: p.is_adjusted, adjustment_reason: p.adjustment_reason, adjusted_by: p.adjusted_by,
        has_audit_photo: p.has_audit_photo, raw: p, sincronizado_em: nowISO,
      })))
    let qtdMarca = 0
    if (rowsMarca.length > 0) {
      const { error } = await supabaseAdmin.from('ind_ponto_marcacao').upsert(rowsMarca, { onConflict: 'company_id,point_id' })
      if (!error) qtdMarca = rowsMarca.length
      // marcacao e' complementar (auditoria/NR-36); se falhar, nao derruba o resumo diario.
    }

    const cpfs = new Set(dias.map((d) => d.cpf)).size
    const datas = new Set(dias.map((d) => d.data)).size
    await logSync(companyId, provider, 'ok', `dias=${rowsDia.length} cpfs=${cpfs} datas=${datas} batidas=${qtdMarca}`, rowsDia.length, { beginISO, endISO })

    return NextResponse.json({ ok: true, provider, company_id: companyId, periodo: { begin: beginISO, end: endISO }, dias: rowsDia.length, cpfs, datas, batidas: qtdMarca })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
