// Cancelar SÓ o boleto (baixa no banco) — o título (erp_receber) continua ativo.
// Caso: o cliente pagou por outro meio (Pix, dinheiro) e o boleto não pode mais ser pago.
// Sicoob via API (PATCH baixar); outro banco responde claramente que não há cancelamento por API.
// Auth: sessão do usuário (RLS decide se o título é dele). Node runtime (mTLS).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { baixarBoleto, consultarBoleto, type SicoobAmbiente } from '@/lib/banco/sicoob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO_SICOOB = '756'
const NOME_BANCO: Record<string, string> = { '756': 'Sicoob', '748': 'Sicredi', '237': 'Bradesco', '001': 'Banco do Brasil' }

function userSupabase(req: NextRequest) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: req.headers.get('authorization') || '' } },
    auth: { persistSession: false },
  })
}

async function logSync(company_id: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  await supabaseAdmin.from('erp_banco_sync_log').insert({
    company_id, banco_codigo: BANCO_SICOOB, provider: 'sicoob', tipo: 'boleto_cancelamento',
    status, qtd: 1, mensagem, payload_resumo: payload,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })

    const sb = userSupabase(req)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    const { data: rec } = await sb.from('erp_receber')
      .select('id, company_id, status, deleted_at, boleto_status, boleto_nosso_numero, boleto_banco_codigo')
      .eq('id', receber_id).maybeSingle()
    if (!rec || rec.deleted_at) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    const companyId: string = rec.company_id

    if (rec.boleto_status !== 'registrado' || !rec.boleto_nosso_numero) {
      return NextResponse.json({ ok: false, erro: 'Este título não tem boleto registrado no banco.' }, { status: 412 })
    }
    if (['pago', 'recebido', 'cancelado'].includes(String(rec.status))) {
      return NextResponse.json({ ok: false, erro: 'Título já quitado ou cancelado: não há boleto a cancelar.' }, { status: 412 })
    }
    const banco = String(rec.boleto_banco_codigo ?? '')
    if (banco !== BANCO_SICOOB) {
      const nome = NOME_BANCO[banco] ?? `banco ${banco || 'desconhecido'}`
      return NextResponse.json({
        ok: false,
        erro: `O cancelamento de boleto por aqui ainda não está disponível para o ${nome}. Cancele o boleto no internet banking do banco.`,
      }, { status: 422 })
    }

    let ambiente: SicoobAmbiente = 'producao'
    let credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: companyId, p_banco_codigo: BANCO_SICOOB, p_ambiente: 'producao',
    })
    let credRow = credResp.data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
        p_company_id: companyId, p_banco_codigo: BANCO_SICOOB, p_ambiente: 'homologacao',
      })
      credRow = credResp.data as Record<string, unknown> | null
      ambiente = 'homologacao'
    }
    if (!credRow || credRow.ok === false) {
      return NextResponse.json({ ok: false, erro: 'Integração Sicoob não cadastrada.' }, { status: 412 })
    }
    const clientId = credRow.client_id as string | null
    const certBase64 = credRow.cert_base64 as string | null
    const certSenha = credRow.cert_senha as string | null
    if (!clientId || !certBase64 || !certSenha) {
      return NextResponse.json({ ok: false, erro: 'client_id/certificado/senha faltando.' }, { status: 412 })
    }
    const cred = {
      client_id: clientId, ambiente,
      pfx: Buffer.from(certBase64, 'base64'), passphrase: certSenha,
      cooperativa: (credRow.cooperativa as string | null) ?? '',
      conta: (credRow.conta as string | null) ?? '',
      codigo_beneficiario: (credRow.codigo_beneficiario as string | null) ?? '',
      convenio: (credRow.convenio as string | null) ?? '',
    }

    // Boleto já pago no banco não se cancela: orienta a sincronizar a liquidação.
    const cons = await consultarBoleto(cred, rec.boleto_nosso_numero)
    if (cons.situacao === 'LIQUIDADO') {
      return NextResponse.json({
        ok: false, erro: 'Este boleto já foi pago no banco. Use "Sincronizar liquidação" para baixar o título.',
      }, { status: 409 })
    }

    const baixa = await baixarBoleto(cred, rec.boleto_nosso_numero)
    const jaBaixado = cons.situacao === 'BAIXADO'
    if (!baixa.ok && !jaBaixado) {
      await logSync(companyId, 'erro', `cancelamento recusado: status ${baixa.status}`,
        { receber_id, nosso_numero: rec.boleto_nosso_numero, usuario: user.id, retorno: baixa.raw })
      return NextResponse.json({ ok: false, erro: 'O Sicoob recusou o cancelamento do boleto.', detalhes: baixa.raw }, { status: 502 })
    }

    // Só o boleto: o título fica como está (status, valor, vencimento).
    await supabaseAdmin.from('erp_receber').update({
      boleto_status: 'cancelado',
      boleto_nosso_numero: null, boleto_linha_digitavel: null, boleto_codigo_barras: null,
      boleto_qr_code: null, boleto_url: null, boleto_id_externo: null,
    }).eq('id', receber_id)

    await logSync(companyId, 'ok', `boleto cancelado no banco nu=${rec.boleto_nosso_numero}`,
      { receber_id, nosso_numero: rec.boleto_nosso_numero, usuario: user.id, em: new Date().toISOString(), retorno: baixa.raw, ambiente })

    return NextResponse.json({ ok: true, nosso_numero: rec.boleto_nosso_numero })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
