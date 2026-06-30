// POST/GET /api/industrial/ponto/sync — coletor generico de ponto eletronico.
// Le ind_ponto_provider_config (provider + secret name), busca o token no
// Vault, dispara o adapter certo e popula as canonicas
// ind_ponto_colaborador / ind_ponto_horas. Loga em erp_banco_sync_log.
//
// Auth: x-ping-secret OU sessao de usuario. Token NUNCA aparece em log
// nem em resposta.

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
  const A = Buffer.from(provided)
  const B = Buffer.from(expected)
  if (A.length !== B.length) return false
  return timingSafeEqual(A, B)
}

function userSupabaseBearer(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
}

// Aceita sessao via cookies do browser (createServerClient lendo os
// cookies do request — funciona com fetch credentials:'include' sem
// precisar do front passar Bearer Authorization manualmente).
async function userSupabaseCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const store = await cookies()
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: () => { /* read-only: rota nao precisa renovar sessao */ },
    },
  })
}

async function resolverUsuario(req: NextRequest): Promise<{ id: string } | null> {
  // 1) Bearer Authorization (padrao do front em SicoobBoletoActions etc.)
  const auth = req.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    const sb = userSupabaseBearer(req)
    const { data: { user } } = await sb.auth.getUser()
    if (user) return { id: user.id }
  }
  // 2) Cookie da sessao (navegacao direta / fetch credentials:include sem header)
  try {
    const sb = await userSupabaseCookies()
    const { data: { user } } = await sb.auth.getUser()
    if (user) return { id: user.id }
  } catch { /* sem cookie valido */ }
  return null
}

async function usuarioTemAcessoEmpresa(userId: string, companyId: string): Promise<boolean> {
  // get_user_company_ids() exige auth.uid() — aqui usamos service role
  // e consultamos user_companies direto pra checar a vinculacao.
  const { data } = await supabaseAdmin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1)
  return !!(data && data.length > 0)
}

async function lerSecret(name: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .schema('vault' as never)
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', name)
    .maybeSingle()
  if (error || !data) return null
  return (data as { decrypted_secret: string }).decrypted_secret ?? null
}

async function logSync(company_id: string, provider: string, status: 'ok' | 'erro', mensagem: string, qtd: number, payload: unknown) {
  try {
    await supabaseAdmin.from('erp_banco_sync_log').insert({
      company_id, banco_codigo: '000', provider,
      tipo: 'ponto_sync', status, qtd, mensagem: mensagem.slice(0, 1000),
      payload_resumo: payload,
    })
  } catch { /* nao deixar log derrubar a rota */ }
}

async function handle(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const companyId = url.searchParams.get('company_id') || ''
    const plantId = url.searchParams.get('plant_id') || ''
    const beginISO = url.searchParams.get('begin_date') || ''
    const endISO = url.searchParams.get('end_date') || ''

    if (!companyId || !plantId || !beginISO || !endISO) {
      return NextResponse.json({
        ok: false, erro: 'company_id, plant_id, begin_date e end_date sao obrigatorios',
      }, { status: 400 })
    }

    // Auth: x-ping-secret OU sessao (Bearer ou cookie).
    // Pra sessao, valida que o usuario tem acesso a esta company.
    if (!temSegredoValido(req)) {
      const user = await resolverUsuario(req)
      if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })
      const temAcesso = await usuarioTemAcessoEmpresa(user.id, companyId)
      if (!temAcesso) return NextResponse.json({ ok: false, erro: 'sem acesso a esta empresa' }, { status: 403 })
    }

    // 1) config do provider pra esta planta
    const { data: cfg, error: cfgErr } = await supabaseAdmin
      .from('ind_ponto_provider_config')
      .select('provider, base_url, vault_secret_name, ativo')
      .eq('company_id', companyId)
      .eq('plant_id', plantId)
      .eq('ativo', true)
      .maybeSingle()
    if (cfgErr || !cfg) {
      return NextResponse.json({
        ok: false, erro: 'planta sem provider de ponto configurado', detalhe: cfgErr?.message,
      }, { status: 412 })
    }
    const provider = cfg.provider as string
    const baseUrl = cfg.base_url as string
    const secretName = cfg.vault_secret_name as string

    // 2) token do Vault
    const token = await lerSecret(secretName)
    if (!token) {
      await logSync(companyId, provider, 'erro', `secret ${secretName} ausente/vazio no Vault`, 0, { plantId })
      return NextResponse.json({ ok: false, erro: 'secret do provider nao encontrado no Vault' }, { status: 500 })
    }

    // 3) adapter
    const adapter = getPontoAdapter(provider)
    const cred = { token, base_url: baseUrl }

    // 4) coletar colaboradores
    let qtdColab = 0
    try {
      const colabs = await adapter.listarColaboradores(cred)
      qtdColab = colabs.length
      if (colabs.length > 0) {
        const rows = colabs.map((c) => ({
          company_id: companyId, plant_id: plantId, provider,
          cpf: c.cpf, matricula: c.matricula, nome: c.nome, email: c.email,
          funcao: c.funcao, departamento: c.departamento, equipe: c.equipe,
          unidade_negocio: c.unidade_negocio, admissao: c.admissao, pis: c.pis,
          raw: c.raw, sincronizado_em: new Date().toISOString(),
        }))
        const { error } = await supabaseAdmin
          .from('ind_ponto_colaborador')
          .upsert(rows, { onConflict: 'company_id,provider,cpf' })
        if (error) throw error
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await logSync(companyId, provider, 'erro', `colaboradores: ${msg}`, qtdColab, { plantId })
      return NextResponse.json({ ok: false, erro: 'falha ao sincronizar colaboradores', detalhe: msg }, { status: 502 })
    }

    // 5) coletar horas no periodo
    let qtdHoras = 0
    let totalHoras = 0
    try {
      const horas = await adapter.listarHoras(cred, beginISO, endISO)
      qtdHoras = horas.length
      totalHoras = horas.reduce((s, h) => s + (h.total_horas || 0), 0)
      if (horas.length > 0) {
        const rows = horas.map((h) => ({
          company_id: companyId, plant_id: plantId, provider,
          cpf: h.cpf, periodo_inicio: h.periodo_inicio, periodo_fim: h.periodo_fim,
          total_horas: h.total_horas, funcao: h.funcao, departamento: h.departamento,
          equipe: h.equipe, unidade_negocio: h.unidade_negocio, raw: h.raw,
          sincronizado_em: new Date().toISOString(),
        }))
        const { error } = await supabaseAdmin
          .from('ind_ponto_horas')
          .upsert(rows, { onConflict: 'company_id,provider,cpf,periodo_inicio,periodo_fim' })
        if (error) throw error
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await logSync(companyId, provider, 'erro', `horas: ${msg}`, qtdHoras, { plantId, beginISO, endISO })
      return NextResponse.json({
        ok: false, erro: 'falha ao sincronizar horas', detalhe: msg,
        colaboradores: qtdColab,
      }, { status: 502 })
    }

    await logSync(companyId, provider, 'ok',
      `sync ok colaboradores=${qtdColab} horas=${qtdHoras} total=${totalHoras.toFixed(2)}h`,
      qtdHoras, { plantId, beginISO, endISO })

    return NextResponse.json({
      ok: true,
      provider, company_id: companyId, plant_id: plantId,
      periodo: { begin: beginISO, end: endISO },
      colaboradores: qtdColab,
      horas_registros: qtdHoras,
      total_horas: Number(totalHoras.toFixed(2)),
    })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
