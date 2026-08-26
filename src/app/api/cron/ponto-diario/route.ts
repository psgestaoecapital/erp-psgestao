// GET /api/cron/ponto-diario
// CRON-PONTO · Vercel Cron HORÁRIO (0 * * * *) dispara o sync do ponto de TODAS as empresas com
// provider IO Point ativo. Mantém a base como espelho fiel do IO Point (fonte da verdade).
//
// Estratégia por empresa: sincroniza SEMPRE o MÊS CORRENTE inteiro (1º dia do mês → hoje),
// fatiado em CHUNKS de CHUNK_DIAS (timeout da sync-diario + rate limit da API IO Point). A gravação
// é UPSERT (sync-diario, onConflict company_id,cpf,data) → rodar de novo não empilha; um dia corrigido
// no IO Point volta atualizado. Erro numa empresa é logado e não trava as outras (multi-tenant).
//
// Auth: Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`. Chamada manual aceita
// `x-ping-secret: <PING_SICOOB_SECRET>` (mesmo segredo que a sync-diario). Segredos só do env;
// token do IO Point nunca é tocado aqui (fica na sync-diario/Vault).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CHUNK_DIAS = 15
// CRON-PONTO · janela = MÊS CORRENTE inteiro (date_trunc('month') → hoje), reprocessado a cada rodada
// horária. O upsert em ind_ponto_dia (onConflict company_id,cpf,data) garante espelho fiel do IO Point
// sem empilhar: um dia corrigido lá (ex.: batida ímpar completada pelo RH) volta atualizado na próxima
// rodada. Fatiado em CHUNK_DIAS por causa do timeout da sync-diario e do rate limit da API IO Point.

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDias(d: Date, n: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const pingSecret = process.env.PING_SICOOB_SECRET
  const auth = req.headers.get('authorization')
  const xPing = req.headers.get('x-ping-secret')
  const cronOk = !!cronSecret && auth === `Bearer ${cronSecret}`
  const pingOk = !!pingSecret && xPing === pingSecret
  if (!cronOk && !pingOk) {
    return NextResponse.json({ ok: false, erro: 'Unauthorized' }, { status: 401 })
  }
  if (!pingSecret) {
    return NextResponse.json({ ok: false, erro: 'PING_SICOOB_SECRET nao configurado' }, { status: 500 })
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ ok: false, erro: 'SUPABASE_URL/SERVICE_ROLE_KEY ausentes' }, { status: 500 })
  }
  const supa = createClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const baseUrl =
    process.env.SAAS_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  // opção manual: ?company_id=&begin_date=&end_date= força uma janela específica
  const url = new URL(req.url)
  const soCompany = url.searchParams.get('company_id')
  const forcaBegin = url.searchParams.get('begin_date')
  const forcaFim = url.searchParams.get('end_date')

  // empresas com provider de ponto ativo
  let q = supa.from('ind_ponto_provider_config').select('company_id, provider').eq('ativo', true)
  if (soCompany) q = q.eq('company_id', soCompany)
  const { data: cfgs, error: eCfg } = await q
  if (eCfg) return NextResponse.json({ ok: false, erro: eCfg.message }, { status: 500 })

  // Janela default: mês corrente inteiro (1º dia do mês → hoje). Override manual via ?begin_date/end_date.
  const agora = new Date()
  const inicioMes = ymd(new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)))
  const hoje = ymd(agora)
  const resultados: Array<Record<string, unknown>> = []

  for (const cfg of cfgs ?? []) {
    const companyId = cfg.company_id as string
    const begin: string = forcaBegin || inicioMes
    const end: string = forcaFim || hoje

    if (begin > end) {
      resultados.push({ company_id: companyId, status: 'em_dia', begin, end })
      continue
    }

    // fatiar em chunks de CHUNK_DIAS
    let diasTotal = 0
    let batidasTotal = 0
    const erros: string[] = []
    let cursor = new Date(begin)
    const fim = new Date(end)
    while (cursor <= fim) {
      const chunkFim = new Date(Math.min(addDias(cursor, CHUNK_DIAS - 1).getTime(), fim.getTime()))
      const cBegin = ymd(cursor)
      const cEnd = ymd(chunkFim)
      try {
        const res = await fetch(
          `${baseUrl}/api/industrial/ponto/sync-diario?company_id=${companyId}&begin_date=${cBegin}&end_date=${cEnd}`,
          { method: 'POST', headers: { 'x-ping-secret': pingSecret } },
        )
        const j = await res.json().catch(() => ({}))
        if (res.ok && j.ok) {
          diasTotal += Number(j.dias || 0)
          batidasTotal += Number(j.batidas || 0)
        } else {
          erros.push(`${cBegin}..${cEnd}: ${j.erro || res.status}`)
        }
      } catch (e) {
        erros.push(`${cBegin}..${cEnd}: ${e instanceof Error ? e.message : String(e)}`)
      }
      cursor = addDias(chunkFim, 1)
    }

    resultados.push({
      company_id: companyId, begin, end, dias: diasTotal, batidas: batidasTotal,
      status: erros.length ? 'parcial' : 'ok', erros: erros.slice(0, 5),
    })
  }

  return NextResponse.json({ ok: true, executado_em: new Date().toISOString(), empresas: resultados.length, resultados })
}

export const POST = GET
