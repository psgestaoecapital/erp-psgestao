// POST /api/boleto/sync-liquidacao
// Sincroniza a liquidacao dos boletos em aberto: pra cada boleto com
// nosso_numero, consulta o Sicoob (GET /boletos), e se voltar
// situacaoBoleto=LIQUIDADO chama fn_boleto_liquidar (idempotente, delega
// baixa canonica pra fn_receber_baixar_pagamento). Loga cada consulta em
// fn_webhook_registrar_log (auditoria). NAO fabrica movimento no fluxo
// — a conciliacao com o extrato bancario continua acontecendo pelo OFX.
//
// Auth: sessao de usuario (Bearer ou cookie) OU x-ping-secret pra
// cron/automacao. Sessao valida via get_user_company_ids().

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { consultarBoleto, type SicoobAmbiente } from '@/lib/banco/sicoob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BANCO = '756'

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
async function temAcessoEmpresa(sb: AuthedClient, companyId: string): Promise<boolean> {
  const { data, error } = await sb.rpc('get_user_company_ids')
  if (error || !Array.isArray(data)) return false
  return (data as string[]).includes(companyId)
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

type Boleto = { id: string; boleto_nosso_numero: string | null; valor: number }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const companyId: string | undefined = body?.company_id
    if (!companyId) return NextResponse.json({ ok: false, erro: 'company_id ausente' }, { status: 400 })

    if (!temSegredoValido(req)) {
      const sb = await resolverSessao(req)
      if (!sb) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })
      const ok = await temAcessoEmpresa(sb, companyId)
      if (!ok) return NextResponse.json({ ok: false, erro: 'sem acesso a esta empresa' }, { status: 403 })
    }

    // 1) boletos em aberto com nosso_numero
    const { data: boletos, error: berr } = await supabaseAdmin
      .from('erp_receber')
      .select('id, boleto_nosso_numero, valor')
      .eq('company_id', companyId)
      .eq('boleto_status', 'registrado')
      .in('status', ['aberto', 'vencido', 'parcial'])
      .not('boleto_nosso_numero', 'is', null)
    if (berr) return NextResponse.json({ ok: false, erro: berr.message }, { status: 500 })
    const lista = (boletos as Boleto[] | null) ?? []
    if (lista.length === 0) return NextResponse.json({ ok: true, consultados: 0, liquidados: 0, erros: [] })

    // 2) credencial Sicoob (mesmo padrao do registrar-boleto)
    let ambiente: SicoobAmbiente = 'producao'
    let credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'producao',
    })
    let credRow = credResp.data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
        p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'homologacao',
      })
      credRow = credResp.data as Record<string, unknown> | null
      ambiente = 'homologacao'
    }
    if (!credRow || credRow.ok === false) {
      return NextResponse.json({ ok: false, erro: 'credencial Sicoob nao configurada' }, { status: 412 })
    }
    const clientId = credRow.client_id as string | null
    const certBase64 = credRow.cert_base64 as string | null
    const certSenha = credRow.cert_senha as string | null
    const codigoBeneficiario = (credRow.codigo_beneficiario as string | null) ?? ''
    if (!clientId || !certBase64 || !certSenha || !codigoBeneficiario) {
      return NextResponse.json({ ok: false, erro: 'credencial Sicoob incompleta' }, { status: 412 })
    }
    const cred = {
      client_id: clientId, ambiente,
      pfx: Buffer.from(certBase64, 'base64'), passphrase: certSenha,
      cooperativa: (credRow.cooperativa as string | null) ?? '',
      conta: (credRow.conta as string | null) ?? '',
      codigo_beneficiario: codigoBeneficiario,
      convenio: (credRow.convenio as string | null) ?? '',
    }

    // 3) loop de consulta + liquidacao
    let liquidados = 0
    const erros: Array<{ nosso_numero: string; erro: string }> = []
    for (const b of lista) {
      const nu = b.boleto_nosso_numero!
      try {
        const r = await consultarBoleto(cred, nu)
        // log de auditoria (nunca deixa cair)
        try {
          await supabaseAdmin.rpc('fn_webhook_registrar_log', {
            p_provider: 'sicoob',
            p_tipo: 'boleto_liquidacao',
            p_provider_reference: nu,
            p_status_recebido: r.situacao ?? 'DESCONHECIDA',
            p_ip_origem: null,
            p_user_agent: 'sync-liquidacao',
            p_payload_raw: r.raw,
            p_signature_valid: true,
          })
        } catch { /* log opcional */ }

        if (r.situacao === 'LIQUIDADO' || r.situacao === 'PAGO' || r.situacao === 'BAIXADO_LIQUIDADO') {
          const dataPg = r.dataLiquidacao ?? new Date().toISOString().slice(0, 10)
          const valorPg = r.valorPago ?? b.valor
          const { data: liq } = await supabaseAdmin.rpc('fn_boleto_liquidar', {
            p_company_id: companyId,
            p_nosso_numero: nu,
            p_data_pagamento: dataPg,
            p_valor_pago: valorPg,
            p_provider_raw: r.raw,
          })
          const j = liq as { sucesso?: boolean; ja_liquidado?: boolean } | null
          if (j?.sucesso && !j?.ja_liquidado) liquidados++
        }
      } catch (e) {
        erros.push({ nosso_numero: nu, erro: e instanceof Error ? e.message : String(e) })
      }
    }

    // 4) marca ultimo sync na config (ambiente = 'producao'/'homologacao')
    await supabaseAdmin.from('erp_banco_provider_config')
      .update({
        ultimo_sync_em: new Date().toISOString(),
        ultimo_sync_status: erros.length > 0 ? 'parcial' : 'ok',
      })
      .eq('company_id', companyId)
      .eq('provider', 'sicoob')
      .eq('ambiente', ambiente)
      .eq('ativo', true)

    return NextResponse.json({
      ok: true, consultados: lista.length, liquidados, erros,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
