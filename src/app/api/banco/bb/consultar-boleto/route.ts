// Banco do Brasil · Consultar Boleto (situação no banco) · Node runtime. Chamado #5404.
// SÓ LEITURA no banco e no título: devolve a situação para a tela; a baixa do título segue o fluxo de liquidação de sempre.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { consultarBoletoBb } from '@/lib/banco/bb/cobranca'
import { BB_BANCO, carregarCredBb, logSyncBb } from '@/lib/banco/bb/servidor'
import { extractBankMessage } from '@/lib/banco/bankError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROTULO: Record<number, string> = { 1: 'Normal (aguardando pagamento)', 6: 'Liquidado (pago)', 7: 'Baixado (cancelado)' }

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: req.headers.get('authorization') || '' } }, auth: { persistSession: false },
    })
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    const { data: rec } = await sb.from('erp_receber')
      .select('id, company_id, boleto_nosso_numero, boleto_banco_codigo').eq('id', receber_id).single()
    if (!rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    if (!rec.boleto_nosso_numero || (rec.boleto_banco_codigo && String(rec.boleto_banco_codigo) !== BB_BANCO)) {
      return NextResponse.json({ ok: false, erro: 'Este titulo nao tem boleto do Banco do Brasil.' }, { status: 409 })
    }
    const c = await carregarCredBb(rec.company_id)
    if (!c) return NextResponse.json({ ok: false, erro: 'Integração bancária do Banco do Brasil incompleta (Conexões bancárias).' }, { status: 412 })

    const r = await consultarBoletoBb(c.cred, rec.boleto_nosso_numero, c.cfg.convenio)
    if (r.status < 200 || r.status >= 300) {
      await logSyncBb(rec.company_id, 'boleto_consultar', 'erro', `consulta recusada: status ${r.status}`, { receber_id, raw: r.raw })
      const msg = extractBankMessage(r.raw)
      return NextResponse.json({ ok: false, erro: msg ? `Banco do Brasil: ${msg}` : 'O Banco do Brasil não respondeu a consulta do boleto.' }, { status: 502 })
    }
    await logSyncBb(rec.company_id, 'boleto_consultar', 'ok', `situacao nu=${rec.boleto_nosso_numero}: ${r.estado ?? '?'}`, { receber_id, ambiente: c.cred.ambiente, por: user.id })
    return NextResponse.json({
      ok: true, ambiente: c.cred.ambiente, estado: r.estado ?? null, situacao: (r.estado !== undefined && ROTULO[r.estado]) || 'Em outra situação no banco',
      liquidado: r.liquidado, baixado: r.baixado, valor_pago: r.valorPago ?? null, data_pagamento: r.dataPagamento ?? null,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
