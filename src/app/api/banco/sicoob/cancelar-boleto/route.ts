// Sicoob · Cancelar (baixar) SO O BOLETO · Node runtime (mTLS).
// Regra central (chamado do Rodrigo): o boleto some no banco, o TITULO (erp_receber) permanece ativo
// — o cliente pagou por outro meio e o titulo sera quitado pela baixa normal.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { baixarBoleto, type SicoobAmbiente } from '@/lib/banco/sicoob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '756'

async function logSync(company_id: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  await supabaseAdmin.from('erp_banco_sync_log').insert({
    company_id, banco_codigo: BANCO, provider: 'sicoob', tipo: 'boleto_cancelar',
    status, qtd: 1, mensagem, payload_resumo: payload,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: req.headers.get('authorization') || '' } },
      auth: { persistSession: false },
    })
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    // RLS do usuario: so enxerga titulo da propria empresa.
    const { data: rec } = await sb.from('erp_receber')
      .select('id, company_id, status, boleto_status, boleto_nosso_numero, boleto_banco_codigo')
      .eq('id', receber_id).is('deleted_at', null).maybeSingle()
    if (!rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    const companyId: string = rec.company_id

    if (rec.boleto_status !== 'registrado' || !rec.boleto_nosso_numero) {
      return NextResponse.json({ ok: false, erro: 'Este titulo nao tem boleto registrado para cancelar.' }, { status: 409 })
    }
    if (String(rec.boleto_banco_codigo ?? '') !== BANCO) {
      return NextResponse.json({ ok: false, erro: 'O boleto deste titulo nao e do Sicoob.' }, { status: 409 })
    }
    if (['pago', 'recebido', 'cancelado'].includes(String(rec.status ?? '').toLowerCase())) {
      return NextResponse.json({ ok: false, erro: 'Titulo ja pago ou cancelado: o boleto nao pode ser cancelado por aqui.' }, { status: 409 })
    }

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
      return NextResponse.json({ ok: false, erro: 'Integracao bancaria Sicoob nao cadastrada.' }, { status: 412 })
    }
    const clientId = credRow.client_id as string | null
    const certBase64 = credRow.cert_base64 as string | null
    const certSenha = credRow.cert_senha as string | null
    const codigoBeneficiario = (credRow.codigo_beneficiario as string | null) ?? ''
    if (!clientId || !certBase64 || !certSenha || !codigoBeneficiario) {
      return NextResponse.json({ ok: false, erro: 'Credenciais do Sicoob incompletas na Integracao bancaria.' }, { status: 412 })
    }

    const r = await baixarBoleto({
      client_id: clientId, ambiente,
      pfx: Buffer.from(certBase64, 'base64'), passphrase: certSenha,
      cooperativa: (credRow.cooperativa as string | null) ?? '',
      conta: (credRow.conta as string | null) ?? '',
      codigo_beneficiario: codigoBeneficiario,
      convenio: (credRow.convenio as string | null) ?? '',
    }, rec.boleto_nosso_numero)

    if (!r.ok) {
      await logSync(companyId, 'erro', `cancelamento recusado: status ${r.status}`, {
        receber_id, por: user.id, nosso_numero: rec.boleto_nosso_numero, raw: r.raw,
      })
      return NextResponse.json({ ok: false, erro: 'O Sicoob nao confirmou o cancelamento do boleto. O boleto continua valido.', detalhes: r.raw }, { status: 502 })
    }

    // So o boleto: o titulo (status, valor, vencimento) NAO e tocado. Guarda o nosso numero no log.
    await supabaseAdmin.from('erp_receber').update({
      boleto_status: 'cancelado',
      boleto_linha_digitavel: null,
      boleto_codigo_barras: null,
      boleto_qr_code: null,
      boleto_url: null,
    }).eq('id', receber_id).eq('company_id', companyId)

    await logSync(companyId, 'ok', `boleto cancelado nu=${rec.boleto_nosso_numero}`, {
      receber_id, por: user.id, nosso_numero: rec.boleto_nosso_numero, ambiente, retorno_banco: r.raw,
    })
    return NextResponse.json({ ok: true, nosso_numero: rec.boleto_nosso_numero, ambiente })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
