// Sicredi · Webhook de liquidação. Recebe LIQUIDACAO_PIX / LIQUIDACAO_REDE /
// LIQUIDACAO_COMPE → baixa automática via fn_boleto_liquidar (idempotente).
// Valida o segredo do webhook (env SICREDI_WEBHOOK_SECRET). Node runtime.
// Descobre a empresa pelo nossoNumero (erp_receber, banco 748).
import { NextRequest, NextResponse } from 'next/server'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '748'
const EVENTOS_LIQUIDACAO = new Set(['LIQUIDACAO_PIX', 'LIQUIDACAO_REDE', 'LIQUIDACAO_COMPE', 'LIQUIDADO', 'LIQUIDACAO'])

function segredoOk(req: NextRequest): boolean {
  const expected = process.env.SICREDI_WEBHOOK_SECRET
  const provided = req.headers.get('x-webhook-secret') || req.headers.get('x-sicredi-secret') || ''
  if (!expected || !provided) return false
  const A = Buffer.from(provided); const B = Buffer.from(expected)
  if (A.length !== B.length) return false
  return timingSafeEqual(A, B)
}

type EventoSicredi = {
  evento?: string; tipoMovimento?: string; tipo?: string
  nossoNumero?: string | number
  dataMovimento?: string; dataLiquidacao?: string; dataPagamento?: string
  valor?: number | string; valorLiquidado?: number | string
}

export async function POST(req: NextRequest) {
  try {
    if (!segredoOk(req)) return NextResponse.json({ ok: false, erro: 'segredo invalido' }, { status: 401 })
    const body = await req.json()
    // Sicredi pode mandar 1 evento ou uma lista.
    const eventos: EventoSicredi[] = Array.isArray(body) ? body : Array.isArray(body?.eventos) ? body.eventos : [body]

    const resultados: unknown[] = []
    for (const ev of eventos) {
      const tipo = String(ev.evento ?? ev.tipoMovimento ?? ev.tipo ?? '').toUpperCase()
      if (!EVENTOS_LIQUIDACAO.has(tipo)) { resultados.push({ ignorado: tipo }); continue }
      const nossoNumero = ev.nossoNumero != null ? String(ev.nossoNumero) : null
      if (!nossoNumero) { resultados.push({ erro: 'sem_nosso_numero' }); continue }

      // descobre a empresa pelo nossoNumero (boleto Sicredi)
      const { data: rec } = await supabaseAdmin.from('erp_receber')
        .select('company_id')
        .eq('boleto_nosso_numero', nossoNumero)
        .eq('boleto_banco_codigo', BANCO)
        .order('boleto_emitido_em', { ascending: false })
        .limit(1).single()
      if (!rec?.company_id) { resultados.push({ nossoNumero, erro: 'recebivel_nao_encontrado' }); continue }

      const dataPgto = (ev.dataLiquidacao ?? ev.dataPagamento ?? ev.dataMovimento ?? new Date().toISOString().slice(0, 10)).slice(0, 10)
      const valorRaw = ev.valorLiquidado ?? ev.valor
      const valor = valorRaw != null ? Number(valorRaw) : null

      const { data: liq } = await supabaseAdmin.rpc('fn_boleto_liquidar', {
        p_company_id: rec.company_id, p_nosso_numero: nossoNumero, p_data_pagamento: dataPgto,
        p_valor_pago: valor, p_provider_raw: ev as unknown as Record<string, unknown>,
        p_provider: 'sicredi', p_banco_codigo: BANCO,
      })
      resultados.push({ nossoNumero, liq })
    }
    return NextResponse.json({ ok: true, processados: resultados.length, resultados })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
